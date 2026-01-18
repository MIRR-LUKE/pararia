import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ConversationSourceType, ConversationStatus } from "@prisma/client";
import { preprocessTranscript } from "@/lib/transcript/preprocess";
import { enqueueConversationJobs } from "@/lib/jobs/conversationJobs";
import { ensureOrganizationId } from "@/lib/server/organization";

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

    const formattedConversations = conversations.map((c) => ({
      ...c,
      timelineJson: c.timelineJson as any,
      nextActionsJson: c.nextActionsJson as any,
      profileDeltaJson: c.profileDeltaJson as any,
      formattedTranscript: c.formattedTranscript,
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
  const { organizationId, studentId, userId, transcript, sourceType } = body ?? {};

  if (!studentId) {
    return NextResponse.json(
      { error: "studentId is required" },
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
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  const resolvedOrgId = await ensureOrganizationId(organizationId);
  const conversation = await prisma.conversationLog.create({
    data: {
      organizationId: resolvedOrgId,
      studentId,
      userId,
      sourceType:
        sourceType === "AUDIO" ? ConversationSourceType.AUDIO : ConversationSourceType.MANUAL,
      status: ConversationStatus.PROCESSING,
      rawTextOriginal: pre.rawTextOriginal,
      rawTextCleaned: pre.rawTextCleaned,
      rawTextExpiresAt: expiresAt,
      // rawSegments, LLM outputs will be filled asynchronously
    },
  });

  await enqueueConversationJobs(conversation.id);

  return NextResponse.json({ conversation }, { status: 201 });
}
