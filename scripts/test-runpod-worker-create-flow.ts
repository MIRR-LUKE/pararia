import assert from "node:assert/strict";
import { createRunpodWorkerPod, ensureRunpodWorker } from "../lib/runpod/worker-control";

type FetchCall = {
  url: string;
  method: string;
  body: Record<string, any> | null;
};

const previousEnv = { ...process.env };
const previousFetch = global.fetch;

function resetEnv() {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, previousEnv);
}

function applyBaseEnv() {
  process.env.RUNPOD_API_KEY = "rp_test";
  process.env.DATABASE_URL = "postgresql://db";
  process.env.DIRECT_URL = "postgresql://direct";
  process.env.BLOB_READ_WRITE_TOKEN = "blob";
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.NEXTAUTH_URL = "https://pararia.example.com";
  process.env.MAINTENANCE_SECRET = "maintenance-secret";
  process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1";
  delete process.env.RUNPOD_WORKER_GPU_CANDIDATES;
  delete process.env.RUNPOD_WORKER_GPU;
}

try {
  applyBaseEnv();
  process.env.RUNPOD_WORKER_IMAGE = "ghcr.io/mirr-luke/pararia-runpod-worker:sha-abcdef1";

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
  assert.equal(patchCall.body?.env?.NEXTAUTH_URL, "https://pararia.example.com");
  assert.equal(patchCall.body?.env?.MAINTENANCE_SECRET, "maintenance-secret");
  assert.equal(patchCall.body?.env?.DATABASE_URL, undefined);
  assert.equal(patchCall.body?.env?.DIRECT_URL, undefined);
  assert.equal(patchCall.body?.env?.OPENAI_API_KEY, undefined);

  resetEnv();
  applyBaseEnv();
  process.env.RUNPOD_WORKER_IMAGE = "ghcr.io/mirr-luke/pararia-runpod-worker:sha-abcdef1";
  const staleRevisionCalls: FetchCall[] = [];

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || "GET").toUpperCase();
    const rawBody = typeof init?.body === "string" ? init.body : null;
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, any>) : null;
    staleRevisionCalls.push({ url, method, body });

    if (url === "https://rest.runpod.io/v1/pods" && method === "GET") {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "pod-stale",
              name: "pararia-gpu-worker",
              desiredStatus: "RUNNING",
              imageName: "ghcr.io/mirr-luke/pararia-runpod-worker:sha-abcdef1",
              env: {
                RUNPOD_WORKER_RUNTIME_REVISION: "git-stale",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url === "https://rest.runpod.io/v1/pods/pod-stale" && method === "DELETE") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === "https://rest.runpod.io/v1/pods" && method === "POST") {
      return new Response(JSON.stringify({ id: "pod-new", name: "pararia-gpu-worker" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === "https://rest.runpod.io/v1/pods/pod-new" && method === "PATCH") {
      return new Response(
        JSON.stringify({
          id: "pod-new",
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

  const ensuredFromStaleRevision = await ensureRunpodWorker();
  assert.equal(ensuredFromStaleRevision.action, "created_new");
  assert.equal(ensuredFromStaleRevision.pod.id, "pod-new");
  assert.deepEqual(ensuredFromStaleRevision.terminatedPodIds, ["pod-stale"]);
  assert.deepEqual(
    staleRevisionCalls.map((call) => `${call.method} ${call.url}`),
    [
      "GET https://rest.runpod.io/v1/pods",
      "DELETE https://rest.runpod.io/v1/pods/pod-stale",
      "POST https://rest.runpod.io/v1/pods",
      "PATCH https://rest.runpod.io/v1/pods/pod-new",
    ],
    "stale active pods with an outdated runtime revision must be recycled before booting a new worker"
  );
  assert.equal(staleRevisionCalls.some((call) => call.url.endsWith("/start")), false);
  assert.equal(
    staleRevisionCalls.find((call) => call.method === "PATCH" && call.url.endsWith("/pods/pod-new"))?.body?.env
      ?.RUNPOD_WORKER_RUNTIME_REVISION,
    "git-abcdef1"
  );

  resetEnv();
  applyBaseEnv();
  process.env.RUNPOD_WORKER_IMAGE = "ghcr.io/mirr-luke/pararia-runpod-worker:latest";
  const staleLatestCalls: FetchCall[] = [];

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || "GET").toUpperCase();
    const rawBody = typeof init?.body === "string" ? init.body : null;
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, any>) : null;
    staleLatestCalls.push({ url, method, body });

    if (url === "https://rest.runpod.io/v1/pods" && method === "GET") {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "pod-stale",
              name: "pararia-gpu-worker",
              desiredStatus: "RUNNING",
              imageName: "ghcr.io/mirr-luke/pararia-runpod-worker:sha-old999",
              env: {
                RUNPOD_WORKER_RUNTIME_REVISION: "git-old999",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url === "https://rest.runpod.io/v1/pods/pod-stale" && method === "DELETE") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === "https://rest.runpod.io/v1/pods" && method === "POST") {
      return new Response(JSON.stringify({ id: "pod-new-latest", name: "pararia-gpu-worker" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === "https://rest.runpod.io/v1/pods/pod-new-latest" && method === "PATCH") {
      return new Response(
        JSON.stringify({
          id: "pod-new-latest",
          name: "pararia-gpu-worker",
          desiredStatus: "RUNNING",
          imageName: "ghcr.io/mirr-luke/pararia-runpod-worker:latest",
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

  const ensuredFromMutableTag = await ensureRunpodWorker();
  assert.equal(ensuredFromMutableTag.action, "created_new");
  assert.equal(ensuredFromMutableTag.pod.id, "pod-new-latest");
  assert.deepEqual(ensuredFromMutableTag.terminatedPodIds, ["pod-stale"]);
  assert.deepEqual(
    staleLatestCalls.map((call) => `${call.method} ${call.url}`),
    [
      "GET https://rest.runpod.io/v1/pods",
      "DELETE https://rest.runpod.io/v1/pods/pod-stale",
      "POST https://rest.runpod.io/v1/pods",
      "PATCH https://rest.runpod.io/v1/pods/pod-new-latest",
    ],
    "same-name active pods behind a mutable tag must still recycle when the runtime revision is stale"
  );
  assert.equal(staleLatestCalls.some((call) => call.url.endsWith("/start")), false);
  assert.equal(
    staleLatestCalls.find((call) => call.method === "POST" && call.url === "https://rest.runpod.io/v1/pods")?.body
      ?.imageName,
    "ghcr.io/mirr-luke/pararia-runpod-worker:latest"
  );

  console.log("runpod worker create flow regression checks passed");
} finally {
  global.fetch = previousFetch;
  resetEnv();
}
