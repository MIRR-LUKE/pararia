import { NextResponse } from "next/server";
import { z } from "zod";
import { dispatchTeacherRecordingUploadJobs } from "@/app/api/teacher/recordings/[id]/audio/route";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { requireTeacherAppMutationSession } from "@/lib/server/teacher-app-session";
import { RequestValidationError, parseJsonWithSchema } from "@/lib/server/request-validation";
import { completeTeacherRecordingBlobUpload, loadTeacherRecordingSummary } from "@/lib/teacher-app/server/recordings";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const blobCompleteRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(191).optional().nullable(),
  byteSize: z.number().int().nonnegative().optional().nullable(),
  durationSecondsHint: z.number().nonnegative().finite().optional().nullable(),
  blob: z.object({
    url: z.string().trim().min(1),
    downloadUrl: z.string().trim().optional().nullable(),
    pathname: z.string().trim().min(1),
    contentType: z.string().trim().optional().nullable(),
    size: z.number().int().nonnegative().optional().nullable(),
  }),
});

export async function POST(request: Request, { params }: { params: RouteParams }) {
  try {
    const authResult = await requireTeacherAppMutationSession(request);
    if (authResult.response) return authResult.response;

    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "teacher.recordings.upload",
      userId: authResult.session.userId,
      organizationId: authResult.session.organizationId,
    });
    if (throttleResponse) return throttleResponse;

    const recordingId = await resolveRouteId(params);
    if (!recordingId) {
      return NextResponse.json({ error: "recordingId が必要です。" }, { status: 400 });
    }

    const body = await parseJsonWithSchema(request, blobCompleteRequestSchema, "Teacher App Blob 完了");
    await completeTeacherRecordingBlobUpload({
      organizationId: authResult.session.organizationId,
      deviceId: authResult.session.deviceId,
      deviceLabel: authResult.session.deviceLabel,
      recordingId,
      fileName: body.fileName,
      mimeType: body.blob.contentType || body.mimeType || "audio/mp4",
      byteSize: body.blob.size ?? body.byteSize ?? null,
      storageUrl: body.blob.url,
      storagePathname: body.blob.pathname,
      durationSecondsHint: body.durationSecondsHint ?? null,
    });

    await dispatchTeacherRecordingUploadJobs(recordingId);

    const recording = await loadTeacherRecordingSummary({
      organizationId: authResult.session.organizationId,
      deviceId: authResult.session.deviceId,
      deviceLabel: authResult.session.deviceLabel,
      recordingId,
    });
    return NextResponse.json({ recording });
  } catch (error: any) {
    console.error("[POST /api/teacher/recordings/[id]/audio/blob-complete] Error:", error);

    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: error?.message ?? "Blob upload completion failed." }, { status: 400 });
  }
}
