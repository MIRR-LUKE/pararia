import { NextResponse } from "next/server";
import {
  ConversationSourceType,
  SessionPartJobType,
  SessionPartStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { runWithDatabaseRetry } from "@/lib/db-retry";
import { AUDIO_UPLOAD_EXTENSIONS_LABEL, SUPPORTED_AUDIO_UPLOAD_EXTENSIONS, buildUnsupportedAudioUploadErrorMessage, isSupportedAudioUpload, isSupportedRecordedAudio } from "@/lib/audio-upload-support";
import { getAudioDurationSecondsFromBuffer, evaluateDurationGate, evaluateTranscriptSubstance, getRecordingMaxDurationSeconds } from "@/lib/recording/validation";
import { verifyRecordingLockForAudioUpload, releaseRecordingLock } from "@/lib/recording/lockService";
import { getExternalWorkerAudioStorageError, shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { enqueueSessionPartJob, processAllSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { API_THROTTLE_RULES, ApiQuotaExceededError, consumeApiQuota } from "@/lib/api-throttle";
import { consumeCompletedBlobUploadReservation } from "@/lib/blob-upload-reservations";
import { saveSessionPartUpload } from "@/lib/session-part-storage";
import { buildSummaryPreview, toSessionPartMetaJson } from "@/lib/session-part-meta";
import { preprocessTranscript } from "@/lib/transcript/preprocess";
import { getAudioExpiryDate, getTranscriptExpiryDate } from "@/lib/system-config";
import { enqueueStorageDeletions } from "@/lib/storage-deletion-queue";
import { updateSessionStatusFromParts } from "@/lib/session-service";
import { runAfterResponse } from "@/lib/server/after-response";
import { toPrismaJson } from "@/lib/prisma-json";
import type { SessionPartAccessContext, SessionPartSubmissionFormData } from "./session-part-route-common";

type AudioSessionPartSubmissionResult = {
  audioLockToken: string | null;
  audioStudentId: string | null;
  audioUserId: string | null;
  response?: NextResponse;
};

async function dispatchAudioSessionPartJobs(sessionId: string, partId: string) {
  await enqueueSessionPartJob(partId, SessionPartJobType.TRANSCRIBE_FILE);

  if (shouldRunBackgroundJobsInline()) {
    void processAllSessionPartJobs(sessionId).catch((error) => {
      console.error("[POST /api/sessions/[id]/parts] Background session part processing failed:", error);
    });
  } else {
    runAfterResponse(async () => {
      await maybeEnsureRunpodWorker()
        .then((workerWake) => {
        if (workerWake?.attempted && !workerWake.ok) {
          console.error("[POST /api/sessions/[id]/parts] Runpod worker wake failed:", workerWake);
        }
      })
        .catch((error) => {
          console.error("[POST /api/sessions/[id]/parts] Runpod worker wake threw:", error);
        });
    }, "POST /api/sessions/[id]/parts wake runpod");
  }

  return null;
}

type TextSessionPartDispatchDeps = {
  enqueueSessionPartJob?: typeof enqueueSessionPartJob;
};

export async function dispatchTextSessionPartJobs(
  _sessionId: string,
  partId: string,
  deps: TextSessionPartDispatchDeps = {}
) {
  const enqueue = deps.enqueueSessionPartJob ?? enqueueSessionPartJob;

  await enqueue(partId, SessionPartJobType.PROMOTE_SESSION);

  return {
    mode: "external" as const,
    workerWake: null,
  };
}

async function persistAudioSessionPart(input: {
  sessionId: string;
  partType: SessionPartSubmissionFormData["partType"];
  sourceType: ConversationSourceType;
  fileName: string;
  mimeType: string;
  storageUrl: string;
  byteSize: number | null;
  qualityMeta: Record<string, unknown>;
  transcriptExpiresAt: Date;
}) {
  return runWithDatabaseRetry(
    "persist-audio-session-part",
    () =>
      prisma.$transaction(
        async (tx) => {
          const existing = await tx.sessionPart.findUnique({
            where: {
              sessionId_partType: {
                sessionId: input.sessionId,
                partType: input.partType,
              },
            },
            select: {
              id: true,
              storageUrl: true,
            },
          });

          const data = {
            sourceType: input.sourceType,
            status: SessionPartStatus.TRANSCRIBING,
            fileName: input.fileName,
            mimeType: input.mimeType || null,
            byteSize: input.byteSize,
            storageUrl: input.storageUrl,
            rawTextOriginal: "",
            rawTextCleaned: "",
            reviewedText: null,
            reviewState: "NONE" as const,
            rawSegments: toPrismaJson([]),
            qualityMetaJson: toSessionPartMetaJson({}, input.qualityMeta as any),
            transcriptExpiresAt: input.transcriptExpiresAt,
          };

          const part = existing
            ? await tx.sessionPart.update({
                where: { id: existing.id },
                data,
              })
            : await tx.sessionPart.create({
                data: {
                  sessionId: input.sessionId,
                  partType: input.partType,
                  ...data,
                },
              });

          return {
            part,
            replacedStorageUrls:
              existing?.storageUrl && existing.storageUrl !== input.storageUrl ? [existing.storageUrl] : [],
          };
        },
        { maxWait: 5_000, timeout: 15_000 }
      ),
    { retries: 3, initialDelayMs: 150 }
  );
}

async function persistTextSessionPart(input: {
  sessionId: string;
  partType: SessionPartSubmissionFormData["partType"];
  sourceType: ConversationSourceType;
  rawTextOriginal: string;
  rawTextCleaned: string;
  reviewedText: string | null;
  reviewState: "NONE" | "REQUIRED";
  rawSegments: any[];
  qualityMeta: Record<string, unknown>;
  transcriptExpiresAt: Date;
  status: "READY" | "ERROR";
}) {
  return runWithDatabaseRetry(
    "persist-text-session-part",
    () =>
      prisma.$transaction(
        async (tx) => {
          const existing = await tx.sessionPart.findUnique({
            where: {
              sessionId_partType: {
                sessionId: input.sessionId,
                partType: input.partType,
              },
            },
            select: {
              id: true,
              storageUrl: true,
            },
          });

          const data = {
            sourceType: input.sourceType,
            status: input.status,
            fileName: null,
            mimeType: null,
            byteSize: null,
            storageUrl: null,
            rawTextOriginal: input.rawTextOriginal,
            rawTextCleaned: input.rawTextCleaned,
            reviewedText: input.reviewedText,
            reviewState: input.reviewState,
            rawSegments: toPrismaJson(input.rawSegments),
            qualityMetaJson: toSessionPartMetaJson({}, input.qualityMeta as any),
            transcriptExpiresAt: input.transcriptExpiresAt,
          };

          const part = existing
            ? await tx.sessionPart.update({
                where: { id: existing.id },
                data,
              })
            : await tx.sessionPart.create({
                data: {
                  sessionId: input.sessionId,
                  partType: input.partType,
                  ...data,
                },
              });

          return {
            part,
            replacedStorageUrls: existing?.storageUrl ? [existing.storageUrl] : [],
          };
        },
        { maxWait: 5_000, timeout: 15_000 }
      ),
    { retries: 3, initialDelayMs: 150 }
  );
}

async function handleAudioSessionPartSubmission(input: {
  access: SessionPartAccessContext;
  submission: SessionPartSubmissionFormData;
}) {
  let audioLockToken: string | null = null;
  let audioStudentId: string | null = null;
  let audioUserId: string | null = null;

  try {
    const { access, submission } = input;
    const externalWorkerAudioStorageError = getExternalWorkerAudioStorageError();
    if (externalWorkerAudioStorageError) {
      return NextResponse.json(
        {
          error: externalWorkerAudioStorageError,
          code: "runpod_blob_storage_required",
        },
        { status: 409 }
      );
    }

    if (!submission.lockToken) {
      return NextResponse.json(
        {
          error: "録音ロックが必要です。画面を更新してから、録音の開始からやり直してください。",
          code: "recording_lock_required",
        },
        { status: 409 }
      );
    }

    const lockOk = await verifyRecordingLockForAudioUpload({
      studentId: access.sessionRow.studentId,
      userId: access.sessionAuth.user.id,
      plainToken: submission.lockToken,
    });
    if (!lockOk) {
      return NextResponse.json(
        {
          error:
            "録音ロックが無効です。他のユーザーが録音中か、ロックの期限が切れた可能性があります。",
          code: "recording_lock_invalid",
        },
        { status: 409 }
      );
    }
    audioLockToken = submission.lockToken;
    audioStudentId = access.sessionRow.studentId;
    audioUserId = access.sessionAuth.user.id;

    const audioFileName = submission.file?.name || submission.uploadedFileName;
    const audioMimeType = submission.file?.type || submission.uploadedMimeType;
    const isAcceptedAudio =
      submission.uploadSource === "direct_recording"
        ? isSupportedRecordedAudio({ fileName: audioFileName, mimeType: audioMimeType })
        : isSupportedAudioUpload({ fileName: audioFileName, mimeType: audioMimeType });
    if (!isAcceptedAudio) {
      return NextResponse.json(
        {
          error:
            submission.uploadSource === "direct_recording"
              ? "録音データの形式を読み取れませんでした。ブラウザを変えるか、音声ファイルアップロードをお試しください。"
              : buildUnsupportedAudioUploadErrorMessage(),
          code: "unsupported_audio_format",
          supportedExtensions: SUPPORTED_AUDIO_UPLOAD_EXTENSIONS,
          supportedExtensionsLabel: AUDIO_UPLOAD_EXTENSIONS_LABEL,
        },
        { status: 415 }
      );
    }

    let stored: { storageUrl: string; fileName?: string; byteSize: number | null };
    let durationGateSkipped: string | null = null;
    let durationSeconds: number | null = null;
    const expiresAt = getAudioExpiryDate();
    if (submission.file) {
      const buffer = Buffer.from(await submission.file.arrayBuffer());
      const maxDurationSeconds = getRecordingMaxDurationSeconds(access.sessionRow.type);
      const maxLabel = access.sessionRow.type === "LESSON_REPORT" ? "10分" : "60分";
      const parsedDurationSeconds = await getAudioDurationSecondsFromBuffer(buffer, {
        fileName: audioFileName,
        mimeType: audioMimeType,
      });
      durationSeconds =
        parsedDurationSeconds !== null && submission.durationSecondsHint !== null
          ? Math.max(parsedDurationSeconds, submission.durationSecondsHint)
          : parsedDurationSeconds ?? submission.durationSecondsHint;
      const durationGate = evaluateDurationGate(durationSeconds, {
        maxSeconds: maxDurationSeconds,
        rejectUnknown: true,
        tooLongMessageJa:
          access.sessionRow.type === "LESSON_REPORT"
            ? `指導報告のチェックイン / チェックアウト音声は1回${maxLabel}までです。音声を分割して保存してください。`
            : `面談音声は1回${maxLabel}までです。音声を分割して保存してください。`,
        unknownMessageJa:
          access.sessionRow.type === "LESSON_REPORT"
            ? "指導報告音声の長さを確認できませんでした。10分以内のファイルを選び直してください。"
            : "面談音声の長さを確認できませんでした。60分以内のファイルを選び直してください。",
      });
      if (!durationGate.ok) {
        return NextResponse.json(
          {
            error: durationGate.messageJa,
            code: durationGate.code,
            durationSeconds: durationGate.durationSeconds,
            minRequiredSeconds: "minRequiredSeconds" in durationGate ? durationGate.minRequiredSeconds : undefined,
            maxAllowedSeconds: "maxAllowedSeconds" in durationGate ? durationGate.maxAllowedSeconds : undefined,
          },
          { status: 422 }
        );
      }

      stored = await saveSessionPartUpload({
        sessionId: access.sessionRow.id,
        partType: submission.partType,
        fileName: audioFileName,
        buffer,
        contentType: audioMimeType,
      });
    } else {
      let reservation;
      try {
        reservation = await consumeCompletedBlobUploadReservation({
          organizationId: access.sessionAuth.user.organizationId,
          sessionId: access.sessionRow.id,
          partType: submission.partType,
          pathname: submission.blobPathname,
        });
      } catch (error: any) {
        return NextResponse.json(
          { error: error?.message ?? "アップロード済み音声の予約確認に失敗しました。" },
          { status: 409 }
        );
      }

      stored = {
        storageUrl: reservation.blobUrl!,
        fileName: reservation.expectedFileName || audioFileName,
        byteSize:
          Number.isFinite(reservation.blobByteSize ?? NaN) && (reservation.blobByteSize ?? 0) > 0
            ? reservation.blobByteSize
            : submission.uploadedByteSize,
      };
      if (reservation.blobContentType?.trim()) {
        submission.uploadedMimeType = reservation.blobContentType.trim();
      }
      durationSeconds = submission.durationSecondsHint;
      durationGateSkipped = "blob_client_upload_pending_worker_validation";
    }

    const qualityMeta = {
      pipelineStage: "TRANSCRIBING",
      uploadMode: submission.uploadSource === "direct_recording" ? "direct_recording" : "file_upload",
      captureSource: submission.uploadSource,
      lastAcceptedAt: new Date().toISOString(),
      lastQueuedAt: new Date().toISOString(),
      uploadedFileName: stored.fileName || audioFileName,
      uploadedMimeType: submission.file ? audioMimeType : submission.uploadedMimeType || audioMimeType,
      uploadedBytes: stored.byteSize,
      audioDurationSeconds: durationSeconds,
      audioDurationSecondsSource:
        submission.durationSecondsHint !== null && durationSeconds === submission.durationSecondsHint
          ? "client_hint"
          : "metadata",
      durationGateSkipped,
      transcriptionPhase: "PREPARING_STT",
      transcriptionPhaseUpdatedAt: new Date().toISOString(),
      sttEngine: "faster-whisper",
    };

    const persisted = await persistAudioSessionPart({
      sessionId: access.sessionRow.id,
      partType: submission.partType,
      sourceType: ConversationSourceType.AUDIO,
      fileName: stored.fileName || audioFileName,
      mimeType: submission.file ? audioMimeType : submission.uploadedMimeType || audioMimeType,
      storageUrl: stored.storageUrl,
      byteSize: stored.byteSize,
      qualityMeta,
      transcriptExpiresAt: expiresAt,
    });
    if (persisted.replacedStorageUrls.length > 0) {
      await enqueueStorageDeletions({
        storageUrls: persisted.replacedStorageUrls,
        organizationId: access.sessionAuth.user.organizationId,
        reason: "session_part_replaced",
      });
    }

    const session = await updateSessionStatusFromParts(access.sessionRow.id);
    const workerWake = await dispatchAudioSessionPartJobs(access.sessionRow.id, persisted.part.id);

    return NextResponse.json({
      ok: true,
      accepted: true,
      generationDeferred: true,
      part: persisted.part,
      session,
      workerWake,
    });
  } finally {
    if (audioLockToken && audioStudentId && audioUserId) {
      await releaseRecordingLock({
        studentId: audioStudentId,
        userId: audioUserId,
        plainToken: audioLockToken,
      }).catch(() => {});
    }
  }
}

async function handleTextSessionPartSubmission(input: {
  access: SessionPartAccessContext;
  submission: SessionPartSubmissionFormData;
}) {
  const { access, submission } = input;
  const pre = preprocessTranscript(submission.transcript);
  const rawTextOriginal = pre.rawTextOriginal;
  const displayTranscript = pre.displayTranscript;
  const qualityMeta = {
    inputMode: "manual",
    pipelineStage: "READY",
    uploadMode: "manual",
    lastAcceptedAt: new Date().toISOString(),
    summaryPreview: buildSummaryPreview(pre.displayTranscript || pre.rawTextOriginal),
  };

  const substance = evaluateTranscriptSubstance(displayTranscript || rawTextOriginal);
  if (!substance.ok) {
    const rejectedPart = await persistTextSessionPart({
      sessionId: access.sessionRow.id,
      partType: submission.partType,
      sourceType: ConversationSourceType.MANUAL,
      rawTextOriginal,
      rawTextCleaned: displayTranscript,
      reviewedText: null,
      reviewState: "REQUIRED",
      rawSegments: [],
      qualityMeta: {
        ...qualityMeta,
        validationRejection: {
          code: substance.code,
          messageJa: substance.messageJa,
          metrics: substance.metrics,
          at: new Date().toISOString(),
        },
        pipelineStage: "REJECTED",
      },
      transcriptExpiresAt: getTranscriptExpiryDate(),
      status: SessionPartStatus.ERROR,
    });
    if (rejectedPart.replacedStorageUrls.length > 0) {
      await enqueueStorageDeletions({
        storageUrls: rejectedPart.replacedStorageUrls,
        organizationId: access.sessionAuth.user.organizationId,
        reason: "session_part_replaced_with_invalid_text",
      });
    }

    await updateSessionStatusFromParts(access.sessionRow.id);

    return NextResponse.json(
      {
        error: substance.messageJa,
        code: substance.code,
        part: rejectedPart.part,
        metrics: substance.metrics,
      },
      { status: 422 }
    );
  }

  const persisted = await persistTextSessionPart({
    sessionId: access.sessionRow.id,
    partType: submission.partType,
    sourceType: ConversationSourceType.MANUAL,
    rawTextOriginal,
    rawTextCleaned: displayTranscript,
    reviewedText: null,
    reviewState: "NONE",
    rawSegments: [],
    qualityMeta: {
      ...qualityMeta,
      pipelineStage: "READY",
      summaryPreview: buildSummaryPreview(displayTranscript || rawTextOriginal),
    },
    transcriptExpiresAt: getTranscriptExpiryDate(),
    status: SessionPartStatus.READY,
  });
  if (persisted.replacedStorageUrls.length > 0) {
    await enqueueStorageDeletions({
      storageUrls: persisted.replacedStorageUrls,
      organizationId: access.sessionAuth.user.organizationId,
      reason: "session_part_replaced_with_text",
    });
  }

  const session = await updateSessionStatusFromParts(access.sessionRow.id);
  const generationDispatch = await dispatchTextSessionPartJobs(access.sessionRow.id, persisted.part.id);

  return NextResponse.json({
    part: persisted.part,
    session,
    generationDeferred: true,
    generationDispatch,
  });
}

export async function handleSessionPartSubmission(input: {
  access: SessionPartAccessContext;
  submission: SessionPartSubmissionFormData;
}) {
  const { access, submission } = input;

  if (!submission.file && !submission.hasBlobUpload && !submission.transcript) {
    return NextResponse.json({ error: "file or transcript is required" }, { status: 400 });
  }
  if (submission.file && submission.hasBlobUpload) {
    return NextResponse.json({ error: "file and blob upload cannot be sent together" }, { status: 400 });
  }

  if (submission.file || submission.hasBlobUpload) {
    try {
      const byteSize =
        submission.file?.size ??
        (Number.isFinite(submission.uploadedByteSize ?? NaN) ? Math.max(0, submission.uploadedByteSize ?? 0) : 0);
      await consumeApiQuota({
        scope: "session_part:user",
        rawKey: access.sessionAuth.user.id,
        bytes: byteSize,
        rule: API_THROTTLE_RULES.sessionPartUser,
      });
      await consumeApiQuota({
        scope: "session_part:org",
        rawKey: access.sessionAuth.user.organizationId,
        bytes: byteSize,
        rule: API_THROTTLE_RULES.sessionPartOrg,
      });
    } catch (error) {
      if (error instanceof ApiQuotaExceededError) {
        return NextResponse.json(
          {
            error: error.message,
            retryAfterSeconds: error.retryAfterSeconds,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(error.retryAfterSeconds),
            },
          }
        );
      }
      throw error;
    }
  }

  if (submission.file || submission.hasBlobUpload) {
    return handleAudioSessionPartSubmission(input);
  }

  return handleTextSessionPartSubmission(input);
}
