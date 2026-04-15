import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { canManageStaff } from "@/lib/permissions";
import { withVisibleConversationWhere } from "@/lib/content-visibility";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";
import { prisma } from "@/lib/db";
import { requireAuthorizedMutationSession } from "@/lib/server/request-auth";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { syncSessionAfterConversation } from "@/lib/session-service";

export async function POST(
  request: Request,
  { params }: { params: RouteParams }
) {
  try {
    const conversationId = await resolveRouteId(params);
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const authResult = await requireAuthorizedMutationSession(request);
    if (authResult.response) return authResult.response;
    if (!canManageStaff(authResult.session.user.role)) {
      return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
    }
    const organizationId = authResult.session.user.organizationId;
    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "conversations.restore",
      userId: authResult.session.user.id,
      organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const current = await prisma.conversationLog.findFirst({
      where: {
        id: conversationId,
        organizationId,
        deletedAt: { not: null },
      },
      select: {
        id: true,
        studentId: true,
        sessionId: true,
        deletedSessionId: true,
        status: true,
      },
    });

    if (!current) {
      return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    }

    if (current.deletedSessionId) {
      const conflictingConversation = await prisma.conversationLog.findFirst({
        where: withVisibleConversationWhere({
          organizationId,
          sessionId: current.deletedSessionId,
        }),
        select: { id: true },
      });
      if (conflictingConversation && conflictingConversation.id !== current.id) {
        return NextResponse.json(
          { error: "この会話の元セッションには、すでに別のログが入っているため復元できません。" },
          { status: 409 }
        );
      }
    }

    const restored = await prisma.conversationLog.update({
      where: { id: current.id },
      data: {
        deletedAt: null,
        deletedByUserId: null,
        deletedReason: null,
        sessionId: current.deletedSessionId ?? current.sessionId ?? null,
        deletedSessionId: null,
      },
    });

    if (restored.sessionId) {
      await syncSessionAfterConversation(restored.id).catch(() => {});
    }

    await writeAuditLog({
      organizationId,
      userId: authResult.session.user.id,
      action: "conversation.restore",
      targetType: "conversation",
      targetId: restored.id,
      detail: {
        conversationId: restored.id,
        studentId: restored.studentId,
        sessionId: restored.sessionId,
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
      conversationId: restored.id,
      sessionId: restored.sessionId,
    });
  } catch (error: any) {
    console.error("[POST /api/conversations/[id]/restore] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
