const RUNPOD_API_BASE = "https://rest.runpod.io/v1";
const DEFAULT_WORKER_NAME = "pararia-gpu-worker";
const DEFAULT_WORKER_IMAGE = "ghcr.io/mirr-luke/pararia-runpod-worker:latest";
const DEFAULT_WORKER_GPU = "NVIDIA GeForce RTX 4090";
const DEFAULT_AUTO_STOP_IDLE_MS = 5 * 60 * 1000;
const DEFAULT_API_TIMEOUT_MS = 15_000;

type RunpodFetchOptions = RequestInit & {
  config?: RunpodWorkerConfig;
};

type RunpodPodLike = {
  id: string;
  name?: string | null;
  image?: string | null;
  imageName?: string | null;
  desiredStatus?: string | null;
  lastStartedAt?: string | null;
  createdAt?: string | null;
  env?: Record<string, string> | null;
  publicIp?: string | null;
  costPerHr?: string | number | null;
  adjustedCostPerHr?: number | null;
  machineId?: string | null;
  gpu?: {
    count?: number | null;
    displayName?: string | null;
  } | null;
};

export type RunpodPod = RunpodPodLike;

export type RunpodWorkerConfig = {
  apiKey: string;
  name: string;
  image: string;
  gpu: string;
  secureCloud: boolean;
  containerDiskInGb: number;
  volumeInGb: number;
  gpuCount: number;
  autoStopIdleMs: number;
  apiTimeoutMs: number;
};

export type RunpodWorkerEnsureResult = {
  action: "already_running" | "started_existing" | "created_new";
  pod: RunpodPod;
  terminatedPodIds?: string[];
};

export type RunpodWorkerWakeResult = {
  attempted: boolean;
  ok: boolean;
  skipped?: string;
  error?: string;
  action?: RunpodWorkerEnsureResult["action"];
  podId?: string;
  desiredStatus?: string | null;
  name?: string;
};

export type RunpodWorkerStopResult = {
  ok: boolean;
  stoppedPodIds: string[];
  alreadyStoppedPodIds: string[];
  skipped?: string;
  error?: string;
};

export type RunpodWorkerTerminateResult = {
  ok: boolean;
  terminatedPodIds: string[];
  skipped?: string;
  error?: string;
};

function readStringEnv(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function readStringEnvWithLegacy(name: string, legacyName: string, fallback = "") {
  return readStringEnv(name, readStringEnv(legacyName, fallback));
}

function readRequiredEnv(name: string) {
  const value = readStringEnv(name);
  if (!value) {
    throw new Error(`${name} が必要です。`);
  }
  return value;
}

function readIntEnv(name: string, fallback: number, min = 0) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

function readIntEnvWithLegacy(name: string, legacyName: string, fallback: number, min = 0) {
  const value = Number(process.env[name] ?? process.env[legacyName] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

function readBoolEnv(name: string, fallback: boolean) {
  const raw = readStringEnv(name);
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

function readPodStatus(pod: RunpodPod | null | undefined) {
  return pod?.desiredStatus?.trim().toUpperCase() || null;
}

function isStoppedPod(pod: RunpodPod | null | undefined) {
  const status = readPodStatus(pod);
  return status === "EXITED" || status === "STOPPED";
}

function isTerminatedPod(pod: RunpodPod | null | undefined) {
  return readPodStatus(pod) === "TERMINATED";
}

function isRunningPod(pod: RunpodPod | null | undefined) {
  return readPodStatus(pod) === "RUNNING";
}

function isActivePod(pod: RunpodPod | null | undefined) {
  return Boolean(pod) && !isStoppedPod(pod) && !isTerminatedPod(pod);
}

function getPodTimestamp(pod: RunpodPod) {
  const candidates = [pod.lastStartedAt, pod.createdAt];
  for (const raw of candidates) {
    if (!raw) continue;
    const value = Date.parse(raw);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function rankPod(pod: RunpodPod) {
  if (isRunningPod(pod)) return 0;
  if (isActivePod(pod)) return 1;
  if (isStoppedPod(pod)) return 2;
  if (isTerminatedPod(pod)) return 3;
  return 4;
}

function sortPods(pods: RunpodPod[]) {
  return [...pods].sort((left, right) => {
    const rankDiff = rankPod(left) - rankPod(right);
    if (rankDiff !== 0) return rankDiff;
    return getPodTimestamp(right) - getPodTimestamp(left);
  });
}

function normalizePod(payload: unknown): RunpodPod {
  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const gpu = raw.gpu && typeof raw.gpu === "object" ? (raw.gpu as Record<string, unknown>) : null;
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name: typeof raw.name === "string" ? raw.name : null,
    image:
      typeof raw.image === "string"
        ? raw.image
        : typeof raw.imageName === "string"
          ? raw.imageName
          : null,
    imageName: typeof raw.imageName === "string" ? raw.imageName : null,
    desiredStatus: typeof raw.desiredStatus === "string" ? raw.desiredStatus : null,
    lastStartedAt: typeof raw.lastStartedAt === "string" ? raw.lastStartedAt : null,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    env:
      raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)
        ? Object.fromEntries(
            Object.entries(raw.env as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")])
          )
        : null,
    publicIp: typeof raw.publicIp === "string" ? raw.publicIp : null,
    costPerHr:
      typeof raw.costPerHr === "string" || typeof raw.costPerHr === "number"
        ? (raw.costPerHr as string | number)
        : null,
    adjustedCostPerHr: typeof raw.adjustedCostPerHr === "number" ? raw.adjustedCostPerHr : null,
    machineId: typeof raw.machineId === "string" ? raw.machineId : null,
    gpu: gpu
      ? {
          count: typeof gpu.count === "number" ? gpu.count : null,
          displayName: typeof gpu.displayName === "string" ? gpu.displayName : null,
        }
      : null,
  };
}

function normalizePodList(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload.map(normalizePod).filter((pod) => Boolean(pod.id));
  }
  if (payload && typeof payload === "object") {
    const raw = payload as Record<string, unknown>;
    for (const key of ["data", "pods", "results"]) {
      if (Array.isArray(raw[key])) {
        return (raw[key] as unknown[]).map(normalizePod).filter((pod) => Boolean(pod.id));
      }
    }
  }
  return [] as RunpodPod[];
}

function matchesManagedPod(pod: RunpodPod, config: RunpodWorkerConfig) {
  if (!pod.id) return false;
  const sameName = (pod.name || "") === config.name;
  if (!sameName) return false;
  const image = pod.imageName || pod.image || "";
  return !image || image === config.image;
}

export function getRunpodWorkerConfig(): RunpodWorkerConfig | null {
  const apiKey = readStringEnv("RUNPOD_API_KEY");
  if (!apiKey) return null;
  return {
    apiKey,
    name: readStringEnv("RUNPOD_WORKER_NAME", DEFAULT_WORKER_NAME),
    image: readStringEnv("RUNPOD_WORKER_IMAGE", DEFAULT_WORKER_IMAGE),
    gpu: readStringEnv("RUNPOD_WORKER_GPU", DEFAULT_WORKER_GPU),
    secureCloud: readBoolEnv("RUNPOD_WORKER_SECURE_CLOUD", false),
    containerDiskInGb: readIntEnv("RUNPOD_WORKER_CONTAINER_DISK_GB", 30, 0),
    volumeInGb: readIntEnv("RUNPOD_WORKER_VOLUME_GB", 0, 0),
    gpuCount: readIntEnv("RUNPOD_WORKER_GPU_COUNT", 1, 1),
    autoStopIdleMs: readIntEnvWithLegacy(
      "RUNPOD_WORKER_AUTO_STOP_IDLE_MS",
      "LOCAL_GPU_WORKER_AUTO_STOP_IDLE_MS",
      DEFAULT_AUTO_STOP_IDLE_MS,
      0
    ),
    apiTimeoutMs: readIntEnv("RUNPOD_API_TIMEOUT_MS", DEFAULT_API_TIMEOUT_MS, 1_000),
  };
}

function requireRunpodWorkerConfig() {
  const config = getRunpodWorkerConfig();
  if (!config) {
    throw new Error("RUNPOD_API_KEY が必要です。");
  }
  return config;
}

async function runpodRequest(pathname: string, init?: RunpodFetchOptions) {
  const config = init?.config ?? requireRunpodWorkerConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.apiTimeoutMs);
  try {
    const response = await fetch(`${RUNPOD_API_BASE}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    const payload = await response
      .json()
      .catch(async () => {
        const text = await response.text().catch(() => "");
        return text ? { message: text } : {};
      });
    if (!response.ok) {
      throw new Error(`Runpod API request failed: ${response.status} ${JSON.stringify(payload)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function buildRunpodWorkerEnv(autoStopIdleMs: number) {
  const env = {
    DATABASE_URL: readRequiredEnv("DATABASE_URL"),
    DIRECT_URL: readRequiredEnv("DIRECT_URL"),
    BLOB_READ_WRITE_TOKEN: readRequiredEnv("BLOB_READ_WRITE_TOKEN"),
    OPENAI_API_KEY: readRequiredEnv("OPENAI_API_KEY"),
    PARARIA_BACKGROUND_MODE: readStringEnv("PARARIA_BACKGROUND_MODE", "external") || "external",
    PARARIA_AUDIO_STORAGE_MODE: readStringEnv("PARARIA_AUDIO_STORAGE_MODE", "blob") || "blob",
    PARARIA_AUDIO_BLOB_ACCESS: readStringEnv("PARARIA_AUDIO_BLOB_ACCESS", "private") || "private",
    LLM_MODEL: readStringEnv("LLM_MODEL", "gpt-5.4"),
    LLM_MODEL_FAST: readStringEnv("LLM_MODEL_FAST", "gpt-5.4"),
    LLM_MODEL_REPORT: readStringEnv("LLM_MODEL_REPORT", "gpt-5.4"),
    LLM_CALL_TIMEOUT_MS: readStringEnv("LLM_CALL_TIMEOUT_MS", "90000"),
    JOB_CONCURRENCY: readStringEnv("JOB_CONCURRENCY", "1"),
    SESSION_PART_JOB_CONCURRENCY: readStringEnv("SESSION_PART_JOB_CONCURRENCY", "1"),
    FASTER_WHISPER_MODEL: readStringEnv("FASTER_WHISPER_MODEL", "large-v3"),
    FASTER_WHISPER_REQUIRE_CUDA: readStringEnv("FASTER_WHISPER_REQUIRE_CUDA", "1"),
    FASTER_WHISPER_DEVICE: readStringEnv("FASTER_WHISPER_DEVICE", "auto"),
    FASTER_WHISPER_COMPUTE_TYPE: readStringEnv("FASTER_WHISPER_COMPUTE_TYPE", "auto"),
    FASTER_WHISPER_CPU_COMPUTE_TYPE: readStringEnv("FASTER_WHISPER_CPU_COMPUTE_TYPE", "int8"),
    FASTER_WHISPER_BEAM_SIZE: readStringEnv("FASTER_WHISPER_BEAM_SIZE", "1"),
    FASTER_WHISPER_BATCH_SIZE: readStringEnv("FASTER_WHISPER_BATCH_SIZE", "16"),
    FASTER_WHISPER_VAD_FILTER: readStringEnv("FASTER_WHISPER_VAD_FILTER", "1"),
    FASTER_WHISPER_CONDITION_ON_PREVIOUS_TEXT: readStringEnv("FASTER_WHISPER_CONDITION_ON_PREVIOUS_TEXT", "1"),
    FASTER_WHISPER_CHUNKING_ENABLED: readStringEnv("FASTER_WHISPER_CHUNKING_ENABLED", "0"),
    FASTER_WHISPER_CHUNK_SECONDS: readStringEnv("FASTER_WHISPER_CHUNK_SECONDS", "60"),
    FASTER_WHISPER_CHUNK_OVERLAP_SECONDS: readStringEnv("FASTER_WHISPER_CHUNK_OVERLAP_SECONDS", "1.5"),
    FASTER_WHISPER_CHUNK_MIN_DURATION_SECONDS: readStringEnv("FASTER_WHISPER_CHUNK_MIN_DURATION_SECONDS", "180"),
    FASTER_WHISPER_POOL_SIZE: readStringEnv("FASTER_WHISPER_POOL_SIZE", "1"),
    RUNPOD_WORKER_SESSION_PART_LIMIT: readStringEnvWithLegacy("RUNPOD_WORKER_SESSION_PART_LIMIT", "LOCAL_GPU_WORKER_SESSION_PART_LIMIT", "8"),
    RUNPOD_WORKER_SESSION_PART_CONCURRENCY: readStringEnvWithLegacy(
      "RUNPOD_WORKER_SESSION_PART_CONCURRENCY",
      "LOCAL_GPU_WORKER_SESSION_PART_CONCURRENCY",
      "1"
    ),
    RUNPOD_WORKER_CONVERSATION_LIMIT: readStringEnvWithLegacy("RUNPOD_WORKER_CONVERSATION_LIMIT", "LOCAL_GPU_WORKER_CONVERSATION_LIMIT", "6"),
    RUNPOD_WORKER_CONVERSATION_CONCURRENCY: readStringEnvWithLegacy(
      "RUNPOD_WORKER_CONVERSATION_CONCURRENCY",
      "LOCAL_GPU_WORKER_CONVERSATION_CONCURRENCY",
      "1"
    ),
    RUNPOD_WORKER_IDLE_WAIT_MS: readStringEnvWithLegacy("RUNPOD_WORKER_IDLE_WAIT_MS", "LOCAL_GPU_WORKER_IDLE_WAIT_MS", "2500"),
    RUNPOD_WORKER_ACTIVE_WAIT_MS: readStringEnvWithLegacy("RUNPOD_WORKER_ACTIVE_WAIT_MS", "LOCAL_GPU_WORKER_ACTIVE_WAIT_MS", "200"),
    RUNPOD_WORKER_AUTO_STOP_IDLE_MS: String(autoStopIdleMs),
    RUNPOD_WORKER_ONLY_SESSION_ID: readStringEnv("RUNPOD_WORKER_ONLY_SESSION_ID", ""),
    RUNPOD_WORKER_ONLY_CONVERSATION_ID: readStringEnv("RUNPOD_WORKER_ONLY_CONVERSATION_ID", ""),
  } satisfies Record<string, string>;

  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
}

function buildCreateBody(
  config: RunpodWorkerConfig,
  overrides?: Partial<Omit<RunpodWorkerConfig, "apiKey" | "apiTimeoutMs" | "autoStopIdleMs">>
) {
  return {
    name: overrides?.name ?? config.name,
    imageName: overrides?.image ?? config.image,
    dockerStartCmd: ["bash", "scripts/runpod-worker-start.sh"],
    gpuTypeIds: [overrides?.gpu ?? config.gpu],
    gpuCount: overrides?.gpuCount ?? config.gpuCount,
    containerDiskInGb: overrides?.containerDiskInGb ?? config.containerDiskInGb,
    volumeInGb: overrides?.volumeInGb ?? config.volumeInGb,
    cloudType: (overrides?.secureCloud ?? config.secureCloud) ? "SECURE" : "COMMUNITY",
    env: buildRunpodWorkerEnv(config.autoStopIdleMs),
  };
}

export async function listRunpodPods(config?: RunpodWorkerConfig) {
  const payload = await runpodRequest("/pods", { method: "GET", config });
  return normalizePodList(payload);
}

export async function getManagedRunpodPods(config?: RunpodWorkerConfig) {
  const resolved = config ?? requireRunpodWorkerConfig();
  const pods = await listRunpodPods(resolved);
  return sortPods(pods.filter((pod) => matchesManagedPod(pod, resolved)));
}

export async function getRunpodPodById(podId: string, config?: RunpodWorkerConfig) {
  const payload = await runpodRequest(`/pods/${podId}`, { method: "GET", config });
  return normalizePod(payload);
}

export async function createRunpodWorkerPod(
  overrides?: Partial<Omit<RunpodWorkerConfig, "apiKey" | "apiTimeoutMs" | "autoStopIdleMs">>,
  config?: RunpodWorkerConfig
) {
  const resolved = config ?? requireRunpodWorkerConfig();
  const payload = await runpodRequest("/pods", {
    method: "POST",
    body: JSON.stringify(buildCreateBody(resolved, overrides)),
    config: resolved,
  });
  return normalizePod(payload);
}

async function terminateRunpodPod(podId: string, config: RunpodWorkerConfig) {
  await runpodRequest(`/pods/${podId}`, { method: "DELETE", config });
}

export async function terminateManagedRunpodWorker(config?: RunpodWorkerConfig): Promise<RunpodWorkerTerminateResult> {
  const resolved = config ?? getRunpodWorkerConfig();
  if (!resolved) {
    return {
      ok: false,
      terminatedPodIds: [],
      skipped: "RUNPOD_API_KEY is not configured on this machine.",
    };
  }

  try {
    const pods = await getManagedRunpodPods(resolved);
    for (const pod of pods) {
      await terminateRunpodPod(pod.id, resolved);
    }
    return {
      ok: true,
      terminatedPodIds: pods.map((pod) => pod.id),
    };
  } catch (error: any) {
    return {
      ok: false,
      terminatedPodIds: [],
      error: error?.message ?? String(error),
    };
  }
}

export async function ensureRunpodWorker(
  config?: RunpodWorkerConfig,
  opts?: {
    fresh?: boolean;
  }
): Promise<RunpodWorkerEnsureResult> {
  const resolved = config ?? requireRunpodWorkerConfig();
  const fresh = Boolean(opts?.fresh);
  const terminatedPodIds: string[] = [];
  const existingPods = await getManagedRunpodPods(resolved);
  if (fresh && existingPods.length > 0) {
    for (const pod of existingPods) {
      await terminateRunpodPod(pod.id, resolved);
      terminatedPodIds.push(pod.id);
    }
  }
  if (fresh) {
    const created = await createRunpodWorkerPod(undefined, resolved);
    return { action: "created_new", pod: created, terminatedPodIds };
  }

  const running = existingPods.find((pod) => isActivePod(pod));
  if (running) {
    return { action: "already_running", pod: running };
  }

  const stopped = existingPods.find((pod) => isStoppedPod(pod));
  if (stopped) {
    await runpodRequest(`/pods/${stopped.id}/start`, { method: "POST", config: resolved });
    return {
      action: "started_existing",
      pod: {
        ...stopped,
        desiredStatus: "RUNNING",
      },
    };
  }

  const created = await createRunpodWorkerPod(undefined, resolved);
  return { action: "created_new", pod: created };
}

export async function maybeEnsureRunpodWorker(): Promise<RunpodWorkerWakeResult> {
  const config = getRunpodWorkerConfig();
  if (!config) {
    return {
      attempted: false,
      ok: false,
      skipped: "RUNPOD_API_KEY is not configured on this server.",
    };
  }

  try {
    const ensured = await ensureRunpodWorker(config);
    return {
      attempted: true,
      ok: true,
      action: ensured.action,
      podId: ensured.pod.id,
      desiredStatus: readPodStatus(ensured.pod),
      name: config.name,
    };
  } catch (error: any) {
    return {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error),
      name: config.name,
    };
  }
}

export async function stopManagedRunpodWorker(config?: RunpodWorkerConfig): Promise<RunpodWorkerStopResult> {
  const resolved = config ?? getRunpodWorkerConfig();
  if (!resolved) {
    return {
      ok: false,
      stoppedPodIds: [],
      alreadyStoppedPodIds: [],
      skipped: "RUNPOD_API_KEY is not configured on this machine.",
    };
  }

  try {
    const pods = await getManagedRunpodPods(resolved);
    const activePods = pods.filter((pod) => isActivePod(pod));
    const alreadyStoppedPods = pods.filter((pod) => isStoppedPod(pod) || isTerminatedPod(pod));

    for (const pod of activePods) {
      await runpodRequest(`/pods/${pod.id}/stop`, { method: "POST", config: resolved });
    }

    return {
      ok: true,
      stoppedPodIds: activePods.map((pod) => pod.id),
      alreadyStoppedPodIds: alreadyStoppedPods.map((pod) => pod.id),
    };
  } catch (error: any) {
    return {
      ok: false,
      stoppedPodIds: [],
      alreadyStoppedPodIds: [],
      error: error?.message ?? String(error),
    };
  }
}

export async function stopCurrentRunpodPod() {
  const podId = readStringEnv("RUNPOD_POD_ID");
  const config = getRunpodWorkerConfig();
  if (!podId) {
    return {
      ok: false,
      skipped: "RUNPOD_POD_ID is not available in this environment.",
    };
  }
  if (!config) {
    return {
      ok: false,
      skipped: "RUNPOD_API_KEY is not configured in this environment.",
    };
  }

  try {
    await runpodRequest(`/pods/${podId}/stop`, { method: "POST", config });
    return {
      ok: true,
      podId,
    };
  } catch (error: any) {
    return {
      ok: false,
      podId,
      error: error?.message ?? String(error),
    };
  }
}
