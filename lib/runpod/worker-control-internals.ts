import type {
  RunpodPod,
  RunpodWorkerConfig,
} from "./worker-control-core";

const RUNPOD_API_BASE = "https://rest.runpod.io/v1";
const DEFAULT_WORKER_NAME = "pararia-gpu-worker";
const DEFAULT_WORKER_IMAGE = "ghcr.io/mirr-luke/pararia-runpod-worker:latest";
const DEFAULT_WORKER_GPU = "NVIDIA GeForce RTX 5090";
const DEFAULT_WORKER_GPU_FALLBACK = "NVIDIA GeForce RTX 4090";
const DEFAULT_AUTO_STOP_IDLE_MS = 60 * 1000;
const DEFAULT_WORKER_CONVERSATION_LIMIT = "0";

function readStringEnv(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function resolveDefaultWorkerImage() {
  const explicitImage = readStringEnv("RUNPOD_WORKER_IMAGE");
  if (explicitImage) return explicitImage;

  const commitSha = readStringEnv("VERCEL_GIT_COMMIT_SHA");
  if (commitSha) {
    return `ghcr.io/mirr-luke/pararia-runpod-worker:sha-${commitSha}`;
  }

  return DEFAULT_WORKER_IMAGE;
}

function readStringEnvWithLegacy(name: string, legacyName: string, fallback = "") {
  return readStringEnv(name, readStringEnv(legacyName, fallback));
}

function readStringListEnv(name: string, fallback: string[] = []) {
  const raw = readStringEnv(name);
  const items = (raw ? raw.split(",") : fallback).map((item) => item.trim()).filter(Boolean);
  return [...new Set(items)];
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

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readPodStatus(pod: RunpodPod | null | undefined) {
  return pod?.desiredStatus?.trim().toUpperCase() || null;
}

export function isStoppedPod(pod: RunpodPod | null | undefined) {
  const status = readPodStatus(pod);
  return status === "EXITED" || status === "STOPPED";
}

export function isTerminatedPod(pod: RunpodPod | null | undefined) {
  return readPodStatus(pod) === "TERMINATED";
}

export function isRunningPod(pod: RunpodPod | null | undefined) {
  return readPodStatus(pod) === "RUNNING";
}

export function isActivePod(pod: RunpodPod | null | undefined) {
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

function isFloatingWorkerImageTag(image: string) {
  return image.trim().toLowerCase().endsWith(":latest");
}

let hasWarnedLatestWorkerImage = false;

export function warnIfWorkerImageLooksMutable(config: RunpodWorkerConfig) {
  if (hasWarnedLatestWorkerImage || !isFloatingWorkerImageTag(config.image)) return;
  hasWarnedLatestWorkerImage = true;
  console.warn(
    `[runpod-worker] RUNPOD_WORKER_IMAGE=${config.image} is using a mutable tag. 本番や切り分けでは sha 固定 image を推奨します。`
  );
}

function matchesManagedPod(pod: RunpodPod, config: RunpodWorkerConfig) {
  if (!pod.id) return false;
  const sameName = (pod.name || "") === config.name;
  if (!sameName) return false;
  const image = pod.imageName || pod.image || "";
  return !image || image === config.image;
}

export async function getRunpodPodsByName(config?: RunpodWorkerConfig) {
  const resolved = config ?? getRunpodWorkerConfig();
  if (!resolved) {
    throw new Error("RUNPOD_API_KEY が必要です。");
  }
  const pods = await listRunpodPods(resolved);
  return sortPods(pods.filter((pod) => (pod.name || "") === resolved.name));
}

export function getRunpodWorkerConfig(): RunpodWorkerConfig | null {
  const apiKey = readStringEnv("RUNPOD_API_KEY");
  if (!apiKey) return null;
  const legacyGpu = readStringEnv("RUNPOD_WORKER_GPU", "");
  const gpuCandidates = readStringListEnv("RUNPOD_WORKER_GPU_CANDIDATES", [
    DEFAULT_WORKER_GPU,
    legacyGpu || DEFAULT_WORKER_GPU_FALLBACK,
  ]);
  const config = {
    apiKey,
    name: readStringEnv("RUNPOD_WORKER_NAME", DEFAULT_WORKER_NAME),
    image: resolveDefaultWorkerImage(),
    containerRegistryAuthId: readStringEnv("RUNPOD_WORKER_CONTAINER_REGISTRY_AUTH_ID", "") || null,
    gpu: gpuCandidates[0] || DEFAULT_WORKER_GPU,
    gpuCandidates,
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
    apiTimeoutMs: readIntEnv("RUNPOD_API_TIMEOUT_MS", 15_000, 1_000),
  } satisfies RunpodWorkerConfig;
  warnIfWorkerImageLooksMutable(config);
  return config;
}

export async function runpodRequest(pathname: string, config: RunpodWorkerConfig, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.apiTimeoutMs);
  try {
    const response = await fetch(`${RUNPOD_API_BASE}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
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
    return payload as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildRunpodWorkerEnv(autoStopIdleMs: number) {
  const env = {
    RUNPOD_API_KEY: readRequiredEnv("RUNPOD_API_KEY"),
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
    FASTER_WHISPER_VAD_MIN_SILENCE_MS: readStringEnv("FASTER_WHISPER_VAD_MIN_SILENCE_MS", "1000"),
    FASTER_WHISPER_VAD_SPEECH_PAD_MS: readStringEnv("FASTER_WHISPER_VAD_SPEECH_PAD_MS", "400"),
    FASTER_WHISPER_VAD_THRESHOLD: readStringEnv("FASTER_WHISPER_VAD_THRESHOLD", "0.5"),
    FASTER_WHISPER_VAD_MIN_SPEECH_MS: readStringEnv("FASTER_WHISPER_VAD_MIN_SPEECH_MS", ""),
    FASTER_WHISPER_CONDITION_ON_PREVIOUS_TEXT: readStringEnv("FASTER_WHISPER_CONDITION_ON_PREVIOUS_TEXT", "1"),
    FASTER_WHISPER_CHUNKING_ENABLED: readStringEnv("FASTER_WHISPER_CHUNKING_ENABLED", "0"),
    FASTER_WHISPER_CHUNK_SECONDS: readStringEnv("FASTER_WHISPER_CHUNK_SECONDS", "60"),
    FASTER_WHISPER_CHUNK_OVERLAP_SECONDS: readStringEnv("FASTER_WHISPER_CHUNK_OVERLAP_SECONDS", "1.5"),
    FASTER_WHISPER_CHUNK_MIN_DURATION_SECONDS: readStringEnv("FASTER_WHISPER_CHUNK_MIN_DURATION_SECONDS", "180"),
    FASTER_WHISPER_POOL_SIZE: readStringEnv("FASTER_WHISPER_POOL_SIZE", "1"),
    FASTER_WHISPER_DOWNLOAD_ROOT: readStringEnv("FASTER_WHISPER_DOWNLOAD_ROOT", "/workspace/.cache/faster-whisper"),
    RUNPOD_WORKER_SESSION_PART_LIMIT: readStringEnvWithLegacy(
      "RUNPOD_WORKER_SESSION_PART_LIMIT",
      "LOCAL_GPU_WORKER_SESSION_PART_LIMIT",
      "8"
    ),
    RUNPOD_WORKER_SESSION_PART_CONCURRENCY: readStringEnvWithLegacy(
      "RUNPOD_WORKER_SESSION_PART_CONCURRENCY",
      "LOCAL_GPU_WORKER_SESSION_PART_CONCURRENCY",
      "1"
    ),
    RUNPOD_WORKER_CONVERSATION_LIMIT: readStringEnvWithLegacy(
      "RUNPOD_WORKER_CONVERSATION_LIMIT",
      "LOCAL_GPU_WORKER_CONVERSATION_LIMIT",
      DEFAULT_WORKER_CONVERSATION_LIMIT
    ),
    RUNPOD_WORKER_CONVERSATION_CONCURRENCY: readStringEnvWithLegacy(
      "RUNPOD_WORKER_CONVERSATION_CONCURRENCY",
      "LOCAL_GPU_WORKER_CONVERSATION_CONCURRENCY",
      "1"
    ),
    RUNPOD_WORKER_IDLE_WAIT_MS: readStringEnvWithLegacy(
      "RUNPOD_WORKER_IDLE_WAIT_MS",
      "LOCAL_GPU_WORKER_IDLE_WAIT_MS",
      "2500"
    ),
    RUNPOD_WORKER_ACTIVE_WAIT_MS: readStringEnvWithLegacy(
      "RUNPOD_WORKER_ACTIVE_WAIT_MS",
      "LOCAL_GPU_WORKER_ACTIVE_WAIT_MS",
      "200"
    ),
    RUNPOD_WORKER_AUTO_STOP_IDLE_MS: String(autoStopIdleMs),
    RUNPOD_WORKER_ONLY_SESSION_ID: readStringEnv("RUNPOD_WORKER_ONLY_SESSION_ID", ""),
    RUNPOD_WORKER_ONLY_CONVERSATION_ID: readStringEnv("RUNPOD_WORKER_ONLY_CONVERSATION_ID", ""),
    RUNPOD_WORKER_RUNTIME_REVISION: readStringEnv("RUNPOD_WORKER_RUNTIME_REVISION", ""),
  } satisfies Record<string, string>;

  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
}

export function buildRunpodWorkerCreateBody(
  config: RunpodWorkerConfig,
  overrides?: Partial<Omit<RunpodWorkerConfig, "apiKey" | "apiTimeoutMs" | "autoStopIdleMs">>,
  options?: {
    includeRuntimeConfig?: boolean;
  }
) {
  const includeRuntimeConfig = options?.includeRuntimeConfig ?? true;
  return {
    name: overrides?.name ?? config.name,
    imageName: overrides?.image ?? config.image,
    containerRegistryAuthId: overrides?.containerRegistryAuthId ?? config.containerRegistryAuthId ?? undefined,
    gpuTypeIds: [overrides?.gpu ?? config.gpu],
    gpuCount: overrides?.gpuCount ?? config.gpuCount,
    containerDiskInGb: overrides?.containerDiskInGb ?? config.containerDiskInGb,
    volumeInGb: overrides?.volumeInGb ?? config.volumeInGb,
    cloudType: (overrides?.secureCloud ?? config.secureCloud) ? "SECURE" : "COMMUNITY",
    ...(includeRuntimeConfig
      ? {
          dockerStartCmd: ["bash", "/workspace/scripts/runpod-worker-start.sh"],
          env: buildRunpodWorkerEnv(config.autoStopIdleMs),
        }
      : {}),
  };
}

export function getRunpodGpuCandidates(
  config: RunpodWorkerConfig,
  overrides?: Partial<Omit<RunpodWorkerConfig, "apiKey" | "apiTimeoutMs" | "autoStopIdleMs">>
) {
  const preferred = overrides?.gpu?.trim();
  return [...new Set([preferred, ...(config.gpuCandidates ?? []), config.gpu].filter(Boolean) as string[])];
}

export function isRunpodCapacityErrorMessage(message: string) {
  return (
    /does not have the resources to deploy your pod/i.test(message) ||
    /not enough free gpus/i.test(message) ||
    /no spot price found/i.test(message) ||
    /insufficient capacity/i.test(message)
  );
}

export async function listRunpodPods(config?: RunpodWorkerConfig) {
  const resolved = config ?? getRunpodWorkerConfig();
  if (!resolved) {
    throw new Error("RUNPOD_API_KEY が必要です。");
  }
  const payload = await runpodRequest("/pods", resolved, { method: "GET" });
  return normalizePodList(payload);
}

export async function getManagedRunpodPods(config?: RunpodWorkerConfig) {
  const resolved = config ?? getRunpodWorkerConfig();
  if (!resolved) {
    throw new Error("RUNPOD_API_KEY が必要です。");
  }
  const pods = await listRunpodPods(resolved);
  return sortPods(pods.filter((pod) => matchesManagedPod(pod, resolved)));
}

export async function getRunpodPodById(podId: string, config?: RunpodWorkerConfig) {
  const resolved = config ?? getRunpodWorkerConfig();
  if (!resolved) {
    throw new Error("RUNPOD_API_KEY が必要です。");
  }
  const payload = await runpodRequest(`/pods/${podId}`, resolved, { method: "GET" });
  return normalizePod(payload);
}
