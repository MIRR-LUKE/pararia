import { NextResponse } from "next/server";
import { ConversationSourceType, SessionPartStatus, SessionPartType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { transcribeAudioForPipeline } from "@/lib/ai/stt";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "@/lib/transcript/preprocess";
import {
  ensureConversationForSession,
  updateSessionStatusFromParts,
} from "@/lib/session-service";
import {
  enqueueConversationJobs,
  processAllConversationJobs,
} from "@/lib/jobs/conversationJobs";
import {
  evaluateDurationGate,
  evaluateTranscriptSubstance,
  getAudioDurationSecondsFromBuffer,
} from "@/lib/recording/validation";
import { releaseRecordingLock, verifyRecordingLockForAudioUpload } from "@/lib/recording/lockService";

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
    }

    let sourceType: ConversationSourceType = ConversationSourceType.MANUAL;
    let rawTextOriginal = transcript;
    let rawTextCleaned = transcript;
    let rawSegments: any[] = [];
    let qualityMeta: Record<string, unknown> = {};

    if (file) {
      sourceType = ConversationSourceType.AUDIO;
      const buffer = Buffer.from(await file.arrayBuffer());
      const durationSec = await getAudioDurationSecondsFromBuffer(buffer);
      const durationGate = evaluateDurationGate(durationSec);
      if (!durationGate.ok) {
        return NextResponse.json(
          {
            error: durationGate.messageJa,
            code: durationGate.code,
            durationSeconds: durationGate.durationSeconds,
            minRequiredSeconds: "minRequiredSeconds" in durationGate ? durationGate.minRequiredSeconds : undefined,
          },
          { status: 422 }
        );
      }

      const sttStart = Date.now();
      const stt = await transcribeAudioForPipeline({
        buffer,
        filename: file.name,
        mimeType: file.type,
        language: "ja",
      });
      const pre =
        stt.segments.length > 0
          ? preprocessTranscriptWithSegments(stt.rawTextOriginal, stt.segments ?? [])
          : preprocessTranscript(stt.rawTextOriginal);
      rawTextOriginal = pre.rawTextOriginal;
      rawTextCleaned = pre.rawTextCleaned;
      rawSegments = stt.segments ?? [];
      qualityMeta = {
        sttSeconds: Math.round((Date.now() - sttStart) / 1000),
        sttModel: stt.meta.model,
        sttResponseFormat: stt.meta.responseFormat,
        sttFallbackUsed: stt.meta.fallbackUsed,
        uploadedFileName: file.name,
        uploadedMimeType: file.type,
        uploadedBytes: file.size,
        audioDurationSeconds: durationGate.durationSeconds,
        durationGateSkipped: durationGate.skippedReason ?? null,
      };
    } else {
      const pre = preprocessTranscript(transcript);
      rawTextOriginal = pre.rawTextOriginal;
      rawTextCleaned = pre.rawTextCleaned;
      qualityMeta = {
        inputMode: "manual",
      };
    }

    const substance = evaluateTranscriptSubstance(rawTextCleaned || rawTextOriginal);
    if (!substance.ok) {
      const expiresAtThin = new Date();
      expiresAtThin.setDate(expiresAtThin.getDate() + 30);

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
          fileName: file?.name ?? null,
          mimeType: file?.type ?? null,
          byteSize: file?.size ?? null,
          rawTextOriginal,
          rawTextCleaned,
          rawSegments: rawSegments as any,
          qualityMetaJson: {
            ...qualityMeta,
            validationRejection: {
              code: substance.code,
              messageJa: substance.messageJa,
              metrics: substance.metrics,
              at: new Date().toISOString(),
            },
          } as any,
          transcriptExpiresAt: expiresAtThin,
        },
        create: {
          sessionId: params.id,
          partType,
          sourceType,
          status: SessionPartStatus.ERROR,
          fileName: file?.name ?? null,
          mimeType: file?.type ?? null,
          byteSize: file?.size ?? null,
          rawTextOriginal,
          rawTextCleaned,
          rawSegments: rawSegments as any,
          qualityMetaJson: {
            ...qualityMeta,
            validationRejection: {
              code: substance.code,
              messageJa: substance.messageJa,
              metrics: substance.metrics,
              at: new Date().toISOString(),
            },
          } as any,
          transcriptExpiresAt: expiresAtThin,
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

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

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
        fileName: file?.name ?? null,
        mimeType: file?.type ?? null,
        byteSize: file?.size ?? null,
        rawTextOriginal,
        rawTextCleaned,
        rawSegments: rawSegments as any,
        qualityMetaJson: qualityMeta as any,
        transcriptExpiresAt: expiresAt,
      },
      create: {
        sessionId: params.id,
        partType,
        sourceType,
        status: SessionPartStatus.READY,
        fileName: file?.name ?? null,
        mimeType: file?.type ?? null,
        byteSize: file?.size ?? null,
        rawTextOriginal,
        rawTextCleaned,
        rawSegments: rawSegments as any,
        qualityMetaJson: qualityMeta as any,
        transcriptExpiresAt: expiresAt,
      },
    });

    const session = await updateSessionStatusFromParts(params.id);

    let conversationId: string | null = null;
    if (session && session.status === "PROCESSING") {
      conversationId = await ensureConversationForSession(params.id);
      await enqueueConversationJobs(conversationId);
      void processAllConversationJobs(conversationId).catch((error) => {
        console.error("[POST /api/sessions/[id]/parts] Background processing failed:", error);
      });
    }

    return NextResponse.json({
      part,
      session,
      conversationId,
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
