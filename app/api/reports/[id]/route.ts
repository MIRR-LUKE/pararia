import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { buildReportDeliverySummary } from "@/lib/report-delivery";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { sanitizeReportMarkdown } from "@/lib/user-facing-japanese";

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function GET(
  _request: Request,
  { params }: { params: RouteParams }
) {
  try {
    const reportId = await resolveRouteId(params);
    if (!reportId) {
      return NextResponse.json({ error: "reportId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const report = await prisma.report.findFirst({
      where: { id: reportId, organizationId },
      select: {
        id: true,
        status: true,
        reportMarkdown: true,
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
      return NextResponse.json({ error: "report not found" }, { status: 404 });
    }

    const mappedReport = {
      ...report,
      reportMarkdown: sanitizeReportMarkdown(report.reportMarkdown ?? ""),
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
    console.error("[GET /api/reports/[id]] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: RouteParams }
) {
  try {
    const reportId = await resolveRouteId(params);
    if (!reportId) {
      return NextResponse.json({ error: "reportId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const report = await prisma.report.findFirst({
      where: { id: reportId, organizationId },
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

    await prisma.report.delete({ where: { id: report.id } });

    await writeAuditLog({
      userId: authResult.session.user.id,
      action: "report.delete",
      detail: {
        reportId: report.id,
        studentId: report.studentId,
        status: report.status,
        sourceLogCount: toStringArray(report.sourceLogIds).length,
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
