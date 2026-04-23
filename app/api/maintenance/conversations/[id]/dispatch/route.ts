import { NextResponse } from "next/server";
import { processConversationJobsOutsideRunpod } from "@/lib/jobs/conversation-jobs/app-dispatch";
import { describeRequestActor, requireMaintenanceAccess } from "@/lib/server/request-auth";
import { methodNotAllowedResponse, requireSameOriginRequest } from "@/lib/server/request-security";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return methodNotAllowedResponse(["POST"]);
}

export async function POST(request: Request, { params }: { params: RouteParams }) {
  try {
    const access = await requireMaintenanceAccess(request);
    if (access.response) return access.response;

    if (access.actor?.kind === "session") {
      const sameOriginResponse = requireSameOriginRequest(request);
      if (sameOriginResponse) return sameOriginResponse;
    }

    const conversationId = await resolveRouteId(params);
    if (!conversationId) {
      return NextResponse.json({ ok: false, error: "conversationId が必要です。" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { requireRunpodStopped?: boolean };
    const dispatch = await processConversationJobsOutsideRunpod(conversationId, {
      requireRunpodStopped: body.requireRunpodStopped !== false,
    });

    return NextResponse.json({
      ok: true,
      dispatch,
      actor: access.actor ? describeRequestActor(access.actor) : null,
    });
  } catch (error: any) {
    console.error("[POST /api/maintenance/conversations/[id]/dispatch] Error:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
