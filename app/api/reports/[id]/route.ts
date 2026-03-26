import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;
    const organizationId = authResult.session.user.organizationId;

    const report = await prisma.report.findFirst({
      where: { id: params.id, organizationId },
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
