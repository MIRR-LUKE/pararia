import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { getSettingsSnapshot } from "@/lib/settings/get-settings-snapshot";
import { withActiveStudentWhere } from "@/lib/students/student-lifecycle";
import { canManageSettings } from "@/lib/permissions";

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
    const organizationInput =
      body?.organization && typeof body.organization === "object" ? body.organization : body;
    const nextOrganizationName =
      typeof organizationInput?.organizationName === "string"
        ? organizationInput.organizationName.trim().slice(0, 120)
        : "";
    const nextPlanCode =
      typeof organizationInput?.planCode === "string" ? organizationInput.planCode.trim().slice(0, 40) : "";
    const nextDefaultLocale =
      typeof organizationInput?.defaultLocale === "string"
        ? organizationInput.defaultLocale.trim().slice(0, 40)
        : "";
    const nextDefaultTimeZone =
      typeof organizationInput?.defaultTimeZone === "string"
        ? organizationInput.defaultTimeZone.trim().slice(0, 80)
        : "";
    const nextConsentVersion =
      typeof organizationInput?.consentVersion === "string"
        ? organizationInput.consentVersion.trim().slice(0, 80)
        : "";
    const studentLimit =
      organizationInput?.studentLimit === null || organizationInput?.studentLimit === ""
        ? null
        : Number.isFinite(Number(organizationInput?.studentLimit))
          ? Math.max(0, Math.floor(Number(organizationInput.studentLimit)))
          : undefined;
    const guardianConsentRequired =
      typeof organizationInput?.guardianConsentRequired === "boolean"
        ? organizationInput.guardianConsentRequired
        : undefined;
    const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
    const guardianNames = typeof body?.guardianNames === "string" ? body.guardianNames.trim().slice(0, 120) : "";

    if (
      nextOrganizationName ||
      nextPlanCode ||
      nextDefaultLocale ||
      nextDefaultTimeZone ||
      nextConsentVersion ||
      studentLimit !== undefined ||
      guardianConsentRequired !== undefined
    ) {
      const currentOrganization = await prisma.organization.findUnique({
        where: { id: session.user.organizationId },
        select: {
          id: true,
          name: true,
          planCode: true,
          studentLimit: true,
          defaultLocale: true,
          defaultTimeZone: true,
          guardianConsentRequired: true,
          consentVersion: true,
        },
      });
      if (!currentOrganization) {
        return NextResponse.json({ error: "organization not found" }, { status: 404 });
      }

      const organizationData: Record<string, unknown> = {};
      if (nextOrganizationName) organizationData.name = nextOrganizationName;
      if (nextPlanCode) organizationData.planCode = nextPlanCode;
      if (nextDefaultLocale) organizationData.defaultLocale = nextDefaultLocale;
      if (nextDefaultTimeZone) organizationData.defaultTimeZone = nextDefaultTimeZone;
      if (studentLimit !== undefined) organizationData.studentLimit = studentLimit;
      if (guardianConsentRequired !== undefined) organizationData.guardianConsentRequired = guardianConsentRequired;
      if (nextConsentVersion) organizationData.consentVersion = nextConsentVersion;
      if (
        guardianConsentRequired !== undefined ||
        (nextConsentVersion && nextConsentVersion !== currentOrganization.consentVersion)
      ) {
        organizationData.consentUpdatedAt = new Date();
      }

      const organization = await prisma.organization.update({
        where: { id: session.user.organizationId },
        data: organizationData,
        select: {
          id: true,
          name: true,
          planCode: true,
          studentLimit: true,
          defaultLocale: true,
          defaultTimeZone: true,
          guardianConsentRequired: true,
          consentVersion: true,
          consentUpdatedAt: true,
          updatedAt: true,
        },
      });

      await writeAuditLog({
        organizationId: session.user.organizationId,
        userId: session.user.id,
        action: "settings.organization.update",
        targetType: "organization",
        targetId: organization.id,
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
      organizationId: session.user.organizationId,
      userId: session.user.id,
      action: "settings.guardian.update",
      targetType: "student",
      targetId: updated.id,
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
