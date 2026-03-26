import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { deleteRuntimeEntries } from "@/lib/runtime-cleanup";
import {
  buildRetentionExpiryDate,
  getAudioRetentionDays,
  getReportDeliveryEventRetentionDays,
  getTranscriptRetentionDays,
} from "@/lib/system-config";

async function handleCleanup() {
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

    const [conversationResult, sessionPartResult, reportDeliveryEventResult] = await prisma.$transaction([
      prisma.conversationLog.updateMany({
        where: {
          rawTextExpiresAt: {
            lte: now,
          },
        },
        data: {
          rawTextOriginal: null,
          rawTextCleaned: null,
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
          rawSegments: Prisma.DbNull,
          transcriptExpiresAt: null,
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

    return NextResponse.json({
      ok: true,
      clearedConversationRawTextCount: conversationResult.count,
      clearedSessionPartCount: sessionPartResult.count,
      deletedRuntimeEntryCount: runtimeDeletion.deletedCount,
      deletedReportDeliveryEventCount: reportDeliveryEventResult.count,
      transcriptRetentionDays: getTranscriptRetentionDays(),
      audioRetentionDays: getAudioRetentionDays(),
      reportDeliveryEventRetentionDays: getReportDeliveryEventRetentionDays(),
      ranAt: now.toISOString(),
    });
  } catch (e: any) {
    console.error("[/api/maintenance/cleanup] Error:", {
      error: e?.message,
      stack: e?.stack,
    });
    return NextResponse.json({ ok: false, error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function GET() {
  return handleCleanup();
}

export async function POST() {
  return handleCleanup();
}
