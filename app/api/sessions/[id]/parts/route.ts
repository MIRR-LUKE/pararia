import { NextResponse } from "next/server";
import { RequestValidationError } from "@/lib/server/request-validation";
import {
  loadAuthorizedSessionPartContext,
  parseSessionPartSubmissionFormData,
} from "./session-part-route-common";
import { handleSessionPartSubmission } from "./session-part-ingest";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const access = await loadAuthorizedSessionPartContext(id, request);
    if ("response" in access) return access.response;

    const submission = parseSessionPartSubmissionFormData(await request.formData());
    return await handleSessionPartSubmission({ access, submission });
  } catch (error: any) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[POST /api/sessions/[id]/parts] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
