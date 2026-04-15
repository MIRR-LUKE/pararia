import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { ReportDeliveryEventType } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { writeAuditLog } from "@/lib/audit";
import { API_THROTTLE_RULES, ApiQuotaExceededError, consumeApiQuota } from "@/lib/api-throttle";
import { generateParentReport } from "@/lib/ai/parentReport";
import { renderConversationArtifactOrFallback } from "@/lib/conversation-artifact";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { prisma } from "@/lib/db";
import {
  beginIdempotency,
  buildStableRequestHash,
  completeIdempotency,
  failIdempotency,
  IdempotencyConflictError,
} from "@/lib/idempotency";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { RequestValidationError, parseJsonWithSchema } from "@/lib/server/request-validation";
import { withActiveStudentWhere } from "@/lib/students/student-lifecycle";

const generateReportBodySchema = z.object({
  studentId: z.string().trim().min(1),
  fromDate: z.string().trim().min(1).optional().nullable(),
  toDate: z.string().trim().min(1).optional().nullable(),
  logIds: z.array(z.string().trim().min(1)).optional(),
  sessionIds: z.array(z.string().trim().min(1)).optional(),
});

export async function POST(request: Request) {
  let idempotencyKey: string | null = null;
  let idempotencyStarted = false;

  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await parseJsonWithSchema(request, generateReportBodySchema, "レポート生成");
    const studentId = body.studentId;

    const student = await prisma.student.findFirst({
      where: withActiveStudentWhere({ id: studentId, organizationId: session.user.organizationId }),
    });
    if (!student) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    const resolvedLogIds = Array.from(new Set((body.logIds ?? []).filter(Boolean))).sort();
    const resolvedSessionIds = Array.from(new Set((body.sessionIds ?? []).filter(Boolean))).sort();

    if (resolvedLogIds.length === 0 && resolvedSessionIds.length === 0) {
      return NextResponse.json(
        { error: "logIds or sessionIds is required for report generation" },
        { status: 400 }
      );
    }

    const from = body.fromDate ? new Date(body.fromDate) : undefined;
    const to = body.toDate ? new Date(body.toDate) : undefined;
    if (from && Number.isNaN(from.getTime())) {
      throw new RequestValidationError("fromDate の形式が不正です。");
    }
    if (to && Number.isNaN(to.getTime())) {
      throw new RequestValidationError("toDate の形式が不正です。");
    }
    const normalizedRequest = {
      studentId,
      fromDate: from ? from.toISOString() : null,
      toDate: to ? to.toISOString() : null,
      logIds: resolvedLogIds,
      sessionIds: resolvedSessionIds,
    };

    await consumeApiQuota({
      scope: "report_generate:user",
      rawKey: session.user.id,
      rule: API_THROTTLE_RULES.reportGenerateUser,
    });
    await consumeApiQuota({
      scope: "report_generate:org",
      rawKey: session.user.organizationId,
      rule: API_THROTTLE_RULES.reportGenerateOrg,
    });

    idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || buildStableRequestHash(normalizedRequest);
    const idempotency = await beginIdempotency({
      scope: "report_generate",
      idempotencyKey,
      requestBody: normalizedRequest,
      organizationId: session.user.organizationId,
      userId: session.user.id,
      ttlMs: 24 * 60 * 60 * 1000,
    });
    if (idempotency.state === "completed") {
      return NextResponse.json(idempotency.responseBody ?? {}, { status: idempotency.responseStatus ?? 200 });
    }
    if (idempotency.state === "pending") {
      return NextResponse.json(
        { error: "同じレポート生成がまだ進行中です。少し待ってから再読み込みしてください。" },
        { status: 409 }
      );
    }
    idempotencyStarted = true;

    const selectedLogs = await prisma.conversationLog.findMany({
      where: withVisibleConversationWhere({
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
      }),
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
        { error: "選択したログ本文がまだ生成されていません。面談ログの生成完了後に再実行してください。" },
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
          actorUserId: session.user.id ?? undefined,
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
      organizationId: student.organizationId,
      userId: session.user.id,
      action: "report.generate",
      targetType: "report",
      targetId: report.id,
      detail: {
        reportId: report.id,
        studentId,
        sourceLogCount: logs.length,
      },
    });

    revalidateTag(`student-directory:${student.organizationId}`, "max");
    revalidateTag(`dashboard-snapshot:${student.organizationId}`, "max");
    revalidateTag(getLogListCacheTag(student.organizationId), "max");
    revalidatePath("/app/dashboard");
    revalidatePath("/app/students");
    revalidatePath("/app/logs");
    revalidatePath("/app/reports");
    revalidatePath(`/app/students/${studentId}`);

    const responseBody = JSON.parse(JSON.stringify({ report }));
    await completeIdempotency({
      scope: "report_generate",
      idempotencyKey,
      responseStatus: 200,
      responseBody,
    });

    return NextResponse.json(responseBody);
  } catch (error: any) {
    if (idempotencyStarted && idempotencyKey) {
      await failIdempotency({
        scope: "report_generate",
        idempotencyKey,
      }).catch(() => {});
    }

    console.error("[POST /api/ai/generate-report] Error:", {
      error: error?.message,
      stack: error?.stack,
    });

    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof ApiQuotaExceededError) {
      return NextResponse.json(
        {
          error: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(error.retryAfterSeconds),
          },
        }
      );
    }

    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
