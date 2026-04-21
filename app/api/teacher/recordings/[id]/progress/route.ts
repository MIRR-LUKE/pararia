import { NextResponse } from "next/server";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { processQueuedTeacherRecordingJobs } from "@/lib/jobs/teacherRecordingJobs";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { runAfterResponse } from "@/lib/server/after-response";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import {
  requireTeacherAppMutationSession,
  requireTeacherAppSessionForRequest,
} from "@/lib/server/teacher-app-session";
import { loadTeacherRecordingSummary } from "@/lib/teacher-app/server/recordings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TEACHER_RECORDING_PROGRESS_WAKE_COOLDOWN_MS = 4_000;
const recentTeacherRecordingWakeAt = new Map<string, number>();

async function loadAuthorizedRecording(request: Request, params: RouteParams, mutation = false) {
  const authResult = mutation
    ? await requireTeacherAppMutationSession(request)
    : await requireTeacherAppSessionForRequest(request);
  if (authResult.response) {
    return {
      authSession: null,
      recording: null,
      recordingId: null,
      response: authResult.response,
    } as const;
  }

  const recordingId = await resolveRouteId(params);
  if (!recordingId) {
    return {
      authSession: authResult.session,
      recording: null,
      recordingId: null,
      response: NextResponse.json({ error: "recordingId が必要です。" }, { status: 400 }),
    } as const;
  }

  const recording = await loadTeacherRecordingSummary({
    organizationId: authResult.session.organizationId,
    deviceId: authResult.session.deviceId,
    deviceLabel: authResult.session.deviceLabel,
    recordingId,
  });
  if (!recording) {
    return {
      authSession: authResult.session,
      recording: null,
      recordingId,
      response: NextResponse.json({ error: "録音セッションが見つかりません。" }, { status: 404 }),
    } as const;
  }

  return {
    authSession: authResult.session,
    recording,
    recordingId,
    response: null,
  } as const;
}

function shouldContinueTeacherRecordingInBackground(status: string) {
  return status === "TRANSCRIBING";
}

function shouldWakeTeacherRecordingNow(recordingId: string, now = Date.now()) {
  for (const [entryKey, lastTriggeredAt] of recentTeacherRecordingWakeAt.entries()) {
    if (now - lastTriggeredAt >= TEACHER_RECORDING_PROGRESS_WAKE_COOLDOWN_MS) {
      recentTeacherRecordingWakeAt.delete(entryKey);
    }
  }

  const lastTriggeredAt = recentTeacherRecordingWakeAt.get(recordingId);
  if (
    typeof lastTriggeredAt === "number" &&
    now - lastTriggeredAt < TEACHER_RECORDING_PROGRESS_WAKE_COOLDOWN_MS
  ) {
    return false;
  }

  recentTeacherRecordingWakeAt.set(recordingId, now);
  return true;
}

function kickTeacherRecordingProcessing(recordingId: string) {
  if (!shouldWakeTeacherRecordingNow(recordingId)) {
    return;
  }

  if (shouldRunBackgroundJobsInline()) {
    runAfterResponse(
      async () => {
        await processQueuedTeacherRecordingJobs(1, { recordingId }).catch(() => {});
      },
      "teacher recording progress inline"
    );
    return;
  }

  runAfterResponse(async () => {
    await maybeEnsureRunpodWorker()
      .then((workerWake) => {
        if (workerWake?.attempted && !workerWake.ok) {
          console.error("[teacher recording progress] Runpod worker wake failed:", workerWake);
        }
      })
      .catch((error) => {
        console.error("[teacher recording progress] Runpod worker wake threw:", error);
      });
  }, "teacher recording progress wake runpod");
}

export async function GET(request: Request, { params }: { params: RouteParams }) {
  try {
    const loaded = await loadAuthorizedRecording(request, params);
    if (loaded.response) return loaded.response;

    if (shouldContinueTeacherRecordingInBackground(loaded.recording.status)) {
      kickTeacherRecordingProcessing(loaded.recordingId!);
    }

    return NextResponse.json({
      recording: loaded.recording,
    });
  } catch (error: any) {
    console.error("[GET /api/teacher/recordings/[id]/progress] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: RouteParams }) {
  try {
    const loaded = await loadAuthorizedRecording(request, params, true);
    if (loaded.response) return loaded.response;

    const throttleResponse = await applyLightMutationThrottle({
      request,
      scope: "teacher.recordings.progress",
      userId: loaded.authSession!.userId,
      organizationId: loaded.authSession!.organizationId,
    });
    if (throttleResponse) return throttleResponse;

    if (shouldContinueTeacherRecordingInBackground(loaded.recording.status)) {
      if (shouldRunBackgroundJobsInline()) {
        await processQueuedTeacherRecordingJobs(1, { recordingId: loaded.recordingId! }).catch(() => {});
      } else {
        kickTeacherRecordingProcessing(loaded.recordingId!);
      }
    }

    const refreshed = await loadTeacherRecordingSummary({
      organizationId: loaded.authSession!.organizationId,
      deviceId: loaded.authSession!.deviceId,
      deviceLabel: loaded.authSession!.deviceLabel,
      recordingId: loaded.recordingId!,
    });

    return NextResponse.json({
      recording: refreshed,
    });
  } catch (error: any) {
    console.error("[POST /api/teacher/recordings/[id]/progress] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
