import { NextResponse } from "next/server";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import {
  loadAuthorizedSessionPartContext,
  parseSessionPartSubmissionFormData,
} from "./session-part-route-common";
import { handleSessionPartSubmission } from "./session-part-ingest";

export async function POST(
  request: Request,
  { params }: { params: RouteParams }
) {
  try {
    const sessionId = await resolveRouteId(params);
    const access = await loadAuthorizedSessionPartContext(sessionId);
    if ("response" in access) return access.response;

    const submission = parseSessionPartSubmissionFormData(await request.formData());
    return await handleSessionPartSubmission({ access, submission });
  } catch (error: any) {
    console.error("[POST /api/sessions/[id]/parts] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
