import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateParentReport } from "@/lib/ai/parentReport";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { studentId, fromDate, toDate, logIds, sessionIds, usePreviousReport } = body ?? {};

    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    const previousReport = await prisma.report.findFirst({
      where: { studentId },
      orderBy: { createdAt: "desc" },
    });

    const resolvedLogIds = Array.isArray(logIds) ? logIds.filter(Boolean) : [];
    const resolvedSessionIds = Array.isArray(sessionIds) ? sessionIds.filter(Boolean) : [];

    if (resolvedLogIds.length === 0 && resolvedSessionIds.length === 0) {
      return NextResponse.json(
        { error: "logIds or sessionIds is required for report generation" },
        { status: 400 }
      );
    }

    const from = fromDate ? new Date(fromDate) : previousReport?.periodTo ?? undefined;
    const to = toDate ? new Date(toDate) : undefined;

    const logs = await prisma.conversationLog.findMany({
      where: {
        studentId,
        ...(resolvedLogIds.length
          ? { id: { in: resolvedLogIds } }
          : resolvedSessionIds.length
            ? { sessionId: { in: resolvedSessionIds } }
            : {
                createdAt: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {}),
                },
              }),
      },
      orderBy: { createdAt: "asc" },
      include: {
        session: {
          select: {
            type: true,
          },
        },
      },
    });

    if (logs.length === 0) {
      return NextResponse.json({ error: "selected logs not found" }, { status: 400 });
    }

    const allCandidateLogs = await prisma.conversationLog.findMany({
      where: {
        studentId,
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      },
      orderBy: { createdAt: "asc" },
      include: {
        session: {
          select: {
            type: true,
          },
        },
      },
    });

    const latestProfile = await prisma.studentProfile.findFirst({
      where: { studentId },
      orderBy: { createdAt: "desc" },
    });

    const { markdown, reportJson, bundleQualityEval } = await generateParentReport({
      studentName: student.name,
      organizationName: undefined,
      periodFrom: from?.toISOString().slice(0, 10),
      periodTo: (to ?? new Date()).toISOString().slice(0, 10),
      previousReport: usePreviousReport ? previousReport?.reportMarkdown ?? undefined : undefined,
      profileSnapshot: latestProfile?.profileData ?? {},
      logs: logs.map((log) => ({
        id: log.id,
        sessionId: log.sessionId,
        date: log.createdAt.toISOString().slice(0, 10),
        mode: log.session?.type === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW",
        parentPack: log.parentPackJson ?? {},
        summaryMarkdown: log.summaryMarkdown ?? "",
        timeline: log.timelineJson ?? [],
        nextActions: log.nextActionsJson ?? [],
        profileDelta: log.profileDeltaJson ?? {},
        studentState: log.studentStateJson ?? {},
        profileSections: log.profileSectionsJson ?? [],
        quickQuestions: log.quickQuestionsJson ?? [],
        entityCandidates: log.entityCandidatesJson ?? [],
        lessonReport: log.lessonReportJson ?? null,
      })),
      allLogsForSuggestions: allCandidateLogs.map((log) => ({
        id: log.id,
        sessionId: log.sessionId,
        date: log.createdAt.toISOString().slice(0, 10),
        mode: log.session?.type === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW",
        summaryMarkdown: log.summaryMarkdown ?? "",
        parentPack: log.parentPackJson ?? {},
        timeline: log.timelineJson ?? [],
        nextActions: log.nextActionsJson ?? [],
        studentState: log.studentStateJson ?? {},
        profileSections: log.profileSectionsJson ?? [],
        quickQuestions: log.quickQuestionsJson ?? [],
        entityCandidates: log.entityCandidatesJson ?? [],
        lessonReport: log.lessonReportJson ?? null,
      })),
    });

    const pendingEntityCount = await prisma.sessionEntity.count({
      where: {
        studentId,
        sessionId: { in: logs.map((log) => log.sessionId).filter(Boolean) as string[] },
        status: "PENDING",
      },
    });

    const report = await prisma.report.create({
      data: {
        studentId,
        organizationId: student.organizationId,
        reportMarkdown: markdown,
        reportJson: reportJson as any,
        sourceLogIds: logs.map((log) => log.id),
        previousReportId: previousReport?.id ?? undefined,
        periodFrom: from ?? undefined,
        periodTo: to ?? new Date(),
        qualityChecksJson: {
          pendingEntityCount,
          generatedFromSessions: logs.map((log) => log.sessionId).filter(Boolean),
          bundleQualityEval,
        } as any,
      },
    });

    return NextResponse.json({ report });
  } catch (error: any) {
    console.error("[POST /api/ai/generate-report] Error:", {
      error: error?.message,
      stack: error?.stack,
    });
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
