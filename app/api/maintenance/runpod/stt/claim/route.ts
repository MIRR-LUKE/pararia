import { NextResponse } from "next/server";
import { claimNextRunpodRemoteSttTask } from "@/lib/runpod/remote-stt-queue";
import { describeRequestActor, requireMaintenanceAccess } from "@/lib/server/request-auth";
import { methodNotAllowedResponse, requireSameOriginRequest } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return methodNotAllowedResponse(["POST"]);
}

export async function POST(request: Request) {
  try {
    const access = await requireMaintenanceAccess(request);
    if (access.response) return access.response;

    if (access.actor?.kind === "session") {
      const sameOriginResponse = requireSameOriginRequest(request);
      if (sameOriginResponse) return sameOriginResponse;
    }

    const body = (await request.json().catch(() => ({}))) as {
      healthcheck?: boolean;
      sessionId?: string | null;
    };
    if (body.healthcheck) {
      return NextResponse.json({
        ok: true,
        ready: true,
        actor: access.actor ? describeRequestActor(access.actor) : null,
      });
    }

    const task = await claimNextRunpodRemoteSttTask({
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    });

    return NextResponse.json({
      ok: true,
      task,
      actor: access.actor ? describeRequestActor(access.actor) : null,
    });
  } catch (error: any) {
    console.error("[POST /api/maintenance/runpod/stt/claim] Error:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
