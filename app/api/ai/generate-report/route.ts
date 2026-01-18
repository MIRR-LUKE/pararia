import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateParentReport } from "@/lib/ai/llm";
import { generateReportPdfBase64 } from "@/lib/pdf/report";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { studentId, fromDate, toDate, logIds, usePreviousReport } = body ?? {};

    if (!studentId) {
      return NextResponse.json(
        { error: "studentId is required" },
        { status: 400 }
      );
    }

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    const previousReport = await prisma.report.findFirst({
      where: { studentId },
      orderBy: { createdAt: "desc" },
    });

    if (!logIds || logIds.length === 0) {
      return NextResponse.json(
        { error: "logIds is required for report generation" },
        { status: 400 }
      );
    }

    const from = fromDate ? new Date(fromDate) : previousReport?.periodTo ?? undefined;
    const to = toDate ? new Date(toDate) : undefined;

    const logs = await prisma.conversationLog.findMany({
      where: {
        studentId,
        ...(logIds?.length
          ? { id: { in: logIds } }
          : {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }),
      },
      orderBy: { createdAt: "desc" },
    });

    if (logs.length === 0) {
      return NextResponse.json(
        { error: "selected logs not found" },
        { status: 400 }
      );
    }

    const latestProfile = await prisma.studentProfile.findFirst({
      where: { studentId },
      orderBy: { createdAt: "desc" },
    });

    const { markdown, reportJson } = await generateParentReport({
      studentName: student.name,
      organizationName: undefined,
      periodFrom: from?.toISOString().slice(0, 10),
      periodTo: (to ?? new Date()).toISOString().slice(0, 10),
      previousReport: usePreviousReport ? previousReport?.reportMarkdown ?? undefined : undefined,
      profileSnapshot: latestProfile?.profileData ?? {},
      logs: logs.map((log) => ({
        id: log.id,
        date: log.createdAt.toISOString().slice(0, 10),
        summaryMarkdown: log.summaryMarkdown ?? "",
        timeline: log.timelineJson ?? [],
        nextActions: log.nextActionsJson ?? [],
        profileDelta: log.profileDeltaJson ?? {},
      })),
    });

    let pdfBase64: string | null = null;
    let pdfError: string | null = null;
    try {
      pdfBase64 = await generateReportPdfBase64({
        studentName: student.name,
        organizationName: undefined,
        periodFrom: from?.toISOString().slice(0, 10),
        periodTo: (to ?? new Date()).toISOString().slice(0, 10),
        markdown,
        keyQuotes: [],
      });
    } catch (error: any) {
      pdfError = error?.message ?? "PDF generation failed";
      console.error("[POST /api/ai/generate-report] PDF generation failed:", pdfError);
    }

    const report = await prisma.report.create({
      data: {
        studentId,
        organizationId: student.organizationId,
        reportMarkdown: markdown,
        reportJson: reportJson as any,
        reportPdfBase64: pdfBase64 ?? undefined,
        sourceLogIds: logs.map((l) => l.id),
        previousReportId: previousReport?.id ?? undefined,
        periodFrom: from ?? undefined,
        periodTo: to ?? new Date(),
      },
    });

    return NextResponse.json({ report, pdfBase64, pdfError });
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
