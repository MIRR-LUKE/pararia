#!/usr/bin/env tsx

import { stopLocalSttWorker } from "../lib/ai/stt";
import { processQueuedJobs } from "../lib/jobs/conversationJobs";
import { processQueuedSessionPartJobs } from "../lib/jobs/sessionPartJobs";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readIntEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

async function main() {
  const sessionPartLimit = readIntEnv("LOCAL_GPU_WORKER_SESSION_PART_LIMIT", 8);
  const sessionPartConcurrency = readIntEnv("LOCAL_GPU_WORKER_SESSION_PART_CONCURRENCY", Number(process.env.SESSION_PART_JOB_CONCURRENCY ?? 1));
  const conversationLimit = readIntEnv("LOCAL_GPU_WORKER_CONVERSATION_LIMIT", 6);
  const conversationConcurrency = readIntEnv("LOCAL_GPU_WORKER_CONVERSATION_CONCURRENCY", Number(process.env.JOB_CONCURRENCY ?? 2));
  const idleWaitMs = readIntEnv("LOCAL_GPU_WORKER_IDLE_WAIT_MS", 2500);
  const activeWaitMs = readIntEnv("LOCAL_GPU_WORKER_ACTIVE_WAIT_MS", 200);
  const once = process.argv.includes("--once");

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
    once,
  });

  while (!stopped) {
    const sessionPartJobs = await processQueuedSessionPartJobs(sessionPartLimit, sessionPartConcurrency);
    const conversationJobs = await processQueuedJobs(conversationLimit, conversationConcurrency);
    const processed = sessionPartJobs.processed + conversationJobs.processed;
    const errors = [...sessionPartJobs.errors, ...conversationJobs.errors];

    if (processed > 0 || errors.length > 0) {
      console.log("[local-gpu-worker] tick", {
        processed,
        sessionPartProcessed: sessionPartJobs.processed,
        conversationProcessed: conversationJobs.processed,
        errorCount: errors.length,
      });
    }

    if (once) break;
    await sleep(processed > 0 ? activeWaitMs : idleWaitMs);
  }

  stopLocalSttWorker();
}

main().catch((error) => {
  console.error("[local-gpu-worker] fatal", error);
  stopLocalSttWorker();
  process.exit(1);
});
