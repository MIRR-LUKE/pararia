import { NextResponse } from "next/server";
import { createStructuredConversationLog } from "@/lib/analytics/conversationAnalysis";
import { structureConversation } from "@/lib/ai/llm";
import { ConversationSourceType } from "@prisma/client";

export async function POST(request: Request) {
  const body = await request.json();
  const { transcript, organizationId, studentId, userId, save } = body ?? {};

  if (!transcript) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }

  // 保存せず構造化のみ返す
  if (!save || !organizationId || !studentId) {
    const structured = await structureConversation(transcript);
    return NextResponse.json({ structured, saved: false });
  }

  const conversation = await createStructuredConversationLog({
    transcript,
    organizationId,
    studentId,
    userId,
    sourceType: ConversationSourceType.MANUAL,
  });

  return NextResponse.json({ conversation, saved: true });
}
