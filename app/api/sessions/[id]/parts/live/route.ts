import { NextResponse } from "next/server";
import {
  ConversationSourceType,
  SessionPartStatus,
  SessionPartType,
  SessionType,
} from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  ensureConversationForSession,
  updateSessionStatusFromParts,
} from "@/lib/session-service";
import {
  enqueueConversationJobs,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import {
  evaluateTranscriptSubstance,
} from "@/lib/recording/validation";
import { verifyRecordingLockForAudioUpload } from "@/lib/recording/lockService";
import { toPrismaJson } from "@/lib/prisma-json";
import {
  appendLiveTranscriptionChunk,
  finalizeLiveTranscriptionPart,
  getLiveTranscriptionProgress,
  startLiveChunkTranscription,
} from "@/lib/live-session-transcription";

function parsePartType(raw: string | null) {
  if (raw === SessionPartType.CHECK_IN) return SessionPartType.CHECK_IN;
  if (raw === SessionPartType.CHECK_OUT) return SessionPartType.CHECK_OUT;
  return SessionPartType.FULL;
}

function mergeMeta(existing: unknown, next: Record<string, unknown>) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return toPrismaJson({ ...base, ...next });
}

async function verifyLockOrThrow(sessionId: string, studentId: string, userId: string, plainToken: string) {
  if (!plainToken) {
    throw new Error("録音ロックが必要です。画面を更新してから、録音の開始からやり直してください。");
  }
  const ok = await verifyRecordingLockForAudioUpload({
    studentId,
    userId,
    plainToken,
  });
  if (!ok) {
    throw new Error(
      "録音ロックが無効です。他のユーザーが録音中か、ロックの期限が切れた可能性があります。"
    );
  }
  return sessionId;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sessionAuth = await auth();
    if (!sessionAuth?.user?.id || !sessionAuth.user.organizationId) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }

    const sessionRow = await prisma.session.findUnique({
      where: { id: params.id },
      include: {
        student: { select: { id: true, organizationId: true } },
      },
    });
    if (!sessionRow || sessionRow.student.organizationId !== sessionAuth.user.organizationId) {
      return NextResponse.json({ error: "セッションが見つかりません。" }, { status: 404 });
    }

    const contentType = request.headers.get("content-type") || "";

    if (/multipart\/form-data/i.test(contentType)) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const partType = parsePartType((formData.get("partType") as string | null) ?? null);
      const lockToken = (formData.get("lockToken") as string | null)?.trim() ?? "";
      const sequence = Number(formData.get("sequence") ?? -1);
      const startedAtMs = Number(formData.get("startedAtMs") ?? 0);
      const durationMs = Number(formData.get("durationMs") ?? 0);

      if (!file) {
        return NextResponse.json({ error: "file is required" }, { status: 400 });
      }
      if (!Number.isInteger(sequence) || sequence < 0) {
        return NextResponse.json({ error: "sequence is invalid" }, { status: 400 });
      }

      try {
        await verifyLockOrThrow(params.id, sessionRow.studentId, sessionAuth.user.id, lockToken);
      } catch (error: any) {
        return NextResponse.json(
          { error: error?.message ?? "録音ロックの検証に失敗しました。", code: "recording_lock_invalid" },
          { status: 409 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const { manifestPath } = await appendLiveTranscriptionChunk({
        sessionId: params.id,
        partType,
        sequence,
        fileName: file.name,
        mimeType: file.type || "audio/webm",
        buffer,
        startedAtMs,
        durationMs,
      });
      const progress = await getLiveTranscriptionProgress(params.id, partType);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const existingPart = await prisma.sessionPart.findUnique({
        where: { sessionId_partType: { sessionId: params.id, partType } },
        select: { qualityMetaJson: true },
      });

      await prisma.sessionPart.upsert({
        where: { sessionId_partType: { sessionId: params.id, partType } },
        update: {
          sourceType: ConversationSourceType.AUDIO,
          status: SessionPartStatus.TRANSCRIBING,
          fileName: `${partType.toLowerCase()}-live.webm`,
          mimeType: file.type || "audio/webm",
          storageUrl: manifestPath,
          qualityMetaJson: mergeMeta(existingPart?.qualityMetaJson, {
            liveTranscription: true,
            liveChunkCount: progress.chunkCount,
            liveReadyChunkCount: progress.readyChunkCount,
            liveErrorChunkCount: progress.errorChunkCount,
            liveDurationSeconds: Math.round(progress.totalDurationMs / 1000),
          }),
          transcriptExpiresAt: expiresAt,
        },
        create: {
          sessionId: params.id,
          partType,
          sourceType: ConversationSourceType.AUDIO,
          status: SessionPartStatus.TRANSCRIBING,
          fileName: `${partType.toLowerCase()}-live.webm`,
          mimeType: file.type || "audio/webm",
          byteSize: null,
          storageUrl: manifestPath,
          rawTextOriginal: "",
          rawTextCleaned: "",
          rawSegments: toPrismaJson([]),
          qualityMetaJson: toPrismaJson({
            liveTranscription: true,
            liveChunkCount: progress.chunkCount,
            liveReadyChunkCount: progress.readyChunkCount,
            liveErrorChunkCount: progress.errorChunkCount,
            liveDurationSeconds: Math.round(progress.totalDurationMs / 1000),
          }),
          transcriptExpiresAt: expiresAt,
        },
      });

      void startLiveChunkTranscription(params.id, partType, sequence).catch((error) => {
        console.error("[POST /api/sessions/[id]/parts/live] Chunk transcription failed:", {
          sessionId: params.id,
          partType,
          sequence,
          error: error?.message ?? String(error),
        });
      });

      return NextResponse.json({
        ok: true,
        progress,
        partType,
        status: SessionPartStatus.TRANSCRIBING,
      });
    }

    const body = (await request.json().catch(() => ({}))) as {
      partType?: string | null;
      lockToken?: string | null;
    };
    const partType = parsePartType(body.partType ?? null);
    const lockToken = String(body.lockToken ?? "").trim();

    try {
      await verifyLockOrThrow(params.id, sessionRow.studentId, sessionAuth.user.id, lockToken);
    } catch (error: any) {
      return NextResponse.json(
        { error: error?.message ?? "録音ロックの検証に失敗しました。", code: "recording_lock_invalid" },
        { status: 409 }
      );
    }

    const finalized = await finalizeLiveTranscriptionPart(params.id, partType);
    const qualityMeta = finalized.qualityMeta;
    const substance = evaluateTranscriptSubstance(finalized.rawTextCleaned || finalized.rawTextOriginal);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    if (!substance.ok) {
      const rejectedPart = await prisma.sessionPart.upsert({
        where: { sessionId_partType: { sessionId: params.id, partType } },
        update: {
          sourceType: ConversationSourceType.AUDIO,
          status: SessionPartStatus.ERROR,
          fileName: finalized.fileName,
          mimeType: finalized.mimeType,
          byteSize: finalized.byteSize,
          storageUrl: finalized.storageUrl,
          rawTextOriginal: finalized.rawTextOriginal,
          rawTextCleaned: finalized.rawTextCleaned,
          rawSegments: toPrismaJson(finalized.rawSegments),
          qualityMetaJson: toPrismaJson({
            ...qualityMeta,
            validationRejection: {
              code: substance.code,
              messageJa: substance.messageJa,
              metrics: substance.metrics,
              at: new Date().toISOString(),
            },
          }),
          transcriptExpiresAt: expiresAt,
        },
        create: {
          sessionId: params.id,
          partType,
          sourceType: ConversationSourceType.AUDIO,
          status: SessionPartStatus.ERROR,
          fileName: finalized.fileName,
          mimeType: finalized.mimeType,
          byteSize: finalized.byteSize,
          storageUrl: finalized.storageUrl,
          rawTextOriginal: finalized.rawTextOriginal,
          rawTextCleaned: finalized.rawTextCleaned,
          rawSegments: toPrismaJson(finalized.rawSegments),
          qualityMetaJson: toPrismaJson({
            ...qualityMeta,
            validationRejection: {
              code: substance.code,
              messageJa: substance.messageJa,
              metrics: substance.metrics,
              at: new Date().toISOString(),
            },
          }),
          transcriptExpiresAt: expiresAt,
        },
      });

      await updateSessionStatusFromParts(params.id);
      return NextResponse.json(
        {
          error: substance.messageJa,
          code: substance.code,
          part: rejectedPart,
          metrics: substance.metrics,
        },
        { status: 422 }
      );
    }

    const part = await prisma.sessionPart.upsert({
      where: { sessionId_partType: { sessionId: params.id, partType } },
      update: {
        sourceType: ConversationSourceType.AUDIO,
        status: SessionPartStatus.READY,
        fileName: finalized.fileName,
        mimeType: finalized.mimeType,
        byteSize: finalized.byteSize,
        storageUrl: finalized.storageUrl,
        rawTextOriginal: finalized.rawTextOriginal,
        rawTextCleaned: finalized.rawTextCleaned,
        rawSegments: toPrismaJson(finalized.rawSegments),
        qualityMetaJson: toPrismaJson(qualityMeta),
        transcriptExpiresAt: expiresAt,
      },
      create: {
        sessionId: params.id,
        partType,
        sourceType: ConversationSourceType.AUDIO,
        status: SessionPartStatus.READY,
        fileName: finalized.fileName,
        mimeType: finalized.mimeType,
        byteSize: finalized.byteSize,
        storageUrl: finalized.storageUrl,
        rawTextOriginal: finalized.rawTextOriginal,
        rawTextCleaned: finalized.rawTextCleaned,
        rawSegments: toPrismaJson(finalized.rawSegments),
        qualityMetaJson: toPrismaJson(qualityMeta),
        transcriptExpiresAt: expiresAt,
      },
    });

    const session = await updateSessionStatusFromParts(params.id);
    let conversationId: string | null = null;
    let generationError: string | null = null;

    if (session?.status === "PROCESSING") {
      try {
        conversationId = await ensureConversationForSession(params.id);
        await enqueueConversationJobs(conversationId);
        void processAllConversationJobs(conversationId).catch((error) => {
          console.error("[POST /api/sessions/[id]/parts/live] Background generation failed:", error);
        });
      } catch (error: any) {
        generationError = error?.message ?? "生成の開始に失敗しました。";
      }
    }

    return NextResponse.json({
      part,
      session,
      conversationId,
      generationError,
      generationDeferred: false,
    });
  } catch (error: any) {
    console.error("[POST /api/sessions/[id]/parts/live] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
