import { NextResponse } from "next/server";
import { transcribeAudioVerbose } from "@/lib/ai/stt";
import { ConversationSourceType, ConversationStatus } from "@prisma/client";
import { preprocessTranscriptWithSegments } from "@/lib/transcript/preprocess";
import { prisma } from "@/lib/db";
import { enqueueConversationJobs, processAllConversationJobs } from "@/lib/jobs/conversationJobs";
import type { ConversationQualityMeta } from "@/lib/types/conversation";
import { getPromptVersion } from "@/lib/ai/conversationPipeline";
import { ensureOrganizationId } from "@/lib/server/organization";

export async function POST(request: Request) {
  try {
    console.log("[POST /api/audio] Starting audio processing...");
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const studentId = formData.get("studentId") as string | null;
    const requestedOrganizationId = formData.get("organizationId") as string | null;
    const userId = (formData.get("userId") as string | null) ?? undefined;

    if (!file || !studentId) {
      console.error("[POST /api/audio] Missing required fields:", { file: !!file, studentId });
      return NextResponse.json(
        { error: "file and studentId are required" },
        { status: 400 }
      );
    }

    const organizationIdPromise = ensureOrganizationId(requestedOrganizationId);

    console.log("[POST /api/audio] Transcribing audio...", {
      filename: file.name,
      size: file.size,
      studentId,
      organizationId: requestedOrganizationId ?? "(default)",
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    console.log("[POST /api/audio] Audio file received:", {
      filename: file.name,
      size: file.size,
      mimeType: file.type,
    });

    const sttStart = Date.now();
    const stt = await transcribeAudioVerbose({
      buffer,
      filename: file.name,
      mimeType: file.type,
      language: "ja",
    });
    const sttSeconds = Math.round((Date.now() - sttStart) / 1000);

    // 音声データはテキスト化後、メモリから解放される（ファイルとして保存していない）
    // buffer はガベージコレクションで自動的に削除される
    console.log("[POST /api/audio] Transcript received, length:", stt.rawTextOriginal.length);
    console.log("[POST /api/audio] Audio buffer cleared from memory (not persisted to disk)");

    console.log("[POST /api/audio] Preprocessing transcript (non-LLM)...", {
      rawTextOriginalLength: stt.rawTextOriginal.length,
      segmentsCount: stt.segments?.length ?? 0,
    });
    const preprocessStart = Date.now();
    const pre = preprocessTranscriptWithSegments(stt.rawTextOriginal, stt.segments ?? []);
    const preprocessSeconds = Math.round((Date.now() - preprocessStart) / 1000);
    console.log("[POST /api/audio] Preprocessing complete:", {
      originalLength: pre.rawTextOriginal.length,
      cleanedLength: pre.rawTextCleaned.length,
      chunksCount: pre.chunks.length,
    });

    console.log("[POST /api/audio] Creating conversation log in DB (fast path)...", {
      organizationId: requestedOrganizationId ?? "(default)",
      studentId,
      userId: userId ?? "none",
      rawTextCleanedLength: pre.rawTextCleaned.length,
    });
    let conversation;
    try {
      const organizationId = await organizationIdPromise;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      const qualityMeta: ConversationQualityMeta = {
        sttSeconds,
        preprocessSeconds,
        promptVersion: getPromptVersion(),
        generatedAt: new Date().toISOString(),
      };
      conversation = await prisma.conversationLog.create({
        data: {
          organizationId,
          studentId,
          userId,
          sourceType: ConversationSourceType.AUDIO,
          status: ConversationStatus.PROCESSING,
          rawTextOriginal: pre.rawTextOriginal,
          rawTextCleaned: pre.rawTextCleaned,
          rawSegments: stt.segments ?? [],
          rawTextExpiresAt: expiresAt,
          qualityMetaJson: qualityMeta as any,
          // LLM outputs will be filled asynchronously
        },
      });
      console.log("[POST /api/audio] Conversation log created successfully:", {
        id: conversation.id,
        studentId: conversation.studentId,
      });
    } catch (dbError: any) {
      console.error("[POST /api/audio] DB create failed:", {
        error: dbError?.message,
        code: dbError?.code,
        meta: dbError?.meta,
        stack: dbError?.stack,
      });
      throw new Error(`データベース保存に失敗しました: ${dbError?.message ?? "unknown error"}`);
    }

    let jobs: Array<{ id: string; type: string; status: string }> = [];
    try {
      await enqueueConversationJobs(conversation.id);
      jobs = await prisma.conversationJob.findMany({
        where: { conversationId: conversation.id },
        select: { id: true, type: true, status: true },
      });

      // Start processing immediately to reduce first-byte-to-result latency.
      void processAllConversationJobs(conversation.id).catch((bgError) => {
        console.error("[POST /api/audio] Background job processing failed:", {
          conversationId: conversation.id,
          error: (bgError as any)?.message,
        });
      });

      console.log("[POST /api/audio] Conversation log created, jobs enqueued:", {
        id: conversation.id,
        studentId: conversation.studentId,
        organizationId: conversation.organizationId,
        jobsCount: jobs.length,
        jobTypes: jobs.map((j) => j.type),
      });
    } catch (jobError: any) {
      console.error("[POST /api/audio] Failed to enqueue jobs:", {
        conversationId: conversation.id,
        error: jobError?.message,
      });
      // ジョブのエンキューに失敗しても会話ログは作成されているので、エラーを返す
      throw new Error(`ジョブの作成に失敗しました: ${jobError?.message ?? "unknown error"}`);
    }

    return NextResponse.json({
      conversationId: conversation.id,
      rawTextCleaned: conversation.rawTextCleaned,
      status: conversation.status,
      jobs,
    });
  } catch (e: any) {
    console.error("[POST /api/audio] failed", {
      error: e?.message,
      name: e?.name,
      code: e?.code,
      stack: e?.stack,
    });
    return NextResponse.json(
      {
        error: e?.message ?? "Internal Server Error",
        name: e?.name,
        code: e?.code,
      },
      { status: 500 }
    );
  }
}
