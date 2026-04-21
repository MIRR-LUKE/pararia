import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { withVisibleReportWhere } from "@/lib/content-visibility";
import { prisma } from "@/lib/db";
import { buildReportDeliverySummary } from "@/lib/report-delivery";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { createOperationErrorContext, respondWithOperationError } from "@/lib/observability/operation-errors";
import { requireAuthorizedMutationSession, requireAuthorizedSession } from "@/lib/server/request-auth";
import { sanitizeReportMarkdown } from "@/lib/user-facing-japanese";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = createOperationErrorContext("report-detail");
  let stage = "auth";
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedSession();
    if (authResult.response) {
      return respondWithOperationError({
        context,
        stage,
        message: "Unauthorized",
        status: 401,
        reason: "unauthorized",
      });
    }
    const organizationId = authResult.session.user.organizationId;
    if (!id?.trim()) {
      return respondWithOperationError({
        context,
        stage: "params",
        message: "reportId が必要です。",
        status: 400,
        level: "warn",
        reason: "missing_report_id",
      });
    }

    stage = "load_report_detail";
    const report = await prisma.report.findFirst({
      where: withVisibleReportWhere({ id, organizationId }),
      select: {
        id: true,
        status: true,
        reportMarkdown: true,
        reportJson: true,
        createdAt: true,
        sentAt: true,
        reviewedAt: true,
        deliveryChannel: true,
        sourceLogIds: true,
        deliveryEvents: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            eventType: true,
            deliveryChannel: true,
            note: true,
            createdAt: true,
            actor: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!report) {
      return respondWithOperationError({
        context,
        stage,
        message: "report not found",
        status: 404,
        level: "warn",
        reason: "report_not_found",
      });
    }

    stage = "build_response";
    const mappedReport = {
      ...report,
      reportMarkdown: sanitizeReportMarkdown(report.reportMarkdown ?? ""),
      reportJson: report.reportJson ?? null,
      createdAt: report.createdAt.toISOString(),
      sentAt: report.sentAt?.toISOString() ?? null,
      reviewedAt: report.reviewedAt?.toISOString() ?? null,
      sourceLogIds: toStringArray(report.sourceLogIds),
      deliveryEvents: report.deliveryEvents.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
    };

    return NextResponse.json({
      report: {
        ...mappedReport,
        ...buildReportDeliverySummary(mappedReport),
      },
    });
  } catch (error: any) {
    return respondWithOperationError({
      context,
      stage,
      message: error?.message ?? "Internal Server Error",
      status: 500,
      error,
      reason: "unexpected_error",
    });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "reports.delete",
      userId: authResult.session.user.id,
      organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const report = await prisma.report.findFirst({
      where: withVisibleReportWhere({ id, organizationId }),
      select: {
        id: true,
        studentId: true,
        status: true,
        sourceLogIds: true,
      },
    });

    if (!report) {
      return NextResponse.json({ error: "report not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const deleteReason =
      typeof body?.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim().slice(0, 500)
        : null;

    const deletedAt = new Date();
    await prisma.report.update({
      where: { id: report.id },
      data: {
        deletedAt,
        deletedByUserId: authResult.session.user.id,
        deletedReason: deleteReason,
      },
    });

    await writeAuditLog({
      organizationId,
      userId: authResult.session.user.id,
      action: "report.delete",
      targetType: "report",
      targetId: report.id,
      detail: {
        reportId: report.id,
        studentId: report.studentId,
        status: report.status,
        sourceLogCount: toStringArray(report.sourceLogIds).length,
        deletedAt: deletedAt.toISOString(),
        deleteReason,
      },
    });

    revalidateTag(`student-directory:${organizationId}`, "max");
    revalidateTag(`dashboard-snapshot:${organizationId}`, "max");
    revalidateTag(getLogListCacheTag(organizationId), "max");
    revalidatePath("/app/dashboard");
    revalidatePath("/app/students");
    revalidatePath("/app/logs");
    revalidatePath("/app/reports");
    revalidatePath(`/app/students/${report.studentId}`);

    return NextResponse.json({
      success: true,
      message: "report deleted",
      reportId: report.id,
      studentId: report.studentId,
    });
  } catch (error: any) {
    console.error("[DELETE /api/reports/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
