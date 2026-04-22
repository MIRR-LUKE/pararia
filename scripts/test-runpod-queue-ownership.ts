import assert from "node:assert/strict";
import { evaluateRunpodStopEligibility } from "../lib/runpod/idle-stop";
import { buildRunpodWorkerEnv, getRunpodWorkerConfig } from "../lib/runpod/worker-control";

const previousEnv = { ...process.env };

try {
  assert.deepEqual(
    evaluateRunpodStopEligibility({
      inlineMode: false,
      pendingSessionPartJobs: 0,
    }),
    {
      attempted: true,
      reason: "session_part_queue_drained",
    }
  );

  process.env.RUNPOD_API_KEY = "rp_test";
  process.env.DATABASE_URL = "postgresql://db";
  process.env.DIRECT_URL = "postgresql://direct";
  process.env.BLOB_READ_WRITE_TOKEN = "blob";
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.RUNPOD_WORKER_CONVERSATION_LIMIT;
  delete process.env.LOCAL_GPU_WORKER_CONVERSATION_LIMIT;
  delete process.env.RUNPOD_WORKER_IMAGE;
  process.env.VERCEL_GIT_COMMIT_SHA = "abc123";

  const env = buildRunpodWorkerEnv(300000);
  assert.equal(env.RUNPOD_WORKER_CONVERSATION_LIMIT, "0");
  assert.equal(env.FASTER_WHISPER_VAD_MIN_SILENCE_MS, "1000");
  assert.equal(env.FASTER_WHISPER_VAD_THRESHOLD, "0.5");
  assert.equal(env.RUNPOD_WORKER_IMAGE, "ghcr.io/mirr-luke/pararia-runpod-worker:sha-abc123");
  assert.equal(env.RUNPOD_WORKER_GIT_SHA, "abc123");
  assert.equal(env.RUNPOD_WORKER_RUNTIME_REVISION, "git-abc123");
  assert.equal(
    getRunpodWorkerConfig()?.image,
    "ghcr.io/mirr-luke/pararia-runpod-worker:sha-abc123"
  );
  assert.equal(
    getRunpodWorkerConfig()?.autoStopIdleMs,
    60000,
    "Runpod の既定 idle stop は 1 分にする"
  );
  assert.deepEqual(getRunpodWorkerConfig()?.gpuCandidates, [
    "NVIDIA GeForce RTX 5090",
    "NVIDIA GeForce RTX 4090",
    "NVIDIA GeForce RTX 3090",
  ]);

  process.env.RUNPOD_WORKER_CONVERSATION_LIMIT = "0";
  const sttOnlyEnv = buildRunpodWorkerEnv(300000);
  assert.equal(sttOnlyEnv.RUNPOD_WORKER_CONVERSATION_LIMIT, "0");

  console.log("runpod queue ownership smoke check passed");
} finally {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, previousEnv);
}
