import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { restoreArchivedStudent } from "@/lib/students/student-lifecycle";

function canRestoreStudent(role: string | null | undefined) {
  return role === UserRole.ADMIN || role === UserRole.MANAGER || role === "ADMIN" || role === "MANAGER";
}

export async function POST(_request: Request, { params }: { params: RouteParams }) {
  try {
    const studentId = await resolveRouteId(params);
    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;

    if (!canRestoreStudent(authResult.session.user.role)) {
      return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
    }

    const restored = await restoreArchivedStudent({
      studentId,
      organizationId: authResult.session.user.organizationId,
    });

    if (!restored) {
      return NextResponse.json({ error: "archived student not found" }, { status: 404 });
    }

    await writeAuditLog({
      userId: authResult.session.user.id,
      action: "student.restore",
      detail: {
        studentId: restored.student.id,
        studentName: restored.student.name,
        archiveSnapshotId: restored.latestSnapshotId,
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
    revalidatePath(`/app/students/${restored.student.id}`);

    return NextResponse.json({
      success: true,
      studentId: restored.student.id,
      archiveSnapshotId: restored.latestSnapshotId,
    });
  } catch (error: any) {
    console.error("[POST /api/students/[id]/restore] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
