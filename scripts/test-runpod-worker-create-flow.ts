import assert from "node:assert/strict";
import { createRunpodWorkerPod } from "../lib/runpod/worker-control";

type FetchCall = {
  url: string;
  method: string;
  body: Record<string, any> | null;
};

const previousEnv = { ...process.env };
const previousFetch = global.fetch;

try {
  process.env.RUNPOD_API_KEY = "rp_test";
  process.env.DATABASE_URL = "postgresql://db";
  process.env.DIRECT_URL = "postgresql://direct";
  process.env.BLOB_READ_WRITE_TOKEN = "blob";
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.RUNPOD_WORKER_IMAGE = "ghcr.io/mirr-luke/pararia-runpod-worker:sha-abcdef1";
  delete process.env.RUNPOD_WORKER_GPU_CANDIDATES;
  delete process.env.RUNPOD_WORKER_GPU;

  const calls: FetchCall[] = [];

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || "GET").toUpperCase();
    const rawBody = typeof init?.body === "string" ? init.body : null;
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, any>) : null;
    calls.push({ url, method, body });

    if (url === "https://rest.runpod.io/v1/pods" && method === "POST") {
      return new Response(JSON.stringify({ id: "pod-123", name: "pararia-gpu-worker" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === "https://rest.runpod.io/v1/pods/pod-123" && method === "PATCH") {
      return new Response(
        JSON.stringify({
          id: "pod-123",
          name: "pararia-gpu-worker",
          desiredStatus: "RUNNING",
          imageName: "ghcr.io/mirr-luke/pararia-runpod-worker:sha-abcdef1",
          env: body?.env ?? null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    throw new Error(`unexpected fetch: ${method} ${url}`);
  }) as typeof global.fetch;

  const created = await createRunpodWorkerPod();
  assert.equal(created.id, "pod-123");
  assert.equal(calls.length, 2, "worker creation should POST once and PATCH once");

  const createCall = calls[0];
  assert.equal(createCall.method, "POST");
  assert.equal(createCall.body?.gpuTypeIds?.[0], "NVIDIA GeForce RTX 3090");
  assert.equal("env" in (createCall.body ?? {}), false, "initial pod create must not send env");
  assert.deepEqual(
    createCall.body?.dockerStartCmd,
    [
      "bash",
      "-lc",
      "mkdir -p /tmp/runpod-bootstrap && printf 'waiting_runtime_config\\n' >/tmp/runpod-bootstrap/status.txt && printf '{\"stage\":\"waiting_runtime_config\"}\\n' >/tmp/runpod-bootstrap/status.json && exec python3 -m http.server 8888 --bind 0.0.0.0 --directory /tmp/runpod-bootstrap",
    ],
    "initial pod create should use a harmless bootstrap command until runtime env is patched"
  );

  const patchCall = calls[1];
  assert.equal(patchCall.method, "PATCH");
  assert.deepEqual(patchCall.body?.dockerStartCmd, ["bash", "/app/scripts/runpod-worker-start.sh"]);
  assert.equal(typeof patchCall.body?.env, "object");
  assert.equal(patchCall.body?.env?.FASTER_WHISPER_DOWNLOAD_ROOT, "/opt/faster-whisper-cache");
  assert.equal(patchCall.body?.env?.RUNPOD_WORKER_CONVERSATION_LIMIT, "0");
  assert.equal(patchCall.body?.env?.RUNPOD_WORKER_RUNTIME_REVISION, "git-abcdef1");

  console.log("runpod worker create flow regression checks passed");
} finally {
  global.fetch = previousFetch;
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, previousEnv);
}
