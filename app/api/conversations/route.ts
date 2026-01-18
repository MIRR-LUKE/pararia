import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ConversationSourceType } from "@prisma/client";
import { preprocessTranscript } from "@/lib/transcript/preprocess";
import { enqueueConversationJobs } from "@/lib/jobs/conversationJobs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("studentId");

    if (!studentId) {
      return NextResponse.json(
        { error: "studentId is required" },
        { status: 400 }
      );
    }

    const conversations = await prisma.conversationLog.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
      include: {
        student: {
          select: {
            id: true,
            name: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // JSONフィールドを適切にシリアライズ
    const formattedConversations = conversations.map((c) => ({
      ...c,
      timeline: c.timeline as any,
      nextActions: c.nextActions as string[] | null,
      structuredDelta: c.structuredDelta as any,
      formattedTranscript: c.formattedTranscript,
      // Legacy fields (for backward compatibility)
      timeSections: c.timeSections as any,
      keyQuotes: c.keyQuotes as string[] | null,
      keyTopics: c.keyTopics as string[] | null,
      date: new Date(c.createdAt).toLocaleDateString("ja-JP"), // フロントエンド表示用
    }));

    return NextResponse.json({ conversations: formattedConversations });
  } catch (error: any) {
    console.error("[GET /api/conversations] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const {
    organizationId,
    studentId,
    userId,
    transcript,
    sourceType,
  } = body ?? {};

  if (!organizationId || !studentId) {
    return NextResponse.json(
      { error: "organizationId and studentId are required" },
      { status: 400 }
    );
  }

  if (!transcript || typeof transcript !== "string" || transcript.trim().length === 0) {
    return NextResponse.json(
      { error: "transcript is required (async pipeline)" },
      { status: 400 }
    );
  }

  const pre = preprocessTranscript(transcript);
  const conversation = await prisma.conversationLog.create({
    data: {
      organizationId,
      studentId,
      userId,
      sourceType:
        sourceType === "AUDIO" ? ConversationSourceType.AUDIO : ConversationSourceType.MANUAL,
      rawTextOriginal: pre.rawTextOriginal,
      rawTextCleaned: pre.rawTextCleaned,
      // rawSegments, summary, and other LLM outputs will be filled asynchronously
      summary: "",
    },
  });

  await enqueueConversationJobs(conversation.id);

  return NextResponse.json({ conversation }, { status: 201 });
}
