#!/usr/bin/env tsx

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stopFasterWhisperWorkers, warmFasterWhisperWorkers } from "../lib/ai/stt";
import { saveStorageText } from "../lib/audio-storage";
import { claimRemoteSttTask, pingRemoteSttApi, submitRemoteSttTaskResult } from "../lib/runpod/remote-stt-client";
import type { RunpodRemoteTaskFailure } from "../lib/runpod/remote-stt-types";
import { transcribeSessionPartTask } from "../lib/runpod/stt/session-part-task";
import { transcribeTeacherRecordingTask } from "../lib/runpod/stt/teacher-recording-task";
import { stopCurrentRunpodPod } from "../lib/runpod/worker-control";
import { readRunpodWorkerRuntimeMetadata } from "../lib/runpod/runtime-metadata";

type WorkerScope = {
  sessionId?: string;
  conversationId?: string;
};

type WorkerTickResult = {
  processed: number;
  errors: string[];
  teacherRecordingProcessed: number;
  sessionPartProcessed: number;
  conversationProcessed: number;
  remoteTaskKind: string | null;
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

function isExternalMode() {
  return process.env.PARARIA_BACKGROUND_MODE?.trim() === "external";
}

function getEffectiveConversationLimit(conversationLimit: number) {
  if (isExternalMode()) {
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

const RUNPOD_LOCAL_HEALTH_DIR = process.env.PARARIA_RUNPOD_HEALTH_DIR?.trim() || "/tmp/runpod-health";

async function writeLocalHealth(stage: string, extra: Record<string, unknown> = {}) {
  const payload = {
    stage,
    updatedAt: new Date().toISOString(),
    podId: process.env.RUNPOD_POD_ID?.trim() || null,
    ...extra,
  };

  try {
    await mkdir(RUNPOD_LOCAL_HEALTH_DIR, { recursive: true });
    await Promise.all([
      writeFile(path.join(RUNPOD_LOCAL_HEALTH_DIR, "status.txt"), `${stage}\n`, "utf8"),
      writeFile(path.join(RUNPOD_LOCAL_HEALTH_DIR, "status.json"), JSON.stringify(payload, null, 2), "utf8"),
    ]);
  } catch {}
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
    backgroundMode: isExternalMode() ? "external" : "inline",
    ...runtimeMetadata,
  };

  void saveStorageText({
    storagePathname: getWorkerHeartbeatPath("startup.json"),
    text: JSON.stringify(payload, null, 2),
    allowOverwrite: true,
  }).catch(() => {});

  if (!isExternalMode()) {
    const { writeAuditLog } = await import("../lib/audit");
    await writeAuditLog({
      organizationId: null,
      action: "runpod_worker_bootstrap",
      targetType: "worker",
      targetId: payload.podId as string | null,
      detail: {
        podId: payload.podId,
        sessionId: payload.scope.sessionId ?? null,
        conversationId: payload.scope.conversationId ?? null,
        sessionPartLimit: payload.sessionPartLimit,
        conversationLimit: payload.conversationLimit,
      },
    }).catch(() => {});
  }

  return payload;
}

async function recordWorkerReadyHeartbeat(payload: Record<string, unknown>) {
  try {
    if (isExternalMode()) {
      await pingRemoteSttApi();
      await saveStorageText({
        storagePathname: getWorkerHeartbeatPath("db-ok.json"),
        text: JSON.stringify(
          {
            ...payload,
            event: "worker_remote_api_ok",
            checkedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        allowOverwrite: true,
      }).catch(() => {});
      return;
    }

    const [{ prisma }, { writeAuditLog }] = await Promise.all([
      import("../lib/db"),
      import("../lib/audit"),
    ]);
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
          event: isExternalMode() ? "worker_remote_api_error" : "worker_db_error",
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

async function processQueueOnceInline(
  teacherRecordingLimit: number,
  sessionPartLimit: number,
  sessionPartConcurrency: number,
  conversationLimit: number,
  conversationConcurrency: number,
  scope: WorkerScope
): Promise<WorkerTickResult> {
  const empty = { processed: 0, errors: [] as string[] };
  const [{ processQueuedJobs }, { processQueuedSessionPartJobs }, { processQueuedTeacherRecordingJobs }] =
    await Promise.all([
      import("../lib/jobs/conversationJobs"),
      import("../lib/jobs/sessionPartJobs"),
      import("../lib/jobs/teacherRecordingJobs"),
    ]);

  const teacherRecordingJobs =
    teacherRecordingLimit > 0
      ? await processQueuedTeacherRecordingJobs(teacherRecordingLimit)
      : empty;
  const sessionPartJobs =
    sessionPartLimit > 0
      ? await processQueuedSessionPartJobs(
          sessionPartLimit,
          sessionPartConcurrency,
          scope.sessionId ? { sessionId: scope.sessionId } : undefined
        )
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
    processed: teacherRecordingJobs.processed + sessionPartJobs.processed + conversationJobs.processed,
    errors: [...teacherRecordingJobs.errors, ...sessionPartJobs.errors, ...conversationJobs.errors],
    teacherRecordingProcessed: teacherRecordingJobs.processed,
    sessionPartProcessed: sessionPartJobs.processed,
    conversationProcessed: conversationJobs.processed,
    remoteTaskKind: null,
  };
}

async function processQueueOnceExternal(scope: WorkerScope): Promise<WorkerTickResult> {
  const claimed = await claimRemoteSttTask({
    sessionId: scope.sessionId,
  });
  const task = claimed.task;
  if (!task) {
    return {
      processed: 0,
      errors: [],
      teacherRecordingProcessed: 0,
      sessionPartProcessed: 0,
      conversationProcessed: 0,
      remoteTaskKind: null,
    };
  }

  try {
    if (task.kind === "teacher_recording") {
      const result = await transcribeTeacherRecordingTask({
        audioStorageUrl: task.audioStorageUrl,
        audioFileName: task.audioFileName,
        audioMimeType: task.audioMimeType,
      });
      await submitRemoteSttTaskResult({
        taskKind: "teacher_recording",
        jobId: task.jobId,
        result,
      });
      return {
        processed: 1,
        errors: [],
        teacherRecordingProcessed: 1,
        sessionPartProcessed: 0,
        conversationProcessed: 0,
        remoteTaskKind: task.kind,
      };
    }

    const result = await transcribeSessionPartTask({
      id: task.sessionPartId,
      storageUrl: task.storageUrl,
      fileName: task.fileName,
      mimeType: task.mimeType,
      qualityMetaJson: task.qualityMetaJson,
      sessionType: task.sessionType as any,
    });
    await submitRemoteSttTaskResult({
      taskKind: "session_part_transcription",
      jobId: task.jobId,
      result,
    });
    return {
      processed: 1,
      errors: [],
      teacherRecordingProcessed: 0,
      sessionPartProcessed: 1,
      conversationProcessed: 0,
      remoteTaskKind: task.kind,
    };
  } catch (error) {
    const failure: RunpodRemoteTaskFailure = {
      kind: "error",
      errorMessage: error instanceof Error ? error.message : String(error ?? "unknown error"),
    };
    await submitRemoteSttTaskResult(
      task.kind === "teacher_recording"
        ? {
            taskKind: "teacher_recording",
            jobId: task.jobId,
            result: failure,
          }
        : {
            taskKind: "session_part_transcription",
            jobId: task.jobId,
            result: failure,
          }
    ).catch((submitError) => {
      console.error("[runpod-worker] failed to submit remote task failure", submitError);
    });
    return {
      processed: 0,
      errors: [failure.errorMessage],
      teacherRecordingProcessed: task.kind === "teacher_recording" ? 1 : 0,
      sessionPartProcessed: task.kind === "session_part_transcription" ? 1 : 0,
      conversationProcessed: 0,
      remoteTaskKind: task.kind,
    };
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
  if (isExternalMode()) {
    return processQueueOnceExternal(scope);
  }
  return processQueueOnceInline(
    teacherRecordingLimit,
    sessionPartLimit,
    sessionPartConcurrency,
    conversationLimit,
    conversationConcurrency,
    scope
  );
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
    teacherRecordingProcessed: confirm.teacherRecordingProcessed,
    sessionPartProcessed: confirm.sessionPartProcessed,
    conversationProcessed: confirm.conversationProcessed,
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
  const sessionPartLimit = readNonNegativeIntEnvWithLegacy(
    "RUNPOD_WORKER_SESSION_PART_LIMIT",
    "LOCAL_GPU_WORKER_SESSION_PART_LIMIT",
    8
  );
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
    void writeLocalHealth("stopping", { signal: "SIGINT" });
    void handleStop();
  });
  process.on("SIGTERM", () => {
    void writeLocalHealth("stopping", { signal: "SIGTERM" });
    void handleStop();
  });

  console.log("[runpod-worker] started", {
    mode: getConversationWorkerMode(conversationLimit),
    backgroundMode: isExternalMode() ? "external" : "inline",
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

  if (isExternalMode()) {
    console.warn("[runpod-worker] external mode uses remote claim/submit and stays STT-only.");
  }

  await writeLocalHealth("worker_process_started", {
    scope,
    teacherRecordingLimit,
    sessionPartLimit,
    sessionPartConcurrency,
    conversationLimit,
    conversationConcurrency,
    autoStopIdleMs,
    idleWaitMs,
    activeWaitMs,
    once,
  });

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

  await writeLocalHealth("warming_stt", {
    scope,
    sessionPartLimit,
    conversationLimit,
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

  await writeLocalHealth("worker_ready", {
    scope,
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
        teacherRecordingProcessed: tick.teacherRecordingProcessed,
        sessionPartProcessed: tick.sessionPartProcessed,
        conversationProcessed: tick.conversationProcessed,
        errorCount: tick.errors.length,
        remoteTaskKind: tick.remoteTaskKind,
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
        await writeLocalHealth("stopped_after_drain", {
          podId: process.env.RUNPOD_POD_ID ?? null,
        });
        break;
      }
      lastActiveAt = Date.now();
      continue;
    }

    if (once) break;

    if (
      autoStopIdleMs > 0 &&
      tick.processed === 0 &&
      tick.errors.length === 0 &&
      Date.now() - lastActiveAt >= autoStopIdleMs
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
        await writeLocalHealth("stopped_idle", {
          podId: process.env.RUNPOD_POD_ID ?? null,
          autoStopIdleMs,
        });
        break;
      }

      lastActiveAt = Date.now();
      console.log("[runpod-worker] idle_auto_stop_aborted", {
        processed: confirm.processed,
        teacherRecordingProcessed: confirm.teacherRecordingProcessed,
        sessionPartProcessed: confirm.sessionPartProcessed,
        conversationProcessed: confirm.conversationProcessed,
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
  void writeLocalHealth("worker_fatal", {
    error: error instanceof Error ? error.message : String(error),
  });
  stopFasterWhisperWorkers();
  process.exit(1);
});
