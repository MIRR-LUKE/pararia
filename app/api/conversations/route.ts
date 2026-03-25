import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ConversationSourceType, ConversationStatus } from "@prisma/client";
import { preprocessTranscript } from "@/lib/transcript/preprocess";
import { enqueueConversationJobs, processAllConversationJobs } from "@/lib/jobs/conversationJobs";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { sanitizeSummaryMarkdown } from "@/lib/user-facing-japanese";

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

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
          organizationId,
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
          formattedTranscript: true,
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
        summaryMarkdown: sanitizeSummaryMarkdown(conversation.summaryMarkdown),
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
      where: {
        organizationId,
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
      summaryMarkdown: sanitizeSummaryMarkdown(c.summaryMarkdown),
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
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;
    const userId = authResult.session.user.id;

    const body = await request.json();
    const { studentId, transcript, sourceType } = body ?? {};

    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    if (!transcript || typeof transcript !== "string" || transcript.trim().length === 0) {
      return NextResponse.json(
        { error: "transcript is required (async pipeline)" },
        { status: 400 }
      );
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, organizationId: true },
    });
    if (!student || student.organizationId !== organizationId) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    const pre = preprocessTranscript(transcript);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    const conversation = await prisma.conversationLog.create({
      data: {
        organizationId,
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
    void processAllConversationJobs(conversation.id).catch((error) => {
      console.error("[POST /api/conversations] Background process failed:", error);
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/conversations] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
