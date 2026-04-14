import { NextResponse } from "next/server";
import {
  loadAuthorizedSessionPartContext,
  parseLiveChunkSubmissionFormData,
  parseLiveFinalizeSubmissionBody,
} from "../session-part-route-common";
import { handleFinalizeLiveSessionPart, handleLiveChunkSubmission } from "../session-part-live";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const access = await loadAuthorizedSessionPartContext(params.id);
    if ("response" in access) return access.response;

    const contentType = request.headers.get("content-type") || "";
    if (/multipart\/form-data/i.test(contentType)) {
      const submission = parseLiveChunkSubmissionFormData(await request.formData());
      return await handleLiveChunkSubmission({ access, submission });
    }

    const submission = parseLiveFinalizeSubmissionBody(await request.json().catch(() => ({})));
    return await handleFinalizeLiveSessionPart({ access, submission });
  } catch (error: any) {
    console.error("[POST /api/sessions/[id]/parts/live] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
