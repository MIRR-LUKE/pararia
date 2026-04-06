import { NextResponse } from "next/server";
import {
  ConversationSourceType,
  SessionPartJobType,
  SessionPartStatus,
  SessionPartType,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueSessionPartJob, processAllSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import { updateSessionStatusFromParts } from "@/lib/session-service";
import { toSessionPartMetaJson } from "@/lib/session-part-meta";
import { verifyRecordingLockForAudioUpload } from "@/lib/recording/lockService";
import { toPrismaJson } from "@/lib/prisma-json";
import { getRecordingMaxDurationSeconds } from "@/lib/recording/validation";
import {
  appendLiveTranscriptionChunk,
  getLiveTranscriptionProgress,
  startLiveChunkTranscription,
} from "@/lib/live-session-transcription";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { getAudioExpiryDate } from "@/lib/system-config";

function parsePartType(raw: string | null) {
  if (raw === SessionPartType.CHECK_IN) return SessionPartType.CHECK_IN;
  if (raw === SessionPartType.CHECK_OUT) return SessionPartType.CHECK_OUT;
  return SessionPartType.FULL;
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
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const sessionAuth = authResult.session;

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
      const maxDurationMs = getRecordingMaxDurationSeconds(sessionRow.type) * 1000;

      if (!file) {
        return NextResponse.json({ error: "file is required" }, { status: 400 });
      }
      if (!Number.isInteger(sequence) || sequence < 0) {
        return NextResponse.json({ error: "sequence is invalid" }, { status: 400 });
      }
      if (startedAtMs + durationMs > maxDurationMs) {
        return NextResponse.json(
          {
            error:
              sessionRow.type === "LESSON_REPORT"
                ? "指導報告の録音は各パート10分までです。録音を保存してから次へ進んでください。"
                : "面談の録音は60分までです。録音を保存してから次へ進んでください。",
            code: "recording_too_long",
            maxAllowedSeconds: Math.round(maxDurationMs / 1000),
          },
          { status: 422 }
        );
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

      const expiresAt = getAudioExpiryDate();

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
          qualityMetaJson: toSessionPartMetaJson(existingPart?.qualityMetaJson, {
            pipelineStage: "TRANSCRIBING",
            uploadMode: "direct_recording",
            lastQueuedAt: new Date().toISOString(),
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
          qualityMetaJson: toSessionPartMetaJson({}, {
            pipelineStage: "TRANSCRIBING",
            uploadMode: "direct_recording",
            lastQueuedAt: new Date().toISOString(),
            liveTranscription: true,
            liveChunkCount: progress.chunkCount,
            liveReadyChunkCount: progress.readyChunkCount,
            liveErrorChunkCount: progress.errorChunkCount,
            liveDurationSeconds: Math.round(progress.totalDurationMs / 1000),
          }),
          transcriptExpiresAt: expiresAt,
        },
      });

      if (shouldRunBackgroundJobsInline()) {
        void startLiveChunkTranscription(params.id, partType, sequence).catch((error) => {
          console.error("[POST /api/sessions/[id]/parts/live] Chunk transcription failed:", {
            sessionId: params.id,
            partType,
            sequence,
            error: error?.message ?? String(error),
          });
        });
      }

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
    const maxDurationMs = getRecordingMaxDurationSeconds(sessionRow.type) * 1000;

    try {
      await verifyLockOrThrow(params.id, sessionRow.studentId, sessionAuth.user.id, lockToken);
    } catch (error: any) {
      return NextResponse.json(
        { error: error?.message ?? "録音ロックの検証に失敗しました。", code: "recording_lock_invalid" },
        { status: 409 }
      );
    }

    const expiresAt = getAudioExpiryDate();
    const existingPart = await prisma.sessionPart.findUnique({
      where: { sessionId_partType: { sessionId: params.id, partType } },
      select: {
        qualityMetaJson: true,
        storageUrl: true,
        fileName: true,
        mimeType: true,
      },
    });
    const progress = await getLiveTranscriptionProgress(params.id, partType);
    if (progress.totalDurationMs > maxDurationMs) {
      return NextResponse.json(
        {
          error:
            sessionRow.type === "LESSON_REPORT"
              ? "指導報告の録音は各パート10分までです。録音を分けて保存してください。"
              : "面談の録音は60分までです。録音を分けて保存してください。",
          code: "recording_too_long",
          maxAllowedSeconds: Math.round(maxDurationMs / 1000),
          durationSeconds: Math.round(progress.totalDurationMs / 1000),
        },
        { status: 422 }
      );
    }
    const part = await prisma.sessionPart.upsert({
      where: { sessionId_partType: { sessionId: params.id, partType } },
      update: {
        sourceType: ConversationSourceType.AUDIO,
        status: SessionPartStatus.TRANSCRIBING,
        qualityMetaJson: toSessionPartMetaJson(existingPart?.qualityMetaJson, {
          pipelineStage: "TRANSCRIBING",
          uploadMode: "direct_recording",
          lastAcceptedAt: new Date().toISOString(),
          lastQueuedAt: new Date().toISOString(),
        }),
        transcriptExpiresAt: expiresAt,
      },
      create: {
        sessionId: params.id,
        partType,
        sourceType: ConversationSourceType.AUDIO,
        status: SessionPartStatus.TRANSCRIBING,
        fileName: `${partType.toLowerCase()}-live.webm`,
        mimeType: "audio/webm",
        byteSize: null,
        storageUrl: null,
        rawTextOriginal: "",
        rawTextCleaned: "",
        rawSegments: toPrismaJson([]),
        qualityMetaJson: toSessionPartMetaJson({}, {
          pipelineStage: "TRANSCRIBING",
          uploadMode: "direct_recording",
          lastAcceptedAt: new Date().toISOString(),
          lastQueuedAt: new Date().toISOString(),
        }),
        transcriptExpiresAt: expiresAt,
      },
    });

    const session = await updateSessionStatusFromParts(params.id);
    await enqueueSessionPartJob(part.id, SessionPartJobType.FINALIZE_LIVE_PART);
    if (shouldRunBackgroundJobsInline()) {
      void processAllSessionPartJobs(params.id).catch((error) => {
        console.error("[POST /api/sessions/[id]/parts/live] Background session part processing failed:", error);
      });
    }

    return NextResponse.json({
      part,
      session,
      generationDeferred: true,
    });
  } catch (error: any) {
    console.error("[POST /api/sessions/[id]/parts/live] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
