import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { getSendingConfigSummary, getTrustPolicySummary } from "@/lib/system-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function canManageSettings(role: string | undefined) {
  return role === UserRole.ADMIN || role === UserRole.MANAGER || role === "ADMIN" || role === "MANAGER";
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const organizationId = session.user.organizationId;
    const [organization, users, totalStudents, studentsWithGuardian, missingGuardianStudents] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, createdAt: true, updatedAt: true },
      }),
      prisma.user.findMany({
        where: { organizationId },
        select: { id: true, role: true, name: true, email: true },
        orderBy: { name: "asc" },
      }),
      prisma.student.count({
        where: { organizationId },
      }),
      prisma.student.count({
        where: {
          organizationId,
          guardianNames: {
            not: "",
          },
        },
      }),
      prisma.student.findMany({
        where: {
          organizationId,
          OR: [{ guardianNames: null }, { guardianNames: "" }],
        },
        select: {
          id: true,
          name: true,
          grade: true,
          guardianNames: true,
        },
        orderBy: [{ grade: "asc" }, { createdAt: "desc" }],
        take: 8,
      }),
    ]);

    if (!organization) {
      return NextResponse.json({ error: "organization not found" }, { status: 404 });
    }

    const sending = getSendingConfigSummary();
    const trust = getTrustPolicySummary();
    const roleCounts = users.reduce<Record<string, number>>((acc, user) => {
      acc[user.role] = (acc[user.role] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      organization,
      permissions: {
        viewerRole: session.user.role,
        canManage: canManageSettings(session.user.role),
        roleCounts,
      },
      guardianContacts: {
        totalStudents,
        studentsWithGuardian,
        studentsMissingGuardian: Math.max(0, totalStudents - studentsWithGuardian),
        coveragePercent:
          totalStudents > 0 ? Math.round((studentsWithGuardian / Math.max(1, totalStudents)) * 100) : 0,
        missingStudents: missingGuardianStudents,
      },
      sending,
      trust,
    });
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

      return NextResponse.json({ organization });
    }

    if (!studentId) {
      return NextResponse.json({ error: "organizationName または studentId が必要です。" }, { status: 400 });
    }

    if (!guardianNames) {
      return NextResponse.json({ error: "guardianNames を入力してください。" }, { status: 400 });
    }

    const student = await prisma.student.findFirst({
      where: {
        id: studentId,
        organizationId: session.user.organizationId,
      },
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

    return NextResponse.json({ student: updated });
  } catch (error: any) {
    console.error("[PATCH /api/settings] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
