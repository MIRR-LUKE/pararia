import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { deleteRuntimeEntries } from "@/lib/runtime-cleanup";
import { requireAuthorizedSession } from "@/lib/server/request-auth";

function normalizeGuardianNames(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const joined = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(" / ");
    return joined.length > 0 ? joined : null;
  }
  throw new TypeError("guardianNames must be a string, string[], or null");
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAuthorizedSession();
  if (authResult.response) return authResult.response;

  const student = await prisma.student.findFirst({
    where: { id: params.id, organizationId: authResult.session.user.organizationId },
    include: {
      profiles: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      conversations: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      reports: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ student });
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;

    const existing = await prisma.student.findFirst({
      where: { id: params.id, organizationId: authResult.session.user.organizationId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, nameKana, grade, course, guardianNames, enrollmentDate, birthdate } = body ?? {};

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (nameKana !== undefined) data.nameKana = nameKana;
    if (grade !== undefined) data.grade = grade;
    if (course !== undefined) data.course = course;
    if (guardianNames !== undefined) data.guardianNames = normalizeGuardianNames(guardianNames);
    if (enrollmentDate !== undefined)
      data.enrollmentDate = enrollmentDate ? new Date(enrollmentDate) : null;
    if (birthdate !== undefined) data.birthdate = birthdate ? new Date(birthdate) : null;

    const student = await prisma.student.update({
      where: { id: existing.id },
      data,
    });

    revalidateTag(`student-directory:${authResult.session.user.organizationId}`, "max");
    revalidateTag(`dashboard-snapshot:${authResult.session.user.organizationId}`, "max");
    revalidateTag(getLogListCacheTag(authResult.session.user.organizationId), "max");
    revalidatePath("/app/students");
    revalidatePath("/app/dashboard");
    revalidatePath("/app/reports");
    revalidatePath("/app/settings");
    revalidatePath(`/app/students/${student.id}`);

    return NextResponse.json({ student });
  } catch (e: any) {
    if (e instanceof TypeError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[PUT /api/students/[id]] Error:", {
      error: e?.message,
      stack: e?.stack,
    });
    return NextResponse.json(
      { error: e?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;

    const student = await prisma.student.findFirst({
      where: { id: params.id, organizationId: authResult.session.user.organizationId },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            conversations: true,
            sessions: true,
            reports: true,
            profiles: true,
          },
        },
      },
    });

    if (!student) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const conversationIds = await prisma.conversationLog.findMany({
      where: { studentId: student.id, organizationId: authResult.session.user.organizationId },
      select: { id: true },
    });
    const sessionParts = await prisma.sessionPart.findMany({
      where: {
        session: {
          studentId: student.id,
          organizationId: authResult.session.user.organizationId,
        },
      },
      select: {
        storageUrl: true,
      },
    });
    const runtimePaths = sessionParts.map((part) => part.storageUrl);

    await prisma.$transaction(async (tx) => {
      if (conversationIds.length > 0) {
        await tx.conversationJob.deleteMany({
          where: { conversationId: { in: conversationIds.map((conversation) => conversation.id) } },
        });
      }

      await tx.report.deleteMany({
        where: { studentId: student.id, organizationId: authResult.session.user.organizationId },
      });
      await tx.conversationLog.deleteMany({
        where: { studentId: student.id, organizationId: authResult.session.user.organizationId },
      });
      await tx.studentProfile.deleteMany({ where: { studentId: student.id } });
      await tx.studentRecordingLock.deleteMany({ where: { studentId: student.id } });
      await tx.session.deleteMany({
        where: { studentId: student.id, organizationId: authResult.session.user.organizationId },
      });
      await tx.student.delete({ where: { id: student.id } });
    });
    const runtimeDeletion = await deleteRuntimeEntries(runtimePaths);

    await writeAuditLog({
      userId: authResult.session.user.id,
      action: "student.delete",
      detail: {
        studentId: student.id,
        studentName: student.name,
        conversationCount: student._count.conversations,
        sessionCount: student._count.sessions,
        reportCount: student._count.reports,
        profileCount: student._count.profiles,
        deletedRuntimeEntryCount: runtimeDeletion.deletedCount,
      },
    });

    revalidateTag(`student-directory:${authResult.session.user.organizationId}`, "max");
    revalidateTag(`dashboard-snapshot:${authResult.session.user.organizationId}`, "max");
    revalidateTag(getLogListCacheTag(authResult.session.user.organizationId), "max");
    revalidatePath("/app/students");
    revalidatePath("/app/dashboard");
    revalidatePath("/app/reports");
    revalidatePath("/app/settings");
    revalidatePath("/app/logs");
    revalidatePath(`/app/students/${student.id}`);

    return NextResponse.json({
      success: true,
      message: "student deleted",
      studentId: student.id,
      deletedRuntimeEntryCount: runtimeDeletion.deletedCount,
    });
  } catch (e: any) {
    console.error("[DELETE /api/students/[id]] Error:", {
      error: e?.message,
      stack: e?.stack,
    });
    return NextResponse.json(
      { error: e?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
