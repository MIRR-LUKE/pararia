import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { archiveStudent, withActiveStudentWhere } from "@/lib/students/student-lifecycle";
import { normalizeStudentUpdateInput } from "@/lib/students/student-write";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await Promise.resolve(params);
  const authResult = await requireAuthorizedSession();
  if (authResult.response) return authResult.response;

  const student = await prisma.student.findFirst({
    where: withActiveStudentWhere({ id, organizationId: authResult.session.user.organizationId }),
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;

    const existing = await prisma.student.findFirst({
      where: withActiveStudentWhere({ id, organizationId: authResult.session.user.organizationId }),
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const body = await request.json();
    const data = normalizeStudentUpdateInput(body);

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
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;

    const body = await request.json().catch(() => ({}));
    const archiveReason =
      typeof body?.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim()
        : "manual_archive";
    const archived = await archiveStudent({
      studentId: id,
      organizationId: authResult.session.user.organizationId,
      actorUserId: authResult.session.user.id,
      reason: archiveReason,
    });

    if (!archived) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    await writeAuditLog({
      userId: authResult.session.user.id,
      action: "student.archive",
      detail: {
        studentId: archived.student.id,
        studentName: archived.student.name,
        archiveReason,
        archiveSnapshotId: archived.snapshotId,
        conversationCount: archived.counts.conversations,
        sessionCount: archived.counts.sessions,
        reportCount: archived.counts.reports,
        profileCount: archived.counts.profiles,
        preservedRuntimeEntryCount: archived.runtimePaths.length,
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
    revalidatePath(`/app/students/${archived.student.id}`);

    return NextResponse.json({
      success: true,
      message: "student archived",
      studentId: archived.student.id,
      archiveSnapshotId: archived.snapshotId,
      preservedRuntimeEntryCount: archived.runtimePaths.length,
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
