import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateParentReportMarkdown } from "@/lib/ai/llm";
import { generateReportPdfBase64 } from "@/lib/pdf/report";

export async function POST(request: Request) {
  const body = await request.json();
  const { studentId, fromDate, toDate, logIds } = body ?? {};

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

  const from = logIds?.length
    ? undefined
    : fromDate
    ? new Date(fromDate)
    : previousReport?.periodTo ?? undefined;
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

  const markdown = await generateParentReportMarkdown({
    studentName: student.name,
    organizationName: undefined,
    periodFrom: from?.toISOString().slice(0, 10),
    periodTo: (to ?? new Date()).toISOString().slice(0, 10),
    previousReport: previousReport?.markdown,
    logs: logs.map((log) => ({
      id: log.id,
      date: log.createdAt.toISOString().slice(0, 10),
      summary: log.summary,
      keyQuotes: (log.keyQuotes as string[]) ?? [],
      nextActions: (log.nextActions as string[]) ?? [],
    })),
  });

  const pdfBase64 = await generateReportPdfBase64({
    studentName: student.name,
    organizationName: undefined,
    periodFrom: from?.toISOString().slice(0, 10),
    periodTo: (to ?? new Date()).toISOString().slice(0, 10),
    markdown,
    keyQuotes: logs.flatMap((l) => (l.keyQuotes as string[]) ?? []).slice(0, 5),
  });

  const report = await prisma.report.create({
    data: {
      studentId,
      organizationId: student.organizationId,
      markdown,
      pdfBase64,
      sourceLogIds: logs.map((l) => l.id),
      periodFrom: from ?? undefined,
      periodTo: to ?? new Date(),
    },
  });

  return NextResponse.json({ report, pdfBase64 });
}
