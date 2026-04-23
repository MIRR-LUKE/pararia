import assert from "node:assert/strict";
import { evaluateRunpodStopEligibility } from "../lib/runpod/idle-stop";
import { buildRunpodWorkerEnv, getRunpodWorkerConfig } from "../lib/runpod/worker-control";
import { buildRunpodWorkerCreateBody } from "../lib/runpod/worker-control-core";

const previousEnv = { ...process.env };

try {
  assert.deepEqual(
    evaluateRunpodStopEligibility({
      inlineMode: false,
      pendingTeacherRecordingJobs: 0,
      pendingSessionPartJobs: 0,
    }),
    {
      attempted: true,
      reason: "gpu_work_queue_drained",
    }
  );

  assert.deepEqual(
    evaluateRunpodStopEligibility({
      inlineMode: false,
      pendingTeacherRecordingJobs: 1,
      pendingSessionPartJobs: 0,
    }),
    {
      attempted: false,
      reason: "pending_teacher_recording_jobs",
    }
  );

  process.env.RUNPOD_API_KEY = "rp_test";
  process.env.DATABASE_URL = "postgresql://db";
  process.env.DIRECT_URL = "postgresql://direct";
  process.env.BLOB_READ_WRITE_TOKEN = "blob";
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.NEXTAUTH_URL = "https://pararia.example.com";
  process.env.MAINTENANCE_SECRET = "maintenance-secret";
  process.env.JOB_CONCURRENCY = "9";
  process.env.SESSION_PART_JOB_CONCURRENCY = "7";
  process.env.FASTER_WHISPER_BATCH_SIZE = "32";
  delete process.env.RUNPOD_WORKER_CONVERSATION_LIMIT;
  delete process.env.LOCAL_GPU_WORKER_CONVERSATION_LIMIT;
  delete process.env.RUNPOD_WORKER_IMAGE;
  process.env.VERCEL_GIT_COMMIT_SHA = "abc123";

  const env = buildRunpodWorkerEnv(300000);
  assert.equal(env.RUNPOD_WORKER_CONVERSATION_LIMIT, "0");
  assert.equal(env.FASTER_WHISPER_VAD_MIN_SILENCE_MS, "1000");
  assert.equal(env.FASTER_WHISPER_VAD_THRESHOLD, "0.5");
  assert.equal(env.FASTER_WHISPER_MODEL, "large-v3");
  assert.equal(env.FASTER_WHISPER_DOWNLOAD_ROOT, "/opt/faster-whisper-cache");
  assert.equal(env.RUNPOD_WORKER_IMAGE, "ghcr.io/mirr-luke/pararia-runpod-worker:sha-abc123");
  assert.equal(env.RUNPOD_WORKER_GIT_SHA, "abc123");
  assert.equal(env.RUNPOD_WORKER_RUNTIME_REVISION, "git-abc123");
  assert.equal(env.FASTER_WHISPER_BATCH_SIZE, "1");
  assert.equal(env.NEXTAUTH_URL, "https://pararia.example.com");
  assert.equal(env.MAINTENANCE_SECRET, "maintenance-secret");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.DIRECT_URL, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.JOB_CONCURRENCY, undefined);
  assert.equal(env.SESSION_PART_JOB_CONCURRENCY, undefined);
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
    "NVIDIA GeForce RTX 3090",
    "NVIDIA GeForce RTX 4090",
  ]);
  const createBody = buildRunpodWorkerCreateBody(getRunpodWorkerConfig()!);
  assert.deepEqual(createBody.ports, ["8888/http"]);
  assert.deepEqual(createBody.dockerStartCmd, ["bash", "/app/scripts/runpod-worker-start.sh"]);

  process.env.RUNPOD_WORKER_CONVERSATION_LIMIT = "0";
  const sttOnlyEnv = buildRunpodWorkerEnv(300000);
  assert.equal(sttOnlyEnv.RUNPOD_WORKER_CONVERSATION_LIMIT, "0");

  console.log("runpod queue ownership smoke check passed");
} finally {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, previousEnv);
}
