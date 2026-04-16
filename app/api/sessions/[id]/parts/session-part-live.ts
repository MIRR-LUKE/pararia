import { NextResponse } from "next/server";
import { ConversationSourceType, SessionPartJobType, SessionPartStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { appendLiveTranscriptionChunk, getLiveTranscriptionProgress, startLiveChunkTranscription } from "@/lib/live-session-transcription";
import { updateSessionStatusFromParts } from "@/lib/session-service";
import { toSessionPartMetaJson } from "@/lib/session-part-meta";
import { verifyRecordingLockForAudioUpload } from "@/lib/recording/lockService";
import { toPrismaJson } from "@/lib/prisma-json";
import { getRecordingMaxDurationSeconds } from "@/lib/recording/validation";
import { enqueueSessionPartJob, processAllSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { getAudioExpiryDate } from "@/lib/system-config";
import { isLiveChunkUploadEnabled } from "@/lib/recording/live-chunk-upload";
import type {
  LiveChunkSubmissionFormData,
  LiveFinalizeSubmissionBody,
  SessionPartAccessContext,
} from "./session-part-route-common";

async function verifyLockOrThrow(access: SessionPartAccessContext, plainToken: string) {
  if (!plainToken) {
    throw new Error("録音ロックが必要です。画面を更新してから、録音の開始からやり直してください。");
  }
  const ok = await verifyRecordingLockForAudioUpload({
    studentId: access.sessionRow.studentId,
    userId: access.sessionAuth.user.id,
    plainToken,
  });
  if (!ok) {
    throw new Error(
      "録音ロックが無効です。他のユーザーが録音中か、ロックの期限が切れた可能性があります。"
    );
  }
}

async function dispatchLiveSessionPartJobs(sessionId: string, partId: string) {
  await enqueueSessionPartJob(partId, SessionPartJobType.FINALIZE_LIVE_PART);

  if (shouldRunBackgroundJobsInline()) {
    void processAllSessionPartJobs(sessionId).catch((error) => {
      console.error("[POST /api/sessions/[id]/parts/live] Background session part processing failed:", error);
    });
  } else {
    void maybeEnsureRunpodWorker()
      .then((workerWake) => {
        if (workerWake?.attempted && !workerWake.ok) {
          console.error("[POST /api/sessions/[id]/parts/live] Runpod worker wake failed:", workerWake);
        }
      })
      .catch((error) => {
        console.error("[POST /api/sessions/[id]/parts/live] Runpod worker wake threw:", error);
      });
  }

  return null;
}

async function persistLiveTranscribingPart(input: {
  access: SessionPartAccessContext;
  partType: LiveChunkSubmissionFormData["partType"];
  mimeType: string;
  manifestPath: string;
  progress: Awaited<ReturnType<typeof getLiveTranscriptionProgress>>;
  expiresAt: Date;
}) {
  const existingPart = await prisma.sessionPart.findUnique({
    where: { sessionId_partType: { sessionId: input.access.sessionRow.id, partType: input.partType } },
    select: { qualityMetaJson: true },
  });

  return prisma.sessionPart.upsert({
    where: { sessionId_partType: { sessionId: input.access.sessionRow.id, partType: input.partType } },
    update: {
      sourceType: ConversationSourceType.AUDIO,
      status: SessionPartStatus.TRANSCRIBING,
      fileName: `${input.partType.toLowerCase()}-live.webm`,
      mimeType: input.mimeType,
      storageUrl: input.manifestPath,
      qualityMetaJson: toSessionPartMetaJson(existingPart?.qualityMetaJson, {
        pipelineStage: "TRANSCRIBING",
        uploadMode: "direct_recording",
        lastQueuedAt: new Date().toISOString(),
        liveTranscription: true,
        liveChunkCount: input.progress.chunkCount,
        liveReadyChunkCount: input.progress.readyChunkCount,
        liveErrorChunkCount: input.progress.errorChunkCount,
        liveDurationSeconds: Math.round(input.progress.totalDurationMs / 1000),
      }),
      transcriptExpiresAt: input.expiresAt,
    },
    create: {
      sessionId: input.access.sessionRow.id,
      partType: input.partType,
      sourceType: ConversationSourceType.AUDIO,
      status: SessionPartStatus.TRANSCRIBING,
      fileName: `${input.partType.toLowerCase()}-live.webm`,
      mimeType: input.mimeType,
      byteSize: null,
      storageUrl: input.manifestPath,
      rawTextOriginal: "",
      rawTextCleaned: "",
      rawSegments: toPrismaJson([]),
      qualityMetaJson: toSessionPartMetaJson({}, {
        pipelineStage: "TRANSCRIBING",
        uploadMode: "direct_recording",
        lastQueuedAt: new Date().toISOString(),
        liveTranscription: true,
        liveChunkCount: input.progress.chunkCount,
        liveReadyChunkCount: input.progress.readyChunkCount,
        liveErrorChunkCount: input.progress.errorChunkCount,
        liveDurationSeconds: Math.round(input.progress.totalDurationMs / 1000),
      }),
      transcriptExpiresAt: input.expiresAt,
    },
  });
}

async function persistLiveFinalizedPart(input: {
  access: SessionPartAccessContext;
  partType: LiveFinalizeSubmissionBody["partType"];
  expiresAt: Date;
}) {
  const existingPart = await prisma.sessionPart.findUnique({
    where: { sessionId_partType: { sessionId: input.access.sessionRow.id, partType: input.partType } },
    select: { qualityMetaJson: true },
  });

  return prisma.sessionPart.upsert({
    where: { sessionId_partType: { sessionId: input.access.sessionRow.id, partType: input.partType } },
    update: {
      sourceType: ConversationSourceType.AUDIO,
      status: SessionPartStatus.TRANSCRIBING,
      qualityMetaJson: toSessionPartMetaJson(existingPart?.qualityMetaJson, {
        pipelineStage: "TRANSCRIBING",
        uploadMode: "direct_recording",
        lastAcceptedAt: new Date().toISOString(),
        lastQueuedAt: new Date().toISOString(),
      }),
      transcriptExpiresAt: input.expiresAt,
    },
    create: {
      sessionId: input.access.sessionRow.id,
      partType: input.partType,
      sourceType: ConversationSourceType.AUDIO,
      status: SessionPartStatus.TRANSCRIBING,
      fileName: `${input.partType.toLowerCase()}-live.webm`,
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
      transcriptExpiresAt: input.expiresAt,
    },
  });
}

export async function handleLiveChunkSubmission(input: {
  access: SessionPartAccessContext;
  submission: LiveChunkSubmissionFormData;
}) {
  const { access, submission } = input;

  if (!isLiveChunkUploadEnabled()) {
    return NextResponse.json(
      {
        error: "先行文字起こしは現在無効です。録音終了後の保存アップロードへ切り替えてください。",
        code: "live_chunk_upload_disabled",
      },
      { status: 409 }
    );
  }

  if (!submission.file) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!Number.isInteger(submission.sequence) || submission.sequence < 0) {
    return NextResponse.json({ error: "sequence is invalid" }, { status: 400 });
  }

  const maxDurationMs = getRecordingMaxDurationSeconds(access.sessionRow.type) * 1000;
  if (submission.startedAtMs + submission.durationMs > maxDurationMs) {
    return NextResponse.json(
      {
        error:
          access.sessionRow.type === "LESSON_REPORT"
            ? "指導報告の録音は各パート10分までです。録音を保存してから次へ進んでください。"
            : "面談の録音は60分までです。録音を保存してから次へ進んでください。",
        code: "recording_too_long",
        maxAllowedSeconds: Math.round(maxDurationMs / 1000),
      },
      { status: 422 }
    );
  }

  try {
    await verifyLockOrThrow(access, submission.lockToken);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "録音ロックの検証に失敗しました。", code: "recording_lock_invalid" },
      { status: 409 }
    );
  }

  const buffer = Buffer.from(await submission.file.arrayBuffer());
  const { manifestPath } = await appendLiveTranscriptionChunk({
    sessionId: access.sessionRow.id,
    partType: submission.partType,
    sequence: submission.sequence,
    fileName: submission.file.name,
    mimeType: submission.file.type || "audio/webm",
    buffer,
    startedAtMs: submission.startedAtMs,
    durationMs: submission.durationMs,
  });
  const progress = await getLiveTranscriptionProgress(access.sessionRow.id, submission.partType);
  const expiresAt = getAudioExpiryDate();

  await persistLiveTranscribingPart({
    access,
    partType: submission.partType,
    mimeType: submission.file.type || "audio/webm",
    manifestPath,
    progress,
    expiresAt,
  });

  if (shouldRunBackgroundJobsInline()) {
    void startLiveChunkTranscription(access.sessionRow.id, submission.partType, submission.sequence).catch((error) => {
      console.error("[POST /api/sessions/[id]/parts/live] Chunk transcription failed:", {
        sessionId: access.sessionRow.id,
        partType: submission.partType,
        sequence: submission.sequence,
        error: error?.message ?? String(error),
      });
    });
  }

  return NextResponse.json({
    ok: true,
    progress,
    partType: submission.partType,
    status: SessionPartStatus.TRANSCRIBING,
  });
}

export async function handleFinalizeLiveSessionPart(input: {
  access: SessionPartAccessContext;
  submission: LiveFinalizeSubmissionBody;
}) {
  const { access, submission } = input;

  if (!isLiveChunkUploadEnabled()) {
    return NextResponse.json(
      {
        error: "先行文字起こしは現在無効です。録音終了後の保存アップロードへ切り替えてください。",
        code: "live_chunk_upload_disabled",
      },
      { status: 409 }
    );
  }

  try {
    await verifyLockOrThrow(access, submission.lockToken);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "録音ロックの検証に失敗しました。", code: "recording_lock_invalid" },
      { status: 409 }
    );
  }

  const maxDurationMs = getRecordingMaxDurationSeconds(access.sessionRow.type) * 1000;
  const expiresAt = getAudioExpiryDate();
  const progress = await getLiveTranscriptionProgress(access.sessionRow.id, submission.partType);
  if (progress.totalDurationMs > maxDurationMs) {
    return NextResponse.json(
      {
        error:
          access.sessionRow.type === "LESSON_REPORT"
            ? "指導報告の録音は各パート10分までです。録音を分けて保存してください。"
            : "面談の録音は60分までです。録音を分けて保存してください。",
        code: "recording_too_long",
        maxAllowedSeconds: Math.round(maxDurationMs / 1000),
        durationSeconds: Math.round(progress.totalDurationMs / 1000),
      },
      { status: 422 }
    );
  }

  const part = await persistLiveFinalizedPart({
    access,
    partType: submission.partType,
    expiresAt,
  });

  const session = await updateSessionStatusFromParts(access.sessionRow.id);
  const workerWake = await dispatchLiveSessionPartJobs(access.sessionRow.id, part.id);

  return NextResponse.json({
    part,
    session,
    generationDeferred: true,
    workerWake,
  });
}
