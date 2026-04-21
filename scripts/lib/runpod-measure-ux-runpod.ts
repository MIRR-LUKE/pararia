import { loadEnvFile } from "./load-env-file";
import { loadLocalEnvFiles } from "./load-local-env";
import { readRequiredEnv, sleep } from "./runpod-measure-ux-core";
import { buildRunpodWorkerRuntimeEnv } from "../../lib/runpod/runtime-metadata";

export type GpuProfileName = "4090" | "5090";
export type StartupMode = "direct" | "bootstrap" | "reuse";

export type GpuProfile = {
  name: GpuProfileName;
  gpu: string;
  computeType: string;
  batchSize: string;
  beamSize: string;
};

export const GPU_PROFILES: Record<GpuProfileName, GpuProfile> = {
  "4090": {
    name: "4090",
    gpu: "NVIDIA GeForce RTX 4090",
    computeType: "auto",
    batchSize: "64",
    beamSize: "1",
  },
  "5090": {
    name: "5090",
    gpu: "NVIDIA GeForce RTX 5090",
    computeType: "float16",
    batchSize: "64",
    beamSize: "1",
  },
};

export function buildBootstrapCommand(gitRef: string) {
  const lines = [
    "set -euo pipefail",
    "debug_dir=/tmp/runpod-debug",
    "mkdir -p \"$debug_dir\"",
    ": > \"$debug_dir/progress.log\"",
    "log(){ printf '%s %s\\n' \"$(date --iso-8601=seconds)\" \"$*\" | tee -a \"$debug_dir/progress.log\"; }",
    "python3 -m http.server 8888 --directory \"$debug_dir\" >\"$debug_dir/http.log\" 2>&1 &",
    "log bootstrap_started",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update",
    "log apt_update_done",
    "apt-get install -y curl ca-certificates xz-utils",
    "log apt_install_done",
    "if ! command -v node >/dev/null 2>&1; then",
    "  log node_install_start",
    "  node_tarball=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-x64\\.tar\\.xz$/ {print $2; exit}')",
    "  curl -fsSL \"https://nodejs.org/dist/latest-v22.x/${node_tarball}\" -o /tmp/node.tar.xz",
    "  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1",
    "  log node_install_done",
    "fi",
    "workspace=/workspace/pararia",
    "rm -rf \"$workspace\"",
    "mkdir -p \"$workspace\"",
    "log repo_download_start",
    `curl -fsSL "https://codeload.github.com/MIRR-LUKE/pararia/tar.gz/${gitRef}" | tar -xzf - --strip-components=1 -C "$workspace"`,
    "log repo_download_done",
    "cd \"$workspace\"",
    "log pip_requirements_start",
    "python3 -m pip install --no-cache-dir -r \"$workspace/scripts/requirements.runpod-worker.txt\"",
    "log pip_requirements_done",
    "log npm_ci_start",
    "npm ci --no-audit --no-fund",
    "log npm_ci_done",
    "export PARARIA_RUNPOD_WORKSPACE_DIR=\"$workspace\"",
    "log worker_exec",
    "exec bash \"$workspace/scripts/runpod-worker-start.sh\" >>\"$debug_dir/worker.log\" 2>&1",
  ];

  return ["bash", "-lc", lines.join("\n")];
}

export function buildDirectStartCommand() {
  return ["bash", "/workspace/scripts/runpod-worker-start.sh"];
}

export function buildWorkerEnv(input: {
  sessionId: string;
  autoStopIdleMs: number;
  profile: GpuProfile;
  workerImage?: string | null;
}) {
  return {
    DATABASE_URL: readRequiredEnv("DATABASE_URL"),
    DIRECT_URL: readRequiredEnv("DIRECT_URL"),
    BLOB_READ_WRITE_TOKEN: readRequiredEnv("BLOB_READ_WRITE_TOKEN"),
    OPENAI_API_KEY: readRequiredEnv("OPENAI_API_KEY"),
    RUNPOD_API_KEY: readRequiredEnv("RUNPOD_API_KEY"),
    PARARIA_BACKGROUND_MODE: "external",
    PARARIA_AUDIO_STORAGE_MODE: "blob",
    PARARIA_AUDIO_BLOB_ACCESS: "private",
    NEXT_PUBLIC_AUDIO_STORAGE_MODE: "blob",
    LLM_MODEL: process.env.LLM_MODEL?.trim() || "gpt-5.4",
    LLM_MODEL_FAST: process.env.LLM_MODEL_FAST?.trim() || process.env.LLM_MODEL?.trim() || "gpt-5.4",
    LLM_MODEL_REPORT: process.env.LLM_MODEL_REPORT?.trim() || process.env.LLM_MODEL?.trim() || "gpt-5.4",
    LLM_CALL_TIMEOUT_MS: process.env.LLM_CALL_TIMEOUT_MS?.trim() || "90000",
    JOB_CONCURRENCY: "1",
    SESSION_PART_JOB_CONCURRENCY: "1",
    FASTER_WHISPER_MODEL: process.env.FASTER_WHISPER_MODEL?.trim() || "large-v3",
    FASTER_WHISPER_REQUIRE_CUDA: "1",
    FASTER_WHISPER_DEVICE: "auto",
    FASTER_WHISPER_COMPUTE_TYPE: input.profile.computeType,
    FASTER_WHISPER_CPU_COMPUTE_TYPE: process.env.FASTER_WHISPER_CPU_COMPUTE_TYPE?.trim() || "int8",
    FASTER_WHISPER_BEAM_SIZE: input.profile.beamSize,
    FASTER_WHISPER_BATCH_SIZE: input.profile.batchSize,
    FASTER_WHISPER_VAD_FILTER: process.env.FASTER_WHISPER_VAD_FILTER?.trim() || "1",
    FASTER_WHISPER_VAD_MIN_SILENCE_MS: process.env.FASTER_WHISPER_VAD_MIN_SILENCE_MS?.trim() || "1000",
    FASTER_WHISPER_VAD_SPEECH_PAD_MS: process.env.FASTER_WHISPER_VAD_SPEECH_PAD_MS?.trim() || "400",
    FASTER_WHISPER_VAD_THRESHOLD: process.env.FASTER_WHISPER_VAD_THRESHOLD?.trim() || "0.5",
    FASTER_WHISPER_VAD_MIN_SPEECH_MS: process.env.FASTER_WHISPER_VAD_MIN_SPEECH_MS?.trim() || "",
    FASTER_WHISPER_CONDITION_ON_PREVIOUS_TEXT: process.env.FASTER_WHISPER_CONDITION_ON_PREVIOUS_TEXT?.trim() || "1",
    FASTER_WHISPER_CHUNKING_ENABLED: "0",
    FASTER_WHISPER_POOL_SIZE: "1",
    FASTER_WHISPER_WORKER_COMMAND: "python3",
    FASTER_WHISPER_DOWNLOAD_ROOT: process.env.FASTER_WHISPER_DOWNLOAD_ROOT?.trim() || "/workspace/.cache/faster-whisper",
    RUNPOD_WORKER_SESSION_PART_LIMIT: "1",
    RUNPOD_WORKER_SESSION_PART_CONCURRENCY: "1",
    RUNPOD_WORKER_CONVERSATION_LIMIT: "1",
    RUNPOD_WORKER_CONVERSATION_CONCURRENCY: "1",
    RUNPOD_WORKER_IDLE_WAIT_MS: "2500",
    RUNPOD_WORKER_ACTIVE_WAIT_MS: "200",
    RUNPOD_WORKER_AUTO_STOP_IDLE_MS: String(input.autoStopIdleMs),
    RUNPOD_WORKER_ONLY_SESSION_ID: input.sessionId,
    ...buildRunpodWorkerRuntimeEnv(input.workerImage),
  };
}

export async function runpodRequest(pathname: string, init: RequestInit) {
  const apiKey = readRequiredEnv("RUNPOD_API_KEY");
  const timeoutMs = Number(process.env.RUNPOD_API_TIMEOUT_MS ?? 15_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 15_000);
  try {
    const response = await fetch(`https://rest.runpod.io/v1${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
    return payload as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

type RunpodPodInfo = {
  id: string;
  name?: string | null;
  desiredStatus?: string | null;
  imageName?: string | null;
};

async function listRunpodPods() {
  const payload = await runpodRequest("/pods", { method: "GET" });
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.pods)
        ? payload.pods
        : [];
  return candidates
    .map((item) => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        id: typeof raw.id === "string" ? raw.id : "",
        name: typeof raw.name === "string" ? raw.name : null,
        desiredStatus: typeof raw.desiredStatus === "string" ? raw.desiredStatus : null,
        imageName: typeof raw.imageName === "string" ? raw.imageName : null,
      } satisfies RunpodPodInfo;
    })
    .filter((item) => item.id);
}

async function terminatePodsByName(name: string) {
  const pods = (await listRunpodPods()).filter((pod) => pod.name === name);
  for (const pod of pods) {
    await runpodRequest(`/pods/${pod.id}`, { method: "DELETE" }).catch(() => {});
  }
}

async function stopRunpodPod(podId: string) {
  await runpodRequest(`/pods/${podId}/stop`, { method: "POST" });
}

async function startRunpodPod(podId: string) {
  await runpodRequest(`/pods/${podId}/start`, { method: "POST" });
}

async function patchRunpodPodWorkerConfig(input: {
  podId: string;
  sessionId: string;
  autoStopIdleMs: number;
  profile: GpuProfile;
}) {
  await runpodRequest(`/pods/${input.podId}`, {
    method: "PATCH",
    body: JSON.stringify({
      dockerStartCmd: buildDirectStartCommand(),
      env: buildWorkerEnv({
        sessionId: input.sessionId,
        autoStopIdleMs: input.autoStopIdleMs,
        profile: input.profile,
        workerImage: process.env.RUNPOD_WORKER_IMAGE?.trim() || null,
      }),
    }),
  });
}

function getHeartbeatPath(podId: string, fileName: string) {
  return `runpod-worker/heartbeats/${podId}/${fileName}`;
}

async function tryReadStorageJson(storagePathname: string) {
  try {
    const { readStorageText } = await import("../../lib/audio-storage");
    return JSON.parse(await readStorageText(storagePathname));
  } catch {
    return null;
  }
}

export {
  getHeartbeatPath,
  loadEnvFile,
  loadLocalEnvFiles,
  patchRunpodPodWorkerConfig,
  startRunpodPod,
  stopRunpodPod,
  terminatePodsByName,
  tryReadStorageJson,
};
