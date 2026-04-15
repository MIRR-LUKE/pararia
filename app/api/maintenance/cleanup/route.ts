import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  enqueueRuntimeDeletionTargets,
  processPendingStorageDeletionRequests,
  queueExpiredBlobUploadReservationsForDeletion,
} from "@/lib/storage-deletion-queue";
import {
  buildRetentionExpiryDate,
  getAudioRetentionDays,
  getReportDeliveryEventRetentionDays,
  getTranscriptRetentionDays,
} from "@/lib/system-config";
import { describeRequestActor, requireMaintenanceAccess } from "@/lib/server/request-auth";
import { methodNotAllowedResponse, requireSameOriginRequest } from "@/lib/server/request-security";

async function handleCleanup(request: Request) {
  const access = await requireMaintenanceAccess(request);
  if (access.response) return access.response;
  const actor = access.actor;

  if (actor?.kind === "session") {
    const sameOriginResponse = requireSameOriginRequest(request);
    if (sameOriginResponse) return sameOriginResponse;
  }

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
    const runtimeDeletionQueue = await enqueueRuntimeDeletionTargets({
      filePaths: expiredSessionParts.map((part) => part.storageUrl),
      reason: "session_part_retention_expired",
    });
    const expiredBlobReservationCleanup = await queueExpiredBlobUploadReservationsForDeletion(now);
    const runtimeDeletion = await processPendingStorageDeletionRequests();
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
      queuedRuntimeEntryCount: runtimeDeletionQueue.queued.length,
      deletedRuntimeEntryCount: runtimeDeletion.deletedCount,
      failedRuntimeEntryCount: runtimeDeletion.failedCount,
      expiredBlobUploadReservationCount: expiredBlobReservationCleanup.expiredCount,
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
        queuedRuntimeEntryCount: runtimeDeletionQueue.queued.length,
        deletedRuntimeEntryCount: runtimeDeletion.deletedCount,
        failedRuntimeEntryCount: runtimeDeletion.failedCount,
        expiredBlobUploadReservationCount: expiredBlobReservationCleanup.expiredCount,
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

export async function GET() {
  return methodNotAllowedResponse(["POST"]);
}

export async function POST(request: Request) {
  return handleCleanup(request);
}
