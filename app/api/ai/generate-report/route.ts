import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { ReportDeliveryEventType } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { API_THROTTLE_RULES, ApiQuotaExceededError, consumeApiQuota } from "@/lib/api-throttle";
import { generateParentReport } from "@/lib/ai/parentReport";
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
import {
  createOperationContext,
  logOperationError,
  operationErrorResponse,
  withOperationMeta,
} from "@/lib/observability/operation-errors";
import { RequestValidationError, parseJsonWithSchema } from "@/lib/server/request-validation";
import { requireAuthorizedMutationSession } from "@/lib/server/request-auth";
import { withActiveStudentWhere } from "@/lib/students/student-lifecycle";
import { requireReportArtifact, ReportArtifactValidationError } from "@/lib/operational-log";

const generateReportBodySchema = z.object({
  studentId: z.string().trim().min(1),
  fromDate: z.string().trim().min(1).optional().nullable(),
  toDate: z.string().trim().min(1).optional().nullable(),
  logIds: z.array(z.string().trim().min(1)).optional(),
  sessionIds: z.array(z.string().trim().min(1)).optional(),
});

async function readResponseErrorMessage(response: Response, fallbackMessage: string) {
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    const error = String((body as { error: string }).error).trim();
    if (error.length > 0) return error;
  }
  return fallbackMessage;
}

export async function POST(request: Request) {
  const operation = createOperationContext("generate-report");
  let stage = "auth";
  let idempotencyKey: string | null = null;
  let idempotencyStarted = false;
  let idempotencyCompleted = false;
  let studentIdForLog: string | null = null;

  try {
    const sessionResult = await requireAuthorizedMutationSession(request);
    if (sessionResult.response) {
      const status = sessionResult.response.status;
      return operationErrorResponse(operation, {
        stage,
        message: await readResponseErrorMessage(
          sessionResult.response,
          status === 401 ? "Unauthorized" : "この操作は許可されていません。"
        ),
        status,
        reason: status === 401 ? "unauthorized" : "forbidden",
      });
    }
    const session = sessionResult.session;

    stage = "validate_input";
    const body = await parseJsonWithSchema(request, generateReportBodySchema, "レポート生成");
    const studentId = body.studentId;
    studentIdForLog = studentId;

    stage = "student_lookup";
    const student = await prisma.student.findFirst({
      where: withActiveStudentWhere({ id: studentId, organizationId: session.user.organizationId }),
      select: {
        id: true,
        name: true,
        guardianNames: true,
        organizationId: true,
        organization: {
          select: {
            name: true,
          },
        },
      },
    });
    if (!student) {
      return operationErrorResponse(operation, {
        stage,
        message: "student not found",
        status: 404,
        reason: "student_not_found",
        extra: { studentId },
      });
    }

    const resolvedLogIds = Array.from(new Set((body.logIds ?? []).filter(Boolean))).sort();
    const resolvedSessionIds = Array.from(new Set((body.sessionIds ?? []).filter(Boolean))).sort();

    if (resolvedLogIds.length === 0 && resolvedSessionIds.length === 0) {
      return operationErrorResponse(operation, {
        stage: "validate_selection",
        message: "logIds or sessionIds is required for report generation",
        status: 400,
        reason: "missing_log_selection",
        extra: { studentId },
      });
    }

    stage = "validate_input";
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

    stage = "consume_quota";
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

    stage = "begin_idempotency";
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
      return operationErrorResponse(operation, {
        stage,
        message: "同じレポート生成がまだ進行中です。少し待ってから再読み込みしてください。",
        status: 409,
        reason: "idempotency_pending",
        extra: { studentId },
      });
    }
    idempotencyStarted = true;

    stage = "load_selected_logs";
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
        session: {
          select: {
            type: true,
          },
        },
      },
    });

    if (selectedLogs.length === 0) {
      return operationErrorResponse(operation, {
        stage,
        message: "selected logs not found",
        status: 400,
        reason: "selected_logs_not_found",
        extra: {
          studentId,
          selectedLogCount: resolvedLogIds.length,
          selectedSessionCount: resolvedSessionIds.length,
        },
      });
    }

    stage = "validate_artifact";
    const invalidLogs = selectedLogs
      .map((log) => {
        try {
          requireReportArtifact({ id: log.id, artifactJson: log.artifactJson });
          return null;
        } catch (error) {
          if (error instanceof ReportArtifactValidationError) {
            return { id: log.id, message: error.message };
          }
          throw error;
        }
      })
      .filter((entry): entry is { id: string; message: string } => entry !== null);

    if (invalidLogs.length > 0) {
      return operationErrorResponse(operation, {
        stage,
        message:
          `保護者レポートに使えない面談ログがあります。` +
          ` 面談ログを再生成してから再実行してください。` +
          ` 対象: ${invalidLogs.map((log) => log.id).join(", ")}`,
        status: 400,
        reason: "invalid_selected_artifact",
        extra: {
          studentId,
          invalidLogIds: invalidLogs.map((log) => log.id),
        },
      });
    }

    const logs = selectedLogs;

    stage = "build_report";
    const { markdown, reportJson, bundleQualityEval, generationMeta } = await generateParentReport({
      studentName: student.name,
      guardianNames: student.guardianNames,
      teacherName: session.user.name,
      organizationName: student.organization?.name,
      periodFrom: from?.toISOString().slice(0, 10),
      periodTo: (to ?? new Date()).toISOString().slice(0, 10),
      logs: logs.map((log) => ({
        id: log.id,
        sessionId: log.sessionId,
        date: log.createdAt.toISOString().slice(0, 10),
        mode: log.session?.type === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW",
        artifactJson: log.artifactJson,
        })),
    });

    stage = "persist_report";
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

    stage = "complete_idempotency";
    const responseBody = JSON.parse(JSON.stringify(withOperationMeta(operation, "persist_report", { report })));
    await completeIdempotency({
      scope: "report_generate",
      idempotencyKey,
      responseStatus: 200,
      responseBody,
    });
    idempotencyCompleted = true;

    stage = "audit_log";
    try {
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
          operationId: operation.operationId,
        },
      });
    } catch (error) {
      logOperationError(operation, {
        stage,
        message: "report generated but audit log failed",
        error,
        extra: {
          reason: "audit_log_failed",
          reportId: report.id,
          studentId,
        },
      });
    }

    stage = "revalidate";
    try {
      revalidateTag(`student-directory:${student.organizationId}`, "max");
      revalidateTag(`dashboard-snapshot:${student.organizationId}`, "max");
      revalidateTag(getLogListCacheTag(student.organizationId), "max");
      revalidatePath("/app/dashboard");
      revalidatePath("/app/students");
      revalidatePath("/app/logs");
      revalidatePath("/app/reports");
      revalidatePath(`/app/students/${studentId}`);
    } catch (error) {
      logOperationError(operation, {
        stage,
        message: "report generated but cache revalidation failed",
        error,
        extra: {
          reason: "revalidate_failed",
          reportId: report.id,
          studentId,
        },
      });
    }

    return NextResponse.json(responseBody);
  } catch (error: any) {
    if (idempotencyStarted && idempotencyKey && !idempotencyCompleted) {
      await failIdempotency({
        scope: "report_generate",
        idempotencyKey,
      }).catch(() => {});
    }

    if (error instanceof RequestValidationError) {
      return operationErrorResponse(operation, {
        stage,
        message: error.message,
        status: error.status,
        reason: "request_validation_error",
        error,
        extra: studentIdForLog ? { studentId: studentIdForLog } : undefined,
      });
    }

    if (error instanceof ApiQuotaExceededError) {
      const responseBody = withOperationMeta(operation, stage, {
        error: error.message,
        route: operation.route,
        reason: "quota_exceeded",
        retryAfterSeconds: error.retryAfterSeconds,
      });
      logOperationError(operation, {
        stage,
        message: error.message,
        reason: "quota_exceeded",
        error,
        extra: {
          retryAfterSeconds: error.retryAfterSeconds,
          ...(studentIdForLog ? { studentId: studentIdForLog } : {}),
        },
      });
      return NextResponse.json(responseBody, {
        status: 429,
        headers: {
          "Retry-After": String(error.retryAfterSeconds),
        },
      });
    }

    if (error instanceof IdempotencyConflictError) {
      return operationErrorResponse(operation, {
        stage,
        message: error.message,
        status: error.status,
        reason: "idempotency_conflict",
        error,
        extra: studentIdForLog ? { studentId: studentIdForLog } : undefined,
      });
    }

    return operationErrorResponse(operation, {
      stage,
      message: error?.message ?? "Internal Server Error",
      status: 500,
      reason: "unexpected_error",
      error,
      extra: studentIdForLog ? { studentId: studentIdForLog } : undefined,
    });
  }
}
