import { NextResponse } from "next/server";
import { completeRunpodRemoteSttTask } from "@/lib/runpod/remote-stt-queue";
import { describeRequestActor, requireMaintenanceAccess } from "@/lib/server/request-auth";
import { methodNotAllowedResponse, requireSameOriginRequest } from "@/lib/server/request-security";
import type { RunpodRemoteSttSubmitRequest } from "@/lib/runpod/remote-stt-types";

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

    const body = (await request.json()) as RunpodRemoteSttSubmitRequest;
    if (!body?.taskKind || !body?.jobId || !body?.result) {
      return NextResponse.json(
        { ok: false, error: "taskKind, jobId, result が必要です。" },
        { status: 400 }
      );
    }

    await completeRunpodRemoteSttTask(body);

    return NextResponse.json({
      ok: true,
      actor: access.actor ? describeRequestActor(access.actor) : null,
    });
  } catch (error: any) {
    console.error("[POST /api/maintenance/runpod/stt/submit] Error:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
