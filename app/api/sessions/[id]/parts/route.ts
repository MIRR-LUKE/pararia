import { NextResponse } from "next/server";
import { ConversationSourceType, SessionPartStatus, SessionPartType } from "@prisma/client";
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
  try {
    const formData = await request.formData();
    const partType = parsePartType((formData.get("partType") as string | null) ?? null);
    const transcript = (formData.get("transcript") as string | null)?.trim() ?? "";
    const file = formData.get("file") as File | null;

    if (!file && !transcript) {
      return NextResponse.json({ error: "file or transcript is required" }, { status: 400 });
    }

    let sourceType: ConversationSourceType = ConversationSourceType.MANUAL;
    let rawTextOriginal = transcript;
    let rawTextCleaned = transcript;
    let rawSegments: any[] = [];
    let qualityMeta: Record<string, unknown> = {};

    if (file) {
      sourceType = ConversationSourceType.AUDIO;
      const buffer = Buffer.from(await file.arrayBuffer());
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
      };
    } else {
      const pre = preprocessTranscript(transcript);
      rawTextOriginal = pre.rawTextOriginal;
      rawTextCleaned = pre.rawTextCleaned;
      qualityMeta = {
        inputMode: "manual",
      };
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
  }
}
