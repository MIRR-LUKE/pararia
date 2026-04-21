import { NextResponse } from "next/server";
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IdempotencyConflictError,
} from "@/lib/idempotency";
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
  let idempotencyKey: string | null = null;
  let idempotencyStarted = false;

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
    idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || recordingId;
    const idempotency = await beginIdempotency({
      scope: "teacher_recording_upload",
      idempotencyKey,
      requestBody: {
        recordingId,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        durationSecondsHint: Number.isFinite(durationSecondsHint) ? durationSecondsHint : null,
      },
      organizationId: authResult.session.organizationId,
      userId: authResult.session.userId,
      ttlMs: 24 * 60 * 60 * 1000,
    });
    if (idempotency.state === "completed") {
      return NextResponse.json(idempotency.responseBody ?? {}, { status: idempotency.responseStatus ?? 200 });
    }
    if (idempotency.state === "pending") {
      return NextResponse.json(
        { error: "同じ録音の送信がまだ進行中です。少し待ってから再読み込みしてください。" },
        { status: 409 }
      );
    }
    idempotencyStarted = true;

    await uploadTeacherRecordingAudio({
      organizationId: authResult.session.organizationId,
      deviceId: authResult.session.deviceId,
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
      deviceId: authResult.session.deviceId,
      deviceLabel: authResult.session.deviceLabel,
      recordingId,
    });
    const responseBody = {
      recording,
    };
    await completeIdempotency({
      scope: "teacher_recording_upload",
      idempotencyKey,
      responseStatus: 200,
      responseBody,
    });
    return NextResponse.json(responseBody);
  } catch (error: any) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (idempotencyStarted && idempotencyKey) {
      await failIdempotency({
        scope: "teacher_recording_upload",
        idempotencyKey,
      }).catch(() => {});
    }
    console.error("[POST /api/teacher/recordings/[id]/audio] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
