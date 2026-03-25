import { NextResponse } from "next/server";
import { createStructuredConversationLog } from "@/lib/analytics/conversationAnalysis";
import { preprocessTranscript } from "@/lib/transcript/preprocess";
import { analyzeChunkBlocks, reduceChunkAnalyses, finalizeConversationArtifacts } from "@/lib/ai/conversationPipeline";
import { ConversationSourceType, SessionType } from "@prisma/client";

export async function POST(request: Request) {
  const body = await request.json();
  const { transcript, organizationId, studentId, userId, save } = body ?? {};
  const sessionType = body?.sessionType === SessionType.LESSON_REPORT ? SessionType.LESSON_REPORT : SessionType.INTERVIEW;

  if (!transcript) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }

  // 保存せず構造化のみ返す
  if (!save || !organizationId || !studentId) {
    const pre = preprocessTranscript(transcript);
    const { analyses } = await analyzeChunkBlocks(
      pre.blocks.map((b) => ({ index: b.index, text: b.text, hash: b.hash })),
      { sessionType: sessionType === SessionType.LESSON_REPORT ? "LESSON_REPORT" : "INTERVIEW" }
    );
    const { reduced } = await reduceChunkAnalyses({
      analyses,
      sessionType: sessionType === SessionType.LESSON_REPORT ? "LESSON_REPORT" : "INTERVIEW",
    });
    const { result } = await finalizeConversationArtifacts({
      reduced,
      minSummaryChars: transcript.length >= 20000 ? 1200 : 700,
      sessionType: sessionType === SessionType.LESSON_REPORT ? "LESSON_REPORT" : "INTERVIEW",
    });
    return NextResponse.json({ structured: result, saved: false });
  }

  const conversation = await createStructuredConversationLog({
    transcript,
    organizationId,
    studentId,
    userId,
    sourceType: ConversationSourceType.MANUAL,
    sessionType,
  });

  return NextResponse.json({ conversation, saved: true });
}
