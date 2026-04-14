import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { canManageSettings, getSettingsSnapshot } from "@/lib/settings/get-settings-snapshot";
import { withActiveStudentWhere } from "@/lib/students/student-lifecycle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const snapshot = await getSettingsSnapshot({
      organizationId: session.user.organizationId,
      viewerRole: session.user.role,
    });

    if (!snapshot) {
      return NextResponse.json({ error: "organization not found" }, { status: 404 });
    }

    return NextResponse.json(snapshot);
  } catch (error: any) {
    console.error("[GET /api/settings] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageSettings(session.user.role)) {
      return NextResponse.json({ error: "この操作は管理者または室長のみ可能です。" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const nextOrganizationName =
      typeof body?.organizationName === "string" ? body.organizationName.trim().slice(0, 120) : "";
    const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
    const guardianNames = typeof body?.guardianNames === "string" ? body.guardianNames.trim().slice(0, 120) : "";

    if (nextOrganizationName) {
      const organization = await prisma.organization.update({
        where: { id: session.user.organizationId },
        data: { name: nextOrganizationName },
        select: { id: true, name: true, updatedAt: true },
      });

      await writeAuditLog({
        userId: session.user.id,
        action: "settings.organization.update",
        detail: { organizationId: organization.id, organizationName: organization.name },
      });

      revalidatePath("/app/settings");

      return NextResponse.json({ organization });
    }

    if (!studentId) {
      return NextResponse.json({ error: "organizationName または studentId が必要です。" }, { status: 400 });
    }

    if (!guardianNames) {
      return NextResponse.json({ error: "guardianNames を入力してください。" }, { status: 400 });
    }

    const student = await prisma.student.findFirst({
      where: withActiveStudentWhere({
        id: studentId,
        organizationId: session.user.organizationId,
      }),
      select: {
        id: true,
        name: true,
        guardianNames: true,
      },
    });

    if (!student) {
      return NextResponse.json({ error: "student not found" }, { status: 404 });
    }

    const updated = await prisma.student.update({
      where: { id: student.id },
      data: { guardianNames },
      select: {
        id: true,
        name: true,
        guardianNames: true,
      },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "settings.guardian.update",
      detail: {
        studentId: updated.id,
        studentName: updated.name,
        hasGuardianNames: Boolean(updated.guardianNames?.trim()),
      },
    });

    revalidateTag(`student-directory:${session.user.organizationId}`, "max");
    revalidatePath("/app/settings");
    revalidatePath("/app/students");
    revalidatePath(`/app/students/${updated.id}`);

    return NextResponse.json({ student: updated });
  } catch (error: any) {
    console.error("[PATCH /api/settings] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
