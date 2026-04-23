#!/usr/bin/env tsx

import { stopFasterWhisperWorkers, warmFasterWhisperWorkers } from "../lib/ai/stt";
import { writeAuditLog } from "../lib/audit";
import { processQueuedJobs } from "../lib/jobs/conversationJobs";
import { processQueuedSessionPartJobs } from "../lib/jobs/sessionPartJobs";
import { processQueuedTeacherRecordingJobs } from "../lib/jobs/teacherRecordingJobs";
import { stopCurrentRunpodPod } from "../lib/runpod/worker-control";
import { readRunpodWorkerRuntimeMetadata } from "../lib/runpod/runtime-metadata";
import { saveStorageText } from "../lib/audio-storage";
import { prisma } from "../lib/db";

type QueueRunResult = {
  processed: number;
  errors: string[];
};

type WorkerScope = {
  sessionId?: string;
  conversationId?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readIntEnvWithLegacy(name: string, legacyName: string, fallback: number) {
  const value = process.env[name] ?? process.env[legacyName] ?? fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

function readNonNegativeIntEnvWithLegacy(name: string, legacyName: string, fallback: number) {
  const value = process.env[name] ?? process.env[legacyName] ?? fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function readOptionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function getEffectiveConversationLimit(conversationLimit: number) {
  if (process.env.PARARIA_BACKGROUND_MODE?.trim() === "external") {
    return 0;
  }
  return conversationLimit;
}

function getConversationWorkerMode(conversationLimit: number) {
  return conversationLimit > 0 ? "stt+conversation" : "stt-only";
}

function getWorkerHeartbeatPath(fileName: string) {
  const podId = process.env.RUNPOD_POD_ID?.trim() || "local";
  return `runpod-worker/heartbeats/${podId}/${fileName}`;
}

async function recordWorkerStartupHeartbeat(input: {
  scope: WorkerScope;
  sessionPartLimit: number;
  sessionPartConcurrency: number;
  conversationLimit: number;
  conversationConcurrency: number;
  autoStopIdleMs: number;
  idleWaitMs: number;
  activeWaitMs: number;
  once: boolean;
  sttWarm?: {
    model?: string;
    device?: string;
    computeType?: string;
    pipeline?: string;
    batchSize?: number;
    gpuName?: string;
    gpuComputeCapability?: string;
  } | null;
}) {
  const runtimeMetadata = readRunpodWorkerRuntimeMetadata();
  const payload = {
    event: "worker_process_started",
    podId: process.env.RUNPOD_POD_ID?.trim() || null,
    startedAt: new Date().toISOString(),
    scope: input.scope,
    sessionPartLimit: input.sessionPartLimit,
    sessionPartConcurrency: input.sessionPartConcurrency,
    conversationLimit: input.conversationLimit,
    conversationConcurrency: input.conversationConcurrency,
    autoStopIdleMs: input.autoStopIdleMs,
    idleWaitMs: input.idleWaitMs,
    activeWaitMs: input.activeWaitMs,
    once: input.once,
    sttWarm: input.sttWarm ?? null,
    ...runtimeMetadata,
  };

  void saveStorageText({
    storagePathname: getWorkerHeartbeatPath("startup.json"),
    text: JSON.stringify(payload, null, 2),
    allowOverwrite: true,
  }).catch(() => {});

  await writeAuditLog({
    organizationId: null,
    action: "runpod_worker_bootstrap",
    targetType: "worker",
    targetId: payload.podId as string | null,
    detail: {
      podId: payload.podId,
      sessionId: (payload.scope as WorkerScope | undefined)?.sessionId ?? null,
      conversationId: (payload.scope as WorkerScope | undefined)?.conversationId ?? null,
      sessionPartLimit: payload.sessionPartLimit,
      conversationLimit: payload.conversationLimit,
    },
  }).catch(() => {});

  return payload;
}

async function recordWorkerReadyHeartbeat(payload: Record<string, unknown>) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await writeAuditLog({
      organizationId: null,
      action: "runpod_worker_startup",
      targetType: "worker",
      targetId: payload.podId as string | null,
      detail: {
        podId: payload.podId,
        sessionId: (payload.scope as WorkerScope | undefined)?.sessionId ?? null,
        conversationId: (payload.scope as WorkerScope | undefined)?.conversationId ?? null,
        sessionPartLimit: payload.sessionPartLimit,
        conversationLimit: payload.conversationLimit,
      },
    });
    await saveStorageText({
      storagePathname: getWorkerHeartbeatPath("db-ok.json"),
      text: JSON.stringify(
        {
          ...payload,
          event: "worker_db_ok",
          checkedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      allowOverwrite: true,
    }).catch(() => {});
  } catch (error: any) {
    await saveStorageText({
      storagePathname: getWorkerHeartbeatPath("db-error.json"),
      text: JSON.stringify(
        {
          ...payload,
          event: "worker_db_error",
          checkedAt: new Date().toISOString(),
          error: error?.message ?? String(error),
        },
        null,
        2
      ),
      allowOverwrite: true,
    }).catch(() => {});
    throw error;
  }
}

async function processQueueOnce(
  teacherRecordingLimit: number,
  sessionPartLimit: number,
  sessionPartConcurrency: number,
  conversationLimit: number,
  conversationConcurrency: number,
  scope: WorkerScope
) {
  const empty: QueueRunResult = { processed: 0, errors: [] };
  const teacherRecordingJobs =
    teacherRecordingLimit > 0
      ? await processQueuedTeacherRecordingJobs(teacherRecordingLimit)
      : empty;
  const sessionPartJobs =
    sessionPartLimit > 0
      ? await processQueuedSessionPartJobs(sessionPartLimit, sessionPartConcurrency, scope.sessionId ? { sessionId: scope.sessionId } : undefined)
      : empty;
  const conversationJobs =
    conversationLimit > 0
      ? await processQueuedJobs(
          conversationLimit,
          conversationConcurrency,
          scope.conversationId || scope.sessionId
            ? {
                ...(scope.conversationId ? { conversationId: scope.conversationId } : {}),
                ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
              }
            : undefined
        )
      : empty;
  return {
    teacherRecordingJobs,
    sessionPartJobs,
    conversationJobs,
    processed: teacherRecordingJobs.processed + sessionPartJobs.processed + conversationJobs.processed,
    errors: [...teacherRecordingJobs.errors, ...sessionPartJobs.errors, ...conversationJobs.errors],
  };
}

async function stopPodWhenQueuesDrain(
  teacherRecordingLimit: number,
  sessionPartLimit: number,
  sessionPartConcurrency: number,
  conversationLimit: number,
  conversationConcurrency: number,
  scope: WorkerScope
) {
  const confirm = await processQueueOnce(
    teacherRecordingLimit,
    sessionPartLimit,
    sessionPartConcurrency,
    conversationLimit,
    conversationConcurrency,
    scope
  );
  if (confirm.processed === 0 && confirm.errors.length === 0) {
    const stopResult = await stopCurrentRunpodPod();
    if (!stopResult.ok) {
      console.log("[runpod-worker] queues_drained_stop_failed", {
        podId: process.env.RUNPOD_POD_ID ?? null,
        stopResult,
      });
      return {
        stopped: false,
        confirm,
      };
    }
    console.log("[runpod-worker] queues_drained_stop", {
      podId: process.env.RUNPOD_POD_ID ?? null,
      stopResult,
    });
    return {
      stopped: true,
      confirm,
    };
  }

  console.log("[runpod-worker] queues_drained_stop_aborted", {
    processed: confirm.processed,
    teacherRecordingProcessed: confirm.teacherRecordingJobs.processed,
    sessionPartProcessed: confirm.sessionPartJobs.processed,
    conversationProcessed: confirm.conversationJobs.processed,
    errorCount: confirm.errors.length,
  });
  return {
    stopped: false,
    confirm,
  };
}

async function main() {
  const teacherRecordingLimit = readNonNegativeIntEnvWithLegacy(
    "RUNPOD_WORKER_TEACHER_RECORDING_LIMIT",
    "LOCAL_GPU_WORKER_TEACHER_RECORDING_LIMIT",
    4
  );
  const sessionPartLimit = readNonNegativeIntEnvWithLegacy("RUNPOD_WORKER_SESSION_PART_LIMIT", "LOCAL_GPU_WORKER_SESSION_PART_LIMIT", 8);
  const sessionPartConcurrency = readIntEnvWithLegacy(
    "RUNPOD_WORKER_SESSION_PART_CONCURRENCY",
    "LOCAL_GPU_WORKER_SESSION_PART_CONCURRENCY",
    Number(process.env.SESSION_PART_JOB_CONCURRENCY ?? 1)
  );
  const configuredConversationLimit = readNonNegativeIntEnvWithLegacy(
    "RUNPOD_WORKER_CONVERSATION_LIMIT",
    "LOCAL_GPU_WORKER_CONVERSATION_LIMIT",
    0
  );
  const conversationLimit = getEffectiveConversationLimit(configuredConversationLimit);
  const conversationConcurrency = readIntEnvWithLegacy(
    "RUNPOD_WORKER_CONVERSATION_CONCURRENCY",
    "LOCAL_GPU_WORKER_CONVERSATION_CONCURRENCY",
    Number(process.env.JOB_CONCURRENCY ?? 2)
  );
  const idleWaitMs = readIntEnvWithLegacy("RUNPOD_WORKER_IDLE_WAIT_MS", "LOCAL_GPU_WORKER_IDLE_WAIT_MS", 2500);
  const activeWaitMs = readIntEnvWithLegacy("RUNPOD_WORKER_ACTIVE_WAIT_MS", "LOCAL_GPU_WORKER_ACTIVE_WAIT_MS", 200);
  const defaultAutoStopIdleMs = process.env.RUNPOD_POD_ID?.trim() ? 60 * 1000 : 0;
  const autoStopIdleMs = readNonNegativeIntEnvWithLegacy(
    "RUNPOD_WORKER_AUTO_STOP_IDLE_MS",
    "LOCAL_GPU_WORKER_AUTO_STOP_IDLE_MS",
    defaultAutoStopIdleMs
  );
  const scope: WorkerScope = {
    sessionId: readOptionalEnv("RUNPOD_WORKER_ONLY_SESSION_ID"),
    conversationId: readOptionalEnv("RUNPOD_WORKER_ONLY_CONVERSATION_ID"),
  };
  const once = process.argv.includes("--once");
  const canStopCurrentPod = Boolean(process.env.RUNPOD_POD_ID?.trim());
  let lastActiveAt = Date.now();

  let stopped = false;
  const handleStop = async () => {
    stopped = true;
    stopFasterWhisperWorkers();
  };

  process.on("SIGINT", () => {
    void handleStop();
  });
  process.on("SIGTERM", () => {
    void handleStop();
  });

  console.log("[runpod-worker] started", {
    mode: getConversationWorkerMode(conversationLimit),
    teacherRecordingLimit,
    sessionPartLimit,
    sessionPartConcurrency,
    configuredConversationLimit,
    conversationLimit,
    conversationConcurrency,
    idleWaitMs,
    autoStopIdleMs,
    scope,
    once,
  });

  if (process.env.PARARIA_BACKGROUND_MODE?.trim() === "external") {
    console.warn("[runpod-worker] external mode forces STT-only execution on Runpod.");
  }

  const startupPayload = await recordWorkerStartupHeartbeat({
    scope,
    sessionPartLimit,
    sessionPartConcurrency,
    conversationLimit,
    conversationConcurrency,
    autoStopIdleMs,
    idleWaitMs,
    activeWaitMs,
    once,
    sttWarm: null,
  });

  const warmInfo = await warmFasterWhisperWorkers()
    .then((items) => items[0] ?? null)
    .catch((error: any) => {
      console.error("[runpod-worker] stt_warm_failed", error);
      throw error;
    });

  await recordWorkerReadyHeartbeat({
    ...startupPayload,
    sttWarm: warmInfo
      ? {
          model: warmInfo.model,
          device: warmInfo.device,
          computeType: warmInfo.compute_type,
          pipeline: warmInfo.pipeline,
          batchSize: warmInfo.batch_size,
          gpuName: warmInfo.gpu_name,
          gpuComputeCapability: warmInfo.gpu_compute_capability,
        }
      : null,
  });

  while (!stopped) {
    const tick = await processQueueOnce(
      teacherRecordingLimit,
      sessionPartLimit,
      sessionPartConcurrency,
      conversationLimit,
      conversationConcurrency,
      scope
    );

    if (tick.processed > 0 || tick.errors.length > 0) {
      lastActiveAt = Date.now();
      console.log("[runpod-worker] tick", {
        processed: tick.processed,
        teacherRecordingProcessed: tick.teacherRecordingJobs.processed,
        sessionPartProcessed: tick.sessionPartJobs.processed,
        conversationProcessed: tick.conversationJobs.processed,
        errorCount: tick.errors.length,
      });
    }

    if (canStopCurrentPod && tick.processed > 0 && tick.errors.length === 0) {
      const drained = await stopPodWhenQueuesDrain(
        teacherRecordingLimit,
        sessionPartLimit,
        sessionPartConcurrency,
        conversationLimit,
        conversationConcurrency,
        scope
      );
      if (drained.stopped) {
        break;
      }
      lastActiveAt = Date.now();
      continue;
    }

    if (once) break;

    if (autoStopIdleMs > 0 && tick.processed === 0 && tick.errors.length === 0 && Date.now() - lastActiveAt >= autoStopIdleMs) {
      const confirm = await processQueueOnce(
        teacherRecordingLimit,
        sessionPartLimit,
        sessionPartConcurrency,
        conversationLimit,
        conversationConcurrency,
        scope
      );
      if (confirm.processed === 0 && confirm.errors.length === 0) {
        const stopResult = await stopCurrentRunpodPod();
        if (!stopResult.ok) {
          lastActiveAt = Date.now();
          console.log("[runpod-worker] idle_auto_stop_failed", {
            autoStopIdleMs,
            podId: process.env.RUNPOD_POD_ID ?? null,
            stopResult,
          });
          continue;
        }
        console.log("[runpod-worker] idle_auto_stop", {
          autoStopIdleMs,
          podId: process.env.RUNPOD_POD_ID ?? null,
          stopResult,
        });
        break;
      }

      lastActiveAt = Date.now();
      console.log("[runpod-worker] idle_auto_stop_aborted", {
        processed: confirm.processed,
        teacherRecordingProcessed: confirm.teacherRecordingJobs.processed,
        sessionPartProcessed: confirm.sessionPartJobs.processed,
        conversationProcessed: confirm.conversationJobs.processed,
        errorCount: confirm.errors.length,
      });
      continue;
    }

    await sleep(tick.processed > 0 ? activeWaitMs : idleWaitMs);
  }

  stopFasterWhisperWorkers();
}

main().catch((error) => {
  console.error("[runpod-worker] fatal", error);
  stopFasterWhisperWorkers();
  process.exit(1);
});
