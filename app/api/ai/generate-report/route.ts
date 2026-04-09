import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { ReportDeliveryEventType } from "@prisma/client";
import { auth } from "@/auth";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { generateParentReport } from "@/lib/ai/parentReport";
import { renderConversationArtifactOrFallback } from "@/lib/conversation-artifact";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { studentId, fromDate, toDate, logIds, sessionIds } = body ?? {};

    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    const student = await prisma.student.findFirst({
      where: { id: studentId, organizationId: session.user.organizationId },
    });
    if (!student) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    const resolvedLogIds = Array.isArray(logIds) ? logIds.filter(Boolean) : [];
    const resolvedSessionIds = Array.isArray(sessionIds) ? sessionIds.filter(Boolean) : [];

    if (resolvedLogIds.length === 0 && resolvedSessionIds.length === 0) {
      return NextResponse.json(
        { error: "logIds or sessionIds is required for report generation" },
        { status: 400 }
      );
    }

    const from = fromDate ? new Date(fromDate) : undefined;
    const to = toDate ? new Date(toDate) : undefined;

    const selectedLogs = await prisma.conversationLog.findMany({
      where: {
        organizationId: session.user.organizationId,
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
      select: {
        id: true,
        sessionId: true,
        createdAt: true,
        artifactJson: true,
        summaryMarkdown: true,
        session: {
          select: {
            type: true,
          },
        },
      },
    });

    if (selectedLogs.length === 0) {
      return NextResponse.json({ error: "selected logs not found" }, { status: 400 });
    }

    const pendingLogs = selectedLogs.filter(
      (log) => !renderConversationArtifactOrFallback(log.artifactJson, log.summaryMarkdown).trim()
    );
    if (pendingLogs.length > 0) {
      return NextResponse.json(
        { error: "選択したログ本文がまだ生成されていません。面談ログ / 指導報告ログの生成完了後に再実行してください。" },
        { status: 400 }
      );
    }

    const logs = selectedLogs.filter((log) =>
      Boolean(renderConversationArtifactOrFallback(log.artifactJson, log.summaryMarkdown).trim())
    );

    const { markdown, reportJson, bundleQualityEval, generationMeta } = await generateParentReport({
      studentName: student.name,
      organizationName: undefined,
      periodFrom: from?.toISOString().slice(0, 10),
      periodTo: (to ?? new Date()).toISOString().slice(0, 10),
      logs: logs.map((log) => ({
        id: log.id,
        sessionId: log.sessionId,
        date: log.createdAt.toISOString().slice(0, 10),
        mode: log.session?.type === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW",
        artifactJson: log.artifactJson,
        summaryMarkdown: renderConversationArtifactOrFallback(log.artifactJson, log.summaryMarkdown),
      })),
    });

    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.report.create({
        data: {
          studentId,
          organizationId: student.organizationId,
          reportMarkdown: markdown,
          reportJson: reportJson as any,
          sourceLogIds: logs.map((log) => log.id),
          periodFrom: from ?? undefined,
          periodTo: to ?? new Date(),
          qualityChecksJson: {
            generatedFromSessions: logs.map((log) => log.sessionId).filter(Boolean),
            generatedFromLogIds: logs.map((log) => log.id),
            generatedFromModes: logs.map((log) =>
              log.session?.type === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW"
            ),
            bundleQualityEval,
            generationMeta,
          } as any,
        },
      });

      await tx.reportDeliveryEvent.create({
        data: {
          reportId: created.id,
          organizationId: student.organizationId,
          studentId,
          actorUserId: session?.user?.id ?? undefined,
          eventType: ReportDeliveryEventType.DRAFT_CREATED,
          eventMetaJson: {
            sourceLogIds: logs.map((log) => log.id),
            sourceSessionIds: logs.map((log) => log.sessionId).filter(Boolean),
          } as any,
        },
      });

      return created;
    });

    await writeAuditLog({
      userId: session?.user?.id,
      action: "report.generate",
      detail: {
        reportId: report.id,
        studentId,
        sourceLogCount: logs.length,
      },
    });

    revalidateTag(`student-directory:${student.organizationId}`);
    revalidateTag(`dashboard-snapshot:${student.organizationId}`);
    revalidatePath("/app/dashboard");
    revalidatePath("/app/students");
    revalidatePath("/app/reports");
    revalidatePath(`/app/students/${studentId}`);

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
