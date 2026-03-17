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
    const typeFilter = searchParams.get("type");
    const limitRaw = searchParams.get("limit");
    const limitParam = limitRaw ? Number(limitRaw) : NaN;
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(Math.floor(limitParam), 200)
        : 50;

    if (studentId) {
      const sessionTypeFilter =
        typeFilter === "LESSON_REPORT" || typeFilter === "INTERVIEW" ? typeFilter : undefined;
      const conversations = await prisma.conversationLog.findMany({
        where: {
          studentId,
          ...(sessionTypeFilter ? { session: { type: sessionTypeFilter } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          studentId: true,
          sessionId: true,
          status: true,
          summaryMarkdown: true,
          timelineJson: true,
          nextActionsJson: true,
          profileDeltaJson: true,
          studentStateJson: true,
          topicSuggestionsJson: true,
          quickQuestionsJson: true,
          profileSectionsJson: true,
          lessonReportJson: true,
          entityCandidatesJson: true,
          formattedTranscript: true,
          qualityMetaJson: true,
          createdAt: true,
          student: { select: { id: true, name: true, grade: true } },
          session: { select: { type: true } },
        },
      });

      const formattedConversations = conversations.map((conversation) => ({
        id: conversation.id,
        studentId: conversation.studentId,
        sessionId: conversation.sessionId,
        status: conversation.status,
        summaryMarkdown: conversation.summaryMarkdown,
        timelineJson: conversation.timelineJson as any,
        nextActionsJson: conversation.nextActionsJson as any,
        profileDeltaJson: conversation.profileDeltaJson as any,
        studentStateJson: conversation.studentStateJson as any,
        topicSuggestionsJson: conversation.topicSuggestionsJson as any,
        quickQuestionsJson: conversation.quickQuestionsJson as any,
        profileSectionsJson: conversation.profileSectionsJson as any,
        lessonReportJson: conversation.lessonReportJson as any,
        entityCandidatesJson: conversation.entityCandidatesJson as any,
        formattedTranscript: conversation.formattedTranscript,
        createdAt: conversation.createdAt,
        date: new Date(conversation.createdAt).toLocaleDateString("ja-JP"),
        student: conversation.student,
        sessionType: conversation.session?.type ?? null,
      }));

      return NextResponse.json({ conversations: formattedConversations });
    }

    const sessionTypeFilter =
      typeFilter === "LESSON_REPORT" || typeFilter === "INTERVIEW" ? typeFilter : undefined;

    const conversations = await prisma.conversationLog.findMany({
      where: sessionTypeFilter
        ? { session: { type: sessionTypeFilter } }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        studentId: true,
        sessionId: true,
        status: true,
        summaryMarkdown: true,
        createdAt: true,
        student: { select: { id: true, name: true, grade: true } },
        session: { select: { type: true } },
      },
    });

    const formattedConversations = conversations.map((c) => ({
      id: c.id,
      studentId: c.studentId,
      sessionId: c.sessionId,
      status: c.status,
      summaryMarkdown: c.summaryMarkdown,
      createdAt: c.createdAt,
      date: new Date(c.createdAt).toLocaleDateString("ja-JP"),
      student: c.student,
      sessionType: c.session?.type ?? null,
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
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
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
    },
  });

  await enqueueConversationJobs(conversation.id);

  return NextResponse.json({ conversation }, { status: 201 });
}
