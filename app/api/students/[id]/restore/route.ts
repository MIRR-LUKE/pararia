import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { canRestoreStudent } from "@/lib/permissions";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { requireAuthorizedMutationSession } from "@/lib/server/request-auth";
import { StudentLimitExceededError } from "@/lib/students/student-limit";
import { restoreArchivedStudent } from "@/lib/students/student-lifecycle";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";

const AUDIT_WARNING_MESSAGE = "更新自体は完了しましたが、監査記録の保存に失敗しました。管理者へ連絡してください。";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await Promise.resolve(params);
    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;

    if (!canRestoreStudent(authResult.session.user.role)) {
      return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
    }
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "students.restore",
      userId: authResult.session.user.id,
      organizationId: authResult.session.user.organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const restored = await restoreArchivedStudent({
      studentId: id,
      organizationId: authResult.session.user.organizationId,
    });

    if (!restored) {
      return NextResponse.json({ error: "archived student not found" }, { status: 404 });
    }

    const auditLogged = await writeAuditLog({
      organizationId: authResult.session.user.organizationId,
      userId: authResult.session.user.id,
      action: "student.restore",
      targetType: "student",
      targetId: restored.student.id,
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

    return NextResponse.json(
      {
        success: true,
        studentId: restored.student.id,
        archiveSnapshotId: restored.latestSnapshotId,
        auditWarning: auditLogged ? null : AUDIT_WARNING_MESSAGE,
      },
      auditLogged ? undefined : { status: 202, headers: { "X-Pararia-Audit-Warning": "1" } }
    );
  } catch (error: any) {
    if (error instanceof StudentLimitExceededError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[POST /api/students/[id]/restore] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
