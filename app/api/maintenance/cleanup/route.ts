import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { deleteRuntimeEntries } from "@/lib/runtime-cleanup";
import {
  buildRetentionExpiryDate,
  getAudioRetentionDays,
  getReportDeliveryEventRetentionDays,
  getTranscriptRetentionDays,
} from "@/lib/system-config";
import { describeRequestActor, requireMaintenanceAccess } from "@/lib/server/request-auth";

async function handleCleanup(request: Request) {
  const access = await requireMaintenanceAccess(request);
  if (access.response) return access.response;
  const actor = access.actor;

  try {
    const now = new Date();
    const expiredSessionParts = await prisma.sessionPart.findMany({
      where: {
        transcriptExpiresAt: {
          lte: now,
        },
      },
      select: {
        id: true,
        storageUrl: true,
      },
    });
    const runtimeDeletion = await deleteRuntimeEntries(expiredSessionParts.map((part) => part.storageUrl));
    const reportEventCutoff = buildRetentionExpiryDate(-getReportDeliveryEventRetentionDays(), now);

    const [conversationResult, sessionPartResult, suggestionResult, reportDeliveryEventResult] = await prisma.$transaction([
      prisma.conversationLog.updateMany({
        where: {
          rawTextExpiresAt: {
            lte: now,
          },
        },
        data: {
          rawTextOriginal: null,
          rawTextCleaned: null,
          reviewedText: null,
          reviewState: "NONE",
          rawSegments: Prisma.DbNull,
          rawTextExpiresAt: null,
        },
      }),
      prisma.sessionPart.updateMany({
        where: {
          transcriptExpiresAt: {
            lte: now,
          },
        },
        data: {
          storageUrl: null,
          rawTextOriginal: null,
          rawTextCleaned: null,
          reviewedText: null,
          reviewState: "NONE",
          rawSegments: Prisma.DbNull,
          transcriptExpiresAt: null,
        },
      }),
      prisma.properNounSuggestion.deleteMany({
        where: {
          OR: [
            {
              conversation: {
                rawTextExpiresAt: {
                  lte: now,
                },
              },
            },
            {
              sessionPart: {
                transcriptExpiresAt: {
                  lte: now,
                },
              },
            },
          ],
        },
      }),
      prisma.reportDeliveryEvent.deleteMany({
        where: {
          createdAt: {
            lt: reportEventCutoff,
          },
        },
      }),
    ]);

    const response = {
      ok: true,
      clearedConversationRawTextCount: conversationResult.count,
      clearedSessionPartCount: sessionPartResult.count,
      deletedProperNounSuggestionCount: suggestionResult.count,
      deletedRuntimeEntryCount: runtimeDeletion.deletedCount,
      deletedReportDeliveryEventCount: reportDeliveryEventResult.count,
      transcriptRetentionDays: getTranscriptRetentionDays(),
      audioRetentionDays: getAudioRetentionDays(),
      reportDeliveryEventRetentionDays: getReportDeliveryEventRetentionDays(),
      ranAt: now.toISOString(),
      invokedBy: actor ? describeRequestActor(actor) : null,
    };

    await writeAuditLog({
      organizationId: access.session?.user.organizationId ?? null,
      userId: access.session?.user.id ?? null,
      action: "maintenance.cleanup",
      targetType: "maintenance_job",
      targetId: "maintenance/cleanup",
      status: "SUCCESS",
      detail: {
        actor: actor ? describeRequestActor(actor) : null,
        clearedConversationRawTextCount: conversationResult.count,
        clearedSessionPartCount: sessionPartResult.count,
        deletedProperNounSuggestionCount: suggestionResult.count,
        deletedRuntimeEntryCount: runtimeDeletion.deletedCount,
        deletedReportDeliveryEventCount: reportDeliveryEventResult.count,
      },
    });

    return NextResponse.json(response);
  } catch (e: any) {
    await writeAuditLog({
      organizationId: access.session?.user.organizationId ?? null,
      userId: access.session?.user.id ?? null,
      action: "maintenance.cleanup",
      targetType: "maintenance_job",
      targetId: "maintenance/cleanup",
      status: "ERROR",
      detail: {
        actor: actor ? describeRequestActor(actor) : null,
        error: e?.message ?? "Internal Server Error",
      },
    });
    console.error("[/api/maintenance/cleanup] Error:", {
      error: e?.message,
      stack: e?.stack,
    });
    return NextResponse.json({ ok: false, error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleCleanup(request);
}

export async function POST(request: Request) {
  return handleCleanup(request);
}
