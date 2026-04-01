import { NextResponse } from "next/server";
import { ConversationSourceType, SessionPartJobType, SessionPartStatus, SessionPartType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueSessionPartJob, processAllSessionPartJobs } from "@/lib/jobs/sessionPartJobs";
import {
  buildSummaryPreview,
  toSessionPartMetaJson,
} from "@/lib/session-part-meta";
import { saveSessionPartUpload } from "@/lib/session-part-storage";
import {
  updateSessionStatusFromParts,
} from "@/lib/session-service";
import {
  evaluateDurationGate,
  evaluateTranscriptSubstance,
  getRecordingMaxDurationSeconds,
  getAudioDurationSecondsFromBuffer,
} from "@/lib/recording/validation";
import {
  AUDIO_UPLOAD_EXTENSIONS_LABEL,
  SUPPORTED_AUDIO_UPLOAD_EXTENSIONS,
  buildUnsupportedAudioUploadErrorMessage,
  isSupportedAudioUpload,
} from "@/lib/audio-upload-support";
import { releaseRecordingLock, verifyRecordingLockForAudioUpload } from "@/lib/recording/lockService";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { toPrismaJson } from "@/lib/prisma-json";
import { getAudioExpiryDate, getTranscriptExpiryDate } from "@/lib/system-config";
import { preprocessTranscript } from "@/lib/transcript/preprocess";
import { ensureSessionPartReviewedTranscript } from "@/lib/transcript/review";

function parsePartType(raw: string | null) {
  if (raw === SessionPartType.CHECK_IN) return SessionPartType.CHECK_IN;
  if (raw === SessionPartType.CHECK_OUT) return SessionPartType.CHECK_OUT;
  if (raw === SessionPartType.TEXT_NOTE) return SessionPartType.TEXT_NOTE;
  return SessionPartType.FULL;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  let audioLockToken: string | null = null;
  let audioStudentId: string | null = null;
  let audioUserId: string | null = null;

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

    const formData = await request.formData();
    const partType = parsePartType((formData.get("partType") as string | null) ?? null);
    const transcript = (formData.get("transcript") as string | null)?.trim() ?? "";
    const file = formData.get("file") as File | null;
    const lockTokenRaw = (formData.get("lockToken") as string | null)?.trim() ?? "";

    if (!file && !transcript) {
      return NextResponse.json({ error: "file or transcript is required" }, { status: 400 });
    }

    if (file) {
      if (!lockTokenRaw) {
        return NextResponse.json(
          {
            error: "録音ロックが必要です。画面を更新してから、録音の開始からやり直してください。",
            code: "recording_lock_required",
          },
          { status: 409 }
        );
      }
      const ok = await verifyRecordingLockForAudioUpload({
        studentId: sessionRow.studentId,
        userId: sessionAuth.user.id,
        plainToken: lockTokenRaw,
      });
      if (!ok) {
        return NextResponse.json(
          {
            error:
              "録音ロックが無効です。他のユーザーが録音中か、ロックの期限が切れた可能性があります。",
            code: "recording_lock_invalid",
          },
          { status: 409 }
        );
      }
      audioLockToken = lockTokenRaw;
      audioStudentId = sessionRow.studentId;
      audioUserId = sessionAuth.user.id;
      if (!isSupportedAudioUpload({ fileName: file.name, mimeType: file.type })) {
        return NextResponse.json(
          {
            error: buildUnsupportedAudioUploadErrorMessage(),
            code: "unsupported_audio_format",
            supportedExtensions: SUPPORTED_AUDIO_UPLOAD_EXTENSIONS,
            supportedExtensionsLabel: AUDIO_UPLOAD_EXTENSIONS_LABEL,
          },
          { status: 415 }
        );
      }
    }

    let sourceType: ConversationSourceType = ConversationSourceType.MANUAL;
    let rawTextOriginal = transcript;
    let displayTranscript = transcript;
    let rawSegments: any[] = [];
    let qualityMeta: Record<string, unknown> = {};
    const expiresAt =
      file
        ? getAudioExpiryDate()
        : getTranscriptExpiryDate();

    if (file) {
      sourceType = ConversationSourceType.AUDIO;
      const buffer = Buffer.from(await file.arrayBuffer());
      const durationSec = await getAudioDurationSecondsFromBuffer(buffer, {
        fileName: file.name,
        mimeType: file.type,
      });
      const maxDurationSeconds = getRecordingMaxDurationSeconds(sessionRow.type);
      const maxLabel = sessionRow.type === "LESSON_REPORT" ? "10分" : "60分";
      const durationGate = evaluateDurationGate(durationSec, {
        maxSeconds: maxDurationSeconds,
        rejectUnknown: true,
        tooLongMessageJa:
          sessionRow.type === "LESSON_REPORT"
            ? `指導報告のチェックイン / チェックアウト音声は1回${maxLabel}までです。音声を分割して保存してください。`
            : `面談音声は1回${maxLabel}までです。音声を分割して保存してください。`,
        unknownMessageJa:
          sessionRow.type === "LESSON_REPORT"
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
      const stored = await saveSessionPartUpload({
        sessionId: params.id,
        partType,
        fileName: file.name,
        buffer,
      });
      qualityMeta = {
        pipelineStage: "TRANSCRIBING",
        uploadMode: "file_upload",
        lastAcceptedAt: new Date().toISOString(),
        lastQueuedAt: new Date().toISOString(),
        uploadedFileName: file.name,
        uploadedMimeType: file.type,
        uploadedBytes: stored.byteSize,
        audioDurationSeconds: durationGate.durationSeconds,
        durationGateSkipped: durationGate.skippedReason ?? null,
        transcriptionPhase: "TRANSCRIBING_LOCAL",
        transcriptionPhaseUpdatedAt: new Date().toISOString(),
        sttEngine: "faster-whisper",
      };

      const part = await prisma.sessionPart.upsert({
        where: {
          sessionId_partType: {
            sessionId: params.id,
            partType,
          },
        },
        update: {
          sourceType,
          status: SessionPartStatus.TRANSCRIBING,
          fileName: file.name,
          mimeType: file.type || null,
          byteSize: stored.byteSize,
          storageUrl: stored.storageUrl,
          rawTextOriginal: "",
          rawTextCleaned: "",
          reviewedText: null,
          reviewState: "NONE",
          rawSegments: toPrismaJson([]),
          qualityMetaJson: toSessionPartMetaJson({}, qualityMeta as any),
          transcriptExpiresAt: expiresAt,
        },
        create: {
          sessionId: params.id,
          partType,
          sourceType,
          status: SessionPartStatus.TRANSCRIBING,
          fileName: file.name,
          mimeType: file.type || null,
          byteSize: stored.byteSize,
          storageUrl: stored.storageUrl,
          rawTextOriginal: "",
          rawTextCleaned: "",
          reviewedText: null,
          reviewState: "NONE",
          rawSegments: toPrismaJson([]),
          qualityMetaJson: toSessionPartMetaJson({}, qualityMeta as any),
          transcriptExpiresAt: expiresAt,
        },
      });

      const session = await updateSessionStatusFromParts(params.id);
      await enqueueSessionPartJob(part.id, SessionPartJobType.TRANSCRIBE_FILE);
      void processAllSessionPartJobs(params.id).catch((error) => {
        console.error("[POST /api/sessions/[id]/parts] Background session part processing failed:", error);
      });

      return NextResponse.json({
        ok: true,
        accepted: true,
        generationDeferred: true,
        part,
        session,
      });
    } else {
      const pre = preprocessTranscript(transcript);
      rawTextOriginal = pre.rawTextOriginal;
      displayTranscript = pre.displayTranscript;
      qualityMeta = {
        inputMode: "manual",
        pipelineStage: "READY",
        uploadMode: "manual",
        lastAcceptedAt: new Date().toISOString(),
        summaryPreview: buildSummaryPreview(pre.displayTranscript || pre.rawTextOriginal),
      };
    }

    const substance = evaluateTranscriptSubstance(displayTranscript || rawTextOriginal);
    if (!substance.ok) {
      const rejectedPart = await prisma.sessionPart.upsert({
        where: {
          sessionId_partType: {
            sessionId: params.id,
            partType,
          },
        },
        update: {
          sourceType,
          status: SessionPartStatus.ERROR,
          fileName: null,
          mimeType: null,
          byteSize: null,
          rawTextOriginal,
          rawTextCleaned: displayTranscript,
          reviewedText: null,
          reviewState: "REQUIRED",
          rawSegments: toPrismaJson(rawSegments),
          qualityMetaJson: toSessionPartMetaJson(qualityMeta, {
            validationRejection: {
              code: substance.code,
              messageJa: substance.messageJa,
              metrics: substance.metrics,
              at: new Date().toISOString(),
            },
            pipelineStage: "REJECTED",
          }),
          transcriptExpiresAt: expiresAt,
        },
        create: {
          sessionId: params.id,
          partType,
          sourceType,
          status: SessionPartStatus.ERROR,
          fileName: null,
          mimeType: null,
          byteSize: null,
          rawTextOriginal,
          rawTextCleaned: displayTranscript,
          reviewedText: null,
          reviewState: "REQUIRED",
          rawSegments: toPrismaJson(rawSegments),
          qualityMetaJson: toSessionPartMetaJson(qualityMeta, {
            validationRejection: {
              code: substance.code,
              messageJa: substance.messageJa,
              metrics: substance.metrics,
              at: new Date().toISOString(),
            },
            pipelineStage: "REJECTED",
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
      where: {
        sessionId_partType: {
          sessionId: params.id,
          partType,
        },
      },
      update: {
        sourceType,
        status: SessionPartStatus.READY,
        fileName: null,
        mimeType: null,
        byteSize: null,
        rawTextOriginal,
        rawTextCleaned: displayTranscript,
        reviewedText: null,
        reviewState: "NONE",
        rawSegments: toPrismaJson(rawSegments),
        qualityMetaJson: toSessionPartMetaJson(qualityMeta, {
          pipelineStage: "READY",
          summaryPreview: buildSummaryPreview(displayTranscript || rawTextOriginal),
        }),
        transcriptExpiresAt: expiresAt,
      },
      create: {
        sessionId: params.id,
        partType,
        sourceType,
        status: SessionPartStatus.READY,
        fileName: null,
        mimeType: null,
        byteSize: null,
        rawTextOriginal,
        rawTextCleaned: displayTranscript,
        reviewedText: null,
        reviewState: "NONE",
        rawSegments: toPrismaJson(rawSegments),
        qualityMetaJson: toSessionPartMetaJson(qualityMeta, {
          pipelineStage: "READY",
          summaryPreview: buildSummaryPreview(displayTranscript || rawTextOriginal),
        }),
        transcriptExpiresAt: expiresAt,
      },
    });

    await ensureSessionPartReviewedTranscript(part.id);

    const session = await updateSessionStatusFromParts(params.id);
    await enqueueSessionPartJob(part.id, SessionPartJobType.PROMOTE_SESSION);
    void processAllSessionPartJobs(params.id).catch((error) => {
      console.error("[POST /api/sessions/[id]/parts] Background session part promotion failed:", error);
    });

    return NextResponse.json({
      part,
      session,
      generationDeferred: true,
    });
  } catch (error: any) {
    console.error("[POST /api/sessions/[id]/parts] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
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
