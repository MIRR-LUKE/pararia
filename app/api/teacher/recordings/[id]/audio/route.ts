import { NextResponse } from "next/server";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { processQueuedTeacherRecordingJobs } from "@/lib/jobs/teacherRecordingJobs";
import { runAfterResponse } from "@/lib/server/after-response";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import { requireTeacherAppMutationSession } from "@/lib/server/teacher-app-session";
import { loadTeacherRecordingSummary, uploadTeacherRecordingAudio } from "@/lib/teacher-app/server/recordings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file が必要です。" }, { status: 400 });
    }
    const durationSecondsHint = Number(formData.get("durationSecondsHint") ?? NaN);

    await uploadTeacherRecordingAudio({
      organizationId: authResult.session.organizationId,
      deviceLabel: authResult.session.deviceLabel,
      recordingId,
      file,
      durationSecondsHint: Number.isFinite(durationSecondsHint) ? durationSecondsHint : null,
    });

    if (shouldRunBackgroundJobsInline()) {
      void processQueuedTeacherRecordingJobs(1, { recordingId }).catch((error) => {
        console.error("[POST /api/teacher/recordings/[id]/audio] Inline teacher recording processing failed:", error);
      });
    } else {
      runAfterResponse(async () => {
        await maybeEnsureRunpodWorker()
          .then((workerWake) => {
            if (workerWake?.attempted && !workerWake.ok) {
              console.error("[POST /api/teacher/recordings/[id]/audio] Runpod worker wake failed:", workerWake);
            }
          })
          .catch((error) => {
            console.error("[POST /api/teacher/recordings/[id]/audio] Runpod worker wake threw:", error);
          });
      }, "POST /api/teacher/recordings/[id]/audio wake runpod");
    }

    const recording = await loadTeacherRecordingSummary({
      organizationId: authResult.session.organizationId,
      deviceLabel: authResult.session.deviceLabel,
      recordingId,
    });
    return NextResponse.json({
      recording,
    });
  } catch (error: any) {
    console.error("[POST /api/teacher/recordings/[id]/audio] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
