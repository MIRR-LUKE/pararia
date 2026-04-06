#!/usr/bin/env tsx

import { stopLocalSttWorker } from "../lib/ai/stt";
import { processQueuedJobs } from "../lib/jobs/conversationJobs";
import { processQueuedSessionPartJobs } from "../lib/jobs/sessionPartJobs";
import { stopCurrentRunpodPod } from "../lib/runpod/worker-control";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readIntEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function readNonNegativeIntEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

async function processQueueOnce(sessionPartLimit: number, sessionPartConcurrency: number, conversationLimit: number, conversationConcurrency: number) {
  const sessionPartJobs = await processQueuedSessionPartJobs(sessionPartLimit, sessionPartConcurrency);
  const conversationJobs = await processQueuedJobs(conversationLimit, conversationConcurrency);
  return {
    sessionPartJobs,
    conversationJobs,
    processed: sessionPartJobs.processed + conversationJobs.processed,
    errors: [...sessionPartJobs.errors, ...conversationJobs.errors],
  };
}

async function main() {
  const sessionPartLimit = readIntEnv("LOCAL_GPU_WORKER_SESSION_PART_LIMIT", 8);
  const sessionPartConcurrency = readIntEnv("LOCAL_GPU_WORKER_SESSION_PART_CONCURRENCY", Number(process.env.SESSION_PART_JOB_CONCURRENCY ?? 1));
  const conversationLimit = readIntEnv("LOCAL_GPU_WORKER_CONVERSATION_LIMIT", 6);
  const conversationConcurrency = readIntEnv("LOCAL_GPU_WORKER_CONVERSATION_CONCURRENCY", Number(process.env.JOB_CONCURRENCY ?? 2));
  const idleWaitMs = readIntEnv("LOCAL_GPU_WORKER_IDLE_WAIT_MS", 2500);
  const activeWaitMs = readIntEnv("LOCAL_GPU_WORKER_ACTIVE_WAIT_MS", 200);
  const defaultAutoStopIdleMs = process.env.RUNPOD_POD_ID?.trim() ? 5 * 60 * 1000 : 0;
  const autoStopIdleMs = readNonNegativeIntEnv("LOCAL_GPU_WORKER_AUTO_STOP_IDLE_MS", defaultAutoStopIdleMs);
  const once = process.argv.includes("--once");
  let lastActiveAt = Date.now();

  let stopped = false;
  const handleStop = async () => {
    stopped = true;
    stopLocalSttWorker();
  };

  process.on("SIGINT", () => {
    void handleStop();
  });
  process.on("SIGTERM", () => {
    void handleStop();
  });

  console.log("[local-gpu-worker] started", {
    sessionPartLimit,
    sessionPartConcurrency,
    conversationLimit,
    conversationConcurrency,
    idleWaitMs,
    autoStopIdleMs,
    once,
  });

  while (!stopped) {
    const tick = await processQueueOnce(
      sessionPartLimit,
      sessionPartConcurrency,
      conversationLimit,
      conversationConcurrency
    );

    if (tick.processed > 0 || tick.errors.length > 0) {
      lastActiveAt = Date.now();
      console.log("[local-gpu-worker] tick", {
        processed: tick.processed,
        sessionPartProcessed: tick.sessionPartJobs.processed,
        conversationProcessed: tick.conversationJobs.processed,
        errorCount: tick.errors.length,
      });
    }

    if (once) break;

    if (autoStopIdleMs > 0 && tick.processed === 0 && tick.errors.length === 0 && Date.now() - lastActiveAt >= autoStopIdleMs) {
      const confirm = await processQueueOnce(
        sessionPartLimit,
        sessionPartConcurrency,
        conversationLimit,
        conversationConcurrency
      );
      if (confirm.processed === 0 && confirm.errors.length === 0) {
        const stopResult = await stopCurrentRunpodPod();
        console.log("[local-gpu-worker] idle_auto_stop", {
          autoStopIdleMs,
          podId: process.env.RUNPOD_POD_ID ?? null,
          stopResult,
        });
        break;
      }

      lastActiveAt = Date.now();
      console.log("[local-gpu-worker] idle_auto_stop_aborted", {
        processed: confirm.processed,
        sessionPartProcessed: confirm.sessionPartJobs.processed,
        conversationProcessed: confirm.conversationJobs.processed,
        errorCount: confirm.errors.length,
      });
      continue;
    }

    await sleep(tick.processed > 0 ? activeWaitMs : idleWaitMs);
  }

  stopLocalSttWorker();
}

main().catch((error) => {
  console.error("[local-gpu-worker] fatal", error);
  stopLocalSttWorker();
  process.exit(1);
});
