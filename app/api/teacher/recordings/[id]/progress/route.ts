import { NextResponse } from "next/server";
import { JobStatus, TeacherRecordingJobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { shouldRunBackgroundJobsInline } from "@/lib/jobs/execution-mode";
import { processQueuedTeacherRecordingJobs } from "@/lib/jobs/teacherRecordingJobs";
import { maybeEnsureRunpodWorkerReady } from "@/lib/runpod/worker-ready";
import { applyLightMutationThrottle } from "@/lib/server/request-throttle";
import { resolveRouteId, type RouteParams } from "@/lib/server/route-params";
import {
  requireNativeTeacherAppMutationSession,
  requireNativeTeacherAppSessionForRequest,
} from "@/lib/server/teacher-app-session";
import {
  TEACHER_RECORDING_PROGRESS_WAKE_COOLDOWN_MS,
  shouldRecoverTeacherRecordingProcessing,
} from "@/lib/teacher-app/server/recording-progress-recovery";
import { loadTeacherRecordingSummary } from "@/lib/teacher-app/server/recordings";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const recentTeacherRecordingWakeAt = new Map<string, number>();
const TEACHER_RECORDING_INLINE_RECOVERY_LIMIT = 3;

function readTeacherRecordingProgressReadyTimeoutMs() {
  const parsed = Number(
    process.env.TEACHER_RECORDING_PROGRESS_RUNPOD_READY_TIMEOUT_MS ??
      process.env.TEACHER_RECORDING_RUNPOD_READY_TIMEOUT_MS ??
      process.env.RUNPOD_WORKER_READY_TIMEOUT_MS ??
      20_000
  );
  return Number.isFinite(parsed) ? Math.max(5_000, Math.floor(parsed)) : 20_000;
}

function readTeacherRecordingReadyProxyTimeoutMs() {
  const parsed = Number(
    process.env.TEACHER_RECORDING_RUNPOD_READY_PROXY_TIMEOUT_MS ??
      process.env.RUNPOD_WORKER_READY_PROXY_TIMEOUT_MS ??
      3_000
  );
  return Number.isFinite(parsed) ? Math.max(500, Math.floor(parsed)) : 3_000;
}

async function processTeacherRecordingInline(recordingId: string, label: string) {
  const result = await processQueuedTeacherRecordingJobs(TEACHER_RECORDING_INLINE_RECOVERY_LIMIT, {
    recordingId,
  });
  if (result.errors.length > 0) {
    console.warn(`[${label}] teacher recording inline processing completed with retries/errors`, {
      recordingId,
      result,
    });
  } else {
    console.info(`[${label}] teacher recording inline processing completed`, {
      recordingId,
      result,
    });
  }
  return result;
}

type TeacherRecordingProgressDispatchDeps = {
  processTeacherRecordingInline: typeof processTeacherRecordingInline;
  shouldRunBackgroundJobsInline: typeof shouldRunBackgroundJobsInline;
  maybeEnsureRunpodWorkerReady: typeof maybeEnsureRunpodWorkerReady;
};

async function loadAuthorizedRecording(request: Request, params: RouteParams, mutation = false) {
  const authResult = mutation
    ? await requireNativeTeacherAppMutationSession(request)
    : await requireNativeTeacherAppSessionForRequest(request);
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

async function shouldRecoverTeacherRecordingNow(recordingId: string) {
  const wakeState = await prisma.teacherRecordingSession.findUnique({
    where: { id: recordingId },
    select: {
      uploadedAt: true,
      processingLeaseExpiresAt: true,
      jobs: {
        where: {
          type: TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST,
          status: {
            in: [JobStatus.QUEUED, JobStatus.RUNNING],
          },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          status: true,
        },
      },
    },
  });
  if (!wakeState) {
    return false;
  }
  return shouldRecoverTeacherRecordingProcessing({
    uploadedAt: wakeState.uploadedAt,
    processingLeaseExpiresAt: wakeState.processingLeaseExpiresAt,
    jobStatus: wakeState.jobs[0]?.status ?? null,
  });
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

export async function kickTeacherRecordingProcessing(
  recordingId: string,
  force = false,
  deps: TeacherRecordingProgressDispatchDeps = {
    processTeacherRecordingInline,
    shouldRunBackgroundJobsInline,
    maybeEnsureRunpodWorkerReady,
  }
) {
  if (!force) {
    const shouldRecover = await shouldRecoverTeacherRecordingNow(recordingId).catch(() => false);
    if (!shouldRecover) {
      return;
    }
  }

  if (!shouldWakeTeacherRecordingNow(recordingId)) {
    return;
  }

  if (deps.shouldRunBackgroundJobsInline()) {
    await deps.processTeacherRecordingInline(recordingId, "teacher recording progress inline");
    return {
      mode: "inline" as const,
      workerWake: null,
    };
  }

  const workerReady = await deps.maybeEnsureRunpodWorkerReady({
    // Progress polling should not kill a slow cold-starting pod; let it continue warming
    // and keep the queued job visible for the next poll cycle.
    terminateOnFailure: false,
    timeoutMs: readTeacherRecordingProgressReadyTimeoutMs(),
    proxyTimeoutMs: readTeacherRecordingReadyProxyTimeoutMs(),
  }).catch((error: any) => ({
    attempted: true,
    ok: false,
    stage: "wake_failed" as const,
    podId: null,
    wake: {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error),
    },
    readiness: null,
    error: error?.message ?? String(error),
  }));

  if (workerReady.ok) {
    console.info("[teacher recording progress] Runpod worker ready for teacher recording recovery", {
      recordingId,
      podId: workerReady.podId,
      stage: workerReady.stage,
    });
    return {
      mode: "external" as const,
      workerWake: workerReady,
    };
  }

  console.warn("[teacher recording progress] Runpod worker wake failed; leaving teacher recording queued for retry", {
    recordingId,
    workerReady,
  });
  return {
    mode: "external" as const,
    workerWake: workerReady,
  };
}

export async function GET(request: Request, { params }: { params: RouteParams }) {
  try {
    const loaded = await loadAuthorizedRecording(request, params);
    if (loaded.response) return loaded.response;

    let recording = loaded.recording;
    if (shouldContinueTeacherRecordingInBackground(loaded.recording.status)) {
      await kickTeacherRecordingProcessing(loaded.recordingId!);
      const refreshed = await loadTeacherRecordingSummary({
        organizationId: loaded.authSession!.organizationId,
        deviceId: loaded.authSession!.deviceId,
        deviceLabel: loaded.authSession!.deviceLabel,
        recordingId: loaded.recordingId!,
      }).catch(() => null);
      if (refreshed) {
        recording = refreshed;
      }
    }

    return NextResponse.json({
      recording,
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
        await kickTeacherRecordingProcessing(loaded.recordingId!, true);
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
