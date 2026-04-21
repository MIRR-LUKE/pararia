type RunpodWorkerFeatureFlagValue = string | number | boolean;

export type RunpodWorkerRuntimeMetadata = {
  runpodWorkerImage: string | null;
  runpodWorkerRuntimeRevision: string | null;
  runpodWorkerGitSha: string | null;
  runpodWorkerPodId: string | null;
  runpodWorkerFeatureFlags: Record<string, RunpodWorkerFeatureFlagValue> | null;
};

function readStringEnv(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function readOptionalIntEnv(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : null;
}

function readOptionalBooleanEnv(name: string) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}

function extractRevisionFromImage(image: string) {
  const normalized = image.trim();
  if (!normalized) return null;
  const digestMatch = normalized.match(/@sha256:([a-f0-9]{12,64})$/i);
  if (digestMatch?.[1]) {
    return `digest-${digestMatch[1]}`;
  }
  const shaTagMatch = normalized.match(/:sha-([a-f0-9]{7,64})$/i);
  if (shaTagMatch?.[1]) {
    return `git-${shaTagMatch[1]}`;
  }
  return null;
}

export function resolveRunpodWorkerGitSha(defaultImage?: string | null) {
  const explicitGitSha = readStringEnv("RUNPOD_WORKER_GIT_SHA");
  if (explicitGitSha) return explicitGitSha;

  const vercelGitSha = readStringEnv("VERCEL_GIT_COMMIT_SHA");
  if (vercelGitSha) return vercelGitSha;

  const image = readStringEnv("RUNPOD_WORKER_IMAGE", defaultImage?.trim() || "");
  const revision = extractRevisionFromImage(image);
  if (revision?.startsWith("git-")) {
    return revision.slice("git-".length);
  }

  return "";
}

export function resolveRunpodWorkerRuntimeRevision(defaultImage?: string | null) {
  const explicitRevision = readStringEnv("RUNPOD_WORKER_RUNTIME_REVISION");
  if (explicitRevision) return explicitRevision;

  const gitSha = resolveRunpodWorkerGitSha(defaultImage);
  if (gitSha) return `git-${gitSha}`;

  const image = readStringEnv("RUNPOD_WORKER_IMAGE", defaultImage?.trim() || "");
  return extractRevisionFromImage(image) || "";
}

export function buildRunpodWorkerRuntimeEnv(defaultImage?: string | null) {
  const image = readStringEnv("RUNPOD_WORKER_IMAGE", defaultImage?.trim() || "");
  const gitSha = resolveRunpodWorkerGitSha(defaultImage);
  const runtimeRevision = resolveRunpodWorkerRuntimeRevision(defaultImage);

  return Object.fromEntries(
    Object.entries({
      RUNPOD_WORKER_IMAGE: image,
      RUNPOD_WORKER_GIT_SHA: gitSha,
      RUNPOD_WORKER_RUNTIME_REVISION: runtimeRevision,
    }).filter(([, value]) => String(value).trim() !== "")
  ) as Record<string, string>;
}

export function readRunpodWorkerRuntimeMetadata(): RunpodWorkerRuntimeMetadata {
  const featureFlags: Record<string, RunpodWorkerFeatureFlagValue> = {};

  const backgroundMode = readStringEnv("PARARIA_BACKGROUND_MODE");
  if (backgroundMode) featureFlags.backgroundMode = backgroundMode;

  const audioStorageMode = readStringEnv("PARARIA_AUDIO_STORAGE_MODE");
  if (audioStorageMode) featureFlags.audioStorageMode = audioStorageMode;

  const audioBlobAccess = readStringEnv("PARARIA_AUDIO_BLOB_ACCESS");
  if (audioBlobAccess) featureFlags.audioBlobAccess = audioBlobAccess;

  const chunkingEnabled = readOptionalBooleanEnv("FASTER_WHISPER_CHUNKING_ENABLED");
  if (chunkingEnabled !== null) featureFlags.fasterWhisperChunkingEnabled = chunkingEnabled;

  const vadFilter = readOptionalBooleanEnv("FASTER_WHISPER_VAD_FILTER");
  if (vadFilter !== null) featureFlags.fasterWhisperVadFilter = vadFilter;

  const requireCuda = readOptionalBooleanEnv("FASTER_WHISPER_REQUIRE_CUDA");
  if (requireCuda !== null) featureFlags.fasterWhisperRequireCuda = requireCuda;

  const beamSize = readOptionalIntEnv("FASTER_WHISPER_BEAM_SIZE");
  if (beamSize !== null) featureFlags.fasterWhisperBeamSize = beamSize;

  const batchSize = readOptionalIntEnv("FASTER_WHISPER_BATCH_SIZE");
  if (batchSize !== null) featureFlags.fasterWhisperBatchSize = batchSize;

  const sessionPartLimit = readOptionalIntEnv("RUNPOD_WORKER_SESSION_PART_LIMIT");
  if (sessionPartLimit !== null) featureFlags.sessionPartLimit = sessionPartLimit;

  const conversationLimit = readOptionalIntEnv("RUNPOD_WORKER_CONVERSATION_LIMIT");
  if (conversationLimit !== null) featureFlags.conversationLimit = conversationLimit;

  const runtimeRevision = readStringEnv("RUNPOD_WORKER_RUNTIME_REVISION") || resolveRunpodWorkerRuntimeRevision();
  const gitSha = readStringEnv("RUNPOD_WORKER_GIT_SHA") || resolveRunpodWorkerGitSha();

  return {
    runpodWorkerImage: readStringEnv("RUNPOD_WORKER_IMAGE") || null,
    runpodWorkerRuntimeRevision: runtimeRevision || null,
    runpodWorkerGitSha: gitSha || null,
    runpodWorkerPodId: readStringEnv("RUNPOD_POD_ID") || null,
    runpodWorkerFeatureFlags: Object.keys(featureFlags).length > 0 ? featureFlags : null,
  };
}
