import { NextResponse } from "next/server";
import { SessionType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { pickOngoingLessonReportSession } from "@/lib/lesson-report-flow";
import { ensureOrganizationId } from "@/lib/server/organization";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("studentId");
    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    const sessions = await prisma.session.findMany({
      where: { studentId },
      orderBy: [{ sessionDate: "desc" }, { createdAt: "desc" }],
      include: {
        parts: {
          select: {
            id: true,
            partType: true,
            status: true,
            sourceType: true,
            fileName: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
        conversation: {
          select: {
            id: true,
            status: true,
            summaryMarkdown: true,
            studentStateJson: true,
            topicSuggestionsJson: true,
            quickQuestionsJson: true,
            nextActionsJson: true,
          },
        },
      },
    });

    return NextResponse.json({ sessions });
  } catch (error: any) {
    console.error("[GET /api/sessions] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    const body = await request.json();
    const { organizationId, studentId, userId, type, title, notes, sessionDate } = body ?? {};

    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    const sessionType =
      type === SessionType.LESSON_REPORT ? SessionType.LESSON_REPORT : SessionType.INTERVIEW;
    const resolvedOrgId = await ensureOrganizationId(
      session?.user?.organizationId ?? organizationId ?? undefined
    );

    if (sessionType === SessionType.LESSON_REPORT) {
      const existingSessions = await prisma.session.findMany({
        where: {
          organizationId: resolvedOrgId,
          studentId,
          type: SessionType.LESSON_REPORT,
        },
        orderBy: [{ sessionDate: "desc" }, { createdAt: "desc" }],
        include: {
          parts: {
            select: {
              partType: true,
              status: true,
            },
          },
        },
        take: 8,
      });

      const reusable = pickOngoingLessonReportSession(existingSessions);
      if (reusable) {
        return NextResponse.json({ session: reusable, reused: true });
      }
    }

    const created = await prisma.session.create({
      data: {
        organizationId: resolvedOrgId,
        studentId,
        userId: session?.user?.id ?? userId ?? undefined,
        type: sessionType,
        title: typeof title === "string" ? title : undefined,
        notes: typeof notes === "string" ? notes : undefined,
        sessionDate: sessionDate ? new Date(sessionDate) : new Date(),
      },
    });

    return NextResponse.json({ session: created }, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/sessions] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
