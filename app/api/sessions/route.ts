import { NextResponse } from "next/server";
import { SessionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pickOngoingLessonReportSession } from "@/lib/lesson-report-flow";
import { requireAuthorizedMutationSession, requireAuthorizedSession } from "@/lib/server/request-auth";
import { withActiveStudentWhere } from "@/lib/students/student-lifecycle";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("studentId");
    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    const student = await prisma.student.findFirst({
      where: withActiveStudentWhere({
        id: studentId,
        organizationId: authResult.session.user.organizationId,
      }),
      select: { id: true },
    });
    if (!student) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    const sessions = await prisma.session.findMany({
      where: { studentId, organizationId: authResult.session.user.organizationId },
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
    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;
    const session = authResult.session;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "sessions.create",
      userId: session.user.id,
      organizationId: session.user.organizationId,
    });
    if (throttleResponse) return throttleResponse;
    const body = await request.json();
    const { studentId, type, title, notes, sessionDate } = body ?? {};

    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    const sessionType =
      type === SessionType.LESSON_REPORT ? SessionType.LESSON_REPORT : SessionType.INTERVIEW;
    const resolvedOrgId = session.user.organizationId;

    const student = await prisma.student.findFirst({
      where: withActiveStudentWhere({ id: studentId, organizationId: resolvedOrgId }),
      select: { id: true, organizationId: true },
    });
    if (!student) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    const existingSessions = await prisma.session.findMany({
      where: {
        organizationId: resolvedOrgId,
        studentId,
        type: sessionType,
      },
      orderBy: [{ sessionDate: "desc" }, { createdAt: "desc" }],
      include: {
        parts: {
          select: {
            partType: true,
            status: true,
          },
        },
        conversation: {
          select: {
            id: true,
          },
        },
      },
      take: 8,
    });

    if (sessionType === SessionType.LESSON_REPORT) {
      const reusable = pickOngoingLessonReportSession(existingSessions);
      if (reusable) {
        return NextResponse.json({ session: reusable, reused: true });
      }
    } else {
      const reusableInterview = existingSessions.find(
        (existingSession) =>
          existingSession.status === "DRAFT" &&
          !existingSession.conversation?.id &&
          existingSession.parts.length === 0
      );
      if (reusableInterview) {
        return NextResponse.json({ session: reusableInterview, reused: true });
      }
    }

    const created = await prisma.session.create({
      data: {
        organizationId: resolvedOrgId,
        studentId,
        userId: session.user.id,
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
