#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { buildWorkerEnv, GPU_PROFILES } from "./lib/runpod-measure-ux-runpod";

const previousEnv = { ...process.env };

try {
  process.env.DATABASE_URL = "postgresql://db";
  process.env.DIRECT_URL = "postgresql://direct";
  process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
  process.env.OPENAI_API_KEY = "openai-api-key";
  process.env.RUNPOD_API_KEY = "runpod-api-key";
  process.env.NEXT_PUBLIC_APP_URL = "https://pararia.example.com";
  process.env.NEXTAUTH_URL = "";
  process.env.MAINTENANCE_SECRET = "";
  process.env.CRON_SECRET = "maintenance-secret";
  process.env.MAINTENANCE_CRON_SECRET = "";

  const env = buildWorkerEnv({
    sessionId: "session-123",
    autoStopIdleMs: 60_000,
    profile: GPU_PROFILES["3090"],
    workerImage: "ghcr.io/example/worker:sha-test",
  });

  assert.equal(env.NEXT_PUBLIC_APP_URL, "https://pararia.example.com");
  assert.equal(env.NEXTAUTH_URL, "https://pararia.example.com");
  assert.equal(env.MAINTENANCE_SECRET, "maintenance-secret");
  assert.equal(env.CRON_SECRET, "maintenance-secret");
  assert.equal(env.MAINTENANCE_CRON_SECRET, "maintenance-secret");
  assert.equal(env.OPENAI_API_KEY, "openai-api-key");
  assert.equal(env.FASTER_WHISPER_BATCH_SIZE, "16");
  assert.equal(env.RUNPOD_WORKER_ONLY_SESSION_ID, "session-123");
} finally {
  process.env = previousEnv;
}

console.log("runpod measure worker env regression check passed");
