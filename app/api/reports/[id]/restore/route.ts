import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { canManageStaff } from "@/lib/permissions";
import { withVisibleReportWhere } from "@/lib/content-visibility";
import { prisma } from "@/lib/db";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    if (!canManageStaff(authResult.session.user.role)) {
      return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
    }
    const organizationId = authResult.session.user.organizationId;

    const current = await prisma.report.findFirst({
      where: {
        ...withVisibleReportWhere({ id, organizationId }),
        deletedAt: { not: null },
      },
      select: {
        id: true,
        studentId: true,
        status: true,
      },
    });

    if (!current) {
      return NextResponse.json({ error: "report not found" }, { status: 404 });
    }

    const restored = await prisma.report.update({
      where: { id: current.id },
      data: {
        deletedAt: null,
        deletedByUserId: null,
        deletedReason: null,
      },
    });

    await writeAuditLog({
      organizationId,
      userId: authResult.session.user.id,
      action: "report.restore",
      targetType: "report",
      targetId: restored.id,
      detail: {
        reportId: restored.id,
        studentId: restored.studentId,
        status: restored.status,
      },
    });

    revalidateTag(`student-directory:${organizationId}`, "max");
    revalidateTag(`dashboard-snapshot:${organizationId}`, "max");
    revalidateTag(getLogListCacheTag(organizationId), "max");
    revalidatePath("/app/dashboard");
    revalidatePath("/app/students");
    revalidatePath("/app/logs");
    revalidatePath("/app/reports");
    revalidatePath(`/app/students/${restored.studentId}`);

    return NextResponse.json({
      success: true,
      reportId: restored.id,
      studentId: restored.studentId,
    });
  } catch (error: any) {
    console.error("[POST /api/reports/[id]/restore] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
