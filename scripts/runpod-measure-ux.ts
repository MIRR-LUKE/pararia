#!/usr/bin/env tsx

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadLocalEnvFiles } from "./lib/load-local-env";
import { loadEnvFile } from "./lib/load-env-file";

type GpuProfileName = "4090" | "5090";
type StartupMode = "direct" | "bootstrap" | "reuse";

type GpuProfile = {
  name: GpuProfileName;
  gpu: string;
  computeType: string;
  batchSize: string;
  beamSize: string;
};

type RunpodMeasureResult = {
  ok: boolean;
  profile: GpuProfileName;
  gpu: string;
  startupMode: StartupMode;
  workerImage?: string | null;
  workerName?: string | null;
  interruptible: boolean;
  sourceAudioPath: string;
  clipAudioPath?: string;
  clipStartSeconds?: number;
  clipDurationSeconds?: number;
  audioDurationSeconds: number | null;
  createAttempts?: number;
  reusePreparedPodId?: string | null;
  reusePreparedAt?: string | null;
  podId?: string;
  podReadyAt?: string | null;
  podReadyMs?: number | null;
  enqueueStartedAt: string;
  sttCompletedAt?: string | null;
  conversationCompletedAt?: string | null;
  queueToSttMs?: number | null;
  queueToConversationMs?: number | null;
  sttSeconds?: number | null;
  sttModel?: string | null;
  sttDevice?: string | null;
  sttComputeType?: string | null;
  sttPipeline?: string | null;
  sttBatchSize?: number | null;
  transcriptChars?: number | null;
  finalizeDurationMs?: number | null;
  finalizeQueueLagMs?: number | null;
  llmCostUsd?: number | null;
  finalizeModel?: string | null;
  artifactChars?: number | null;
  sessionId?: string;
  partId?: string;
  conversationId?: string | null;
  error?: string;
};

const GPU_PROFILES: Record<GpuProfileName, GpuProfile> = {
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

function parseArg(name: string, fallback?: string) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback ?? null;
}

function must(value: string | null | undefined, message: string) {
  if (!value) throw new Error(message);
  return value;
}

function readNumberArg(name: string, fallback: number) {
  const raw = Number(parseArg(name, String(fallback)));
  return Number.isFinite(raw) ? raw : fallback;
}

function readBoolArg(name: string, fallback: boolean) {
  const raw = parseArg(name);
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

async function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}\n${stderr.trim()}`.trim()));
    });
  });
}

async function createAudioClip(sourcePath: string, outputPath: string, startSeconds: number, durationSeconds: number) {
  const ffmpegPath = (await import("ffmpeg-static")).default;
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static path is unavailable.");
  }

  await runCommand(ffmpegPath, [
    "-y",
    "-ss",
    String(startSeconds),
    "-t",
    String(durationSeconds),
    "-i",
    sourcePath,
    "-vn",
    "-acodec",
    "aac",
    "-b:a",
    "128k",
    outputPath,
  ]);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRequiredEnv(name: string) {
  return must(process.env[name]?.trim(), `${name} is required.`);
}

function buildBootstrapCommand(gitRef: string) {
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

function buildDirectStartCommand() {
  return ["bash", "/workspace/scripts/runpod-worker-start.sh"];
}

function buildWorkerEnv(input: {
  sessionId: string;
  autoStopIdleMs: number;
  profile: GpuProfile;
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
    FASTER_WHISPER_CONDITION_ON_PREVIOUS_TEXT: process.env.FASTER_WHISPER_CONDITION_ON_PREVIOUS_TEXT?.trim() || "1",
    FASTER_WHISPER_CHUNKING_ENABLED: "0",
    FASTER_WHISPER_POOL_SIZE: "1",
    FASTER_WHISPER_WORKER_COMMAND: "python3",
    FASTER_WHISPER_DOWNLOAD_ROOT:
      process.env.FASTER_WHISPER_DOWNLOAD_ROOT?.trim() || "/workspace/.cache/faster-whisper",
    RUNPOD_WORKER_SESSION_PART_LIMIT: "1",
    RUNPOD_WORKER_SESSION_PART_CONCURRENCY: "1",
    RUNPOD_WORKER_CONVERSATION_LIMIT: "1",
    RUNPOD_WORKER_CONVERSATION_CONCURRENCY: "1",
    RUNPOD_WORKER_IDLE_WAIT_MS: "2500",
    RUNPOD_WORKER_ACTIVE_WAIT_MS: "200",
    RUNPOD_WORKER_AUTO_STOP_IDLE_MS: String(input.autoStopIdleMs),
    RUNPOD_WORKER_ONLY_SESSION_ID: input.sessionId,
  };
}

async function runpodRequest(pathname: string, init: RequestInit) {
  const apiKey = readRequiredEnv("RUNPOD_API_KEY");
  const response = await fetch(`https://rest.runpod.io/v1${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
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
      }),
    }),
  });
}

function getHeartbeatPath(podId: string, fileName: string) {
  return `runpod-worker/heartbeats/${podId}/${fileName}`;
}

async function tryReadStorageJson(storagePathname: string) {
  try {
    const { readStorageText } = await import("../lib/audio-storage");
    return JSON.parse(await readStorageText(storagePathname));
  } catch {
    return null;
  }
}

async function createBootstrapWorkerPod(input: {
  profile: GpuProfile;
  gitRef: string;
  sessionId: string;
  autoStopIdleMs: number;
  name: string;
  interruptible: boolean;
  createRetries: number;
  createRetryWaitMs: number;
}) {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= input.createRetries) {
    attempt += 1;
    try {
      const requestedAt = new Date();
      const created = await runpodRequest("/pods", {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          imageName: "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04",
          gpuTypeIds: [input.profile.gpu],
          gpuCount: 1,
          cloudType: "COMMUNITY",
          interruptible: input.interruptible,
          containerDiskInGb: 30,
          volumeInGb: 0,
          dockerStartCmd: buildBootstrapCommand(input.gitRef),
          env: buildWorkerEnv({
            sessionId: input.sessionId,
            autoStopIdleMs: input.autoStopIdleMs,
            profile: input.profile,
          }),
        }),
      });

      const podId = String(created.id ?? "").trim();
      if (!podId) {
        throw new Error(`Runpod create did not return a pod id: ${JSON.stringify(created)}`);
      }

      return {
        podId,
        requestedAt,
        attempt,
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /does not have the resources|no spot price found/i.test(message);
      if (!retryable || attempt > input.createRetries) {
        break;
      }
      await sleep(input.createRetryWaitMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "failed to create Runpod pod"));
}

async function createDirectWorkerPod(input: {
  profile: GpuProfile;
  sessionId: string;
  autoStopIdleMs: number;
  name: string;
  interruptible: boolean;
  createRetries: number;
  createRetryWaitMs: number;
  image: string;
  containerRegistryAuthId?: string | null;
}) {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= input.createRetries) {
    attempt += 1;
    try {
      const requestedAt = new Date();
      const created = await runpodRequest("/pods", {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          imageName: input.image,
          containerRegistryAuthId: input.containerRegistryAuthId || undefined,
          gpuTypeIds: [input.profile.gpu],
          gpuCount: 1,
          cloudType: "COMMUNITY",
          interruptible: input.interruptible,
          containerDiskInGb: 30,
          volumeInGb: 0,
        }),
      });

      const podId = String(created.id ?? "").trim();
      if (!podId) {
        throw new Error(`Runpod create did not return a pod id: ${JSON.stringify(created)}`);
      }

      await runpodRequest(`/pods/${podId}`, {
        method: "PATCH",
        body: JSON.stringify({
          dockerStartCmd: buildDirectStartCommand(),
          env: buildWorkerEnv({
            sessionId: input.sessionId,
            autoStopIdleMs: input.autoStopIdleMs,
            profile: input.profile,
          }),
        }),
      });

      return {
        podId,
        requestedAt,
        attempt,
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /does not have the resources|no spot price found/i.test(message);
      if (!retryable || attempt > input.createRetries) {
        break;
      }
      await sleep(input.createRetryWaitMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "failed to create Runpod pod"));
}

async function waitForWorkerReady(podId: string, timeoutMs: number, pollMs: number, minCheckedAtMs?: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const dbOk = await tryReadStorageJson(getHeartbeatPath(podId, "db-ok.json"));
    if (dbOk) {
      const checkedAt = typeof dbOk.checkedAt === "string" ? new Date(dbOk.checkedAt) : new Date();
      if (!minCheckedAtMs || checkedAt.getTime() >= minCheckedAtMs) {
        return {
          ok: true,
          readiness: dbOk,
          checkedAt,
        };
      }
    }

    const dbError = await tryReadStorageJson(getHeartbeatPath(podId, "db-error.json"));
    if (dbError) {
      throw new Error(`worker reported startup db error: ${String(dbError.error ?? "unknown error")}`);
    }

    const pod = await runpodRequest(`/pods/${podId}`, { method: "GET" });
    const status = String(pod.desiredStatus ?? "").trim().toUpperCase();
    if (status === "EXITED" || status === "STOPPED" || status === "TERMINATED") {
      throw new Error(`pod ${podId} left RUNNING before readiness (${status})`);
    }

    await sleep(pollMs);
  }

  throw new Error(`timed out waiting for worker readiness for pod ${podId}`);
}

async function deleteRunpodPod(podId: string | null | undefined) {
  if (!podId) return;
  await runpodRequest(`/pods/${podId}`, { method: "DELETE" }).catch(() => {});
}

async function cleanupBenchmarkRecords(input: {
  sessionId: string | null;
  studentId: string | null;
  partId: string | null;
  conversationId: string | null;
  storageUrl: string | null;
}) {
  const [{ prisma }, { deleteStorageEntry }] = await Promise.all([
    import("../lib/db"),
    import("../lib/audio-storage"),
  ]);

  try {
    if (input.storageUrl) {
      await deleteStorageEntry(input.storageUrl).catch(() => {});
    }
    if (input.conversationId) {
      await prisma.conversationJob.deleteMany({ where: { conversationId: input.conversationId } }).catch(() => {});
      await prisma.conversationLog.deleteMany({ where: { id: input.conversationId } }).catch(() => {});
    }
    if (input.partId) {
      await prisma.sessionPartJob.deleteMany({ where: { sessionPartId: input.partId } }).catch(() => {});
      await prisma.sessionPart.deleteMany({ where: { id: input.partId } }).catch(() => {});
    }
    if (input.sessionId) {
      await prisma.session.deleteMany({ where: { id: input.sessionId } }).catch(() => {});
    }
    if (input.studentId) {
      await prisma.studentProfile.deleteMany({ where: { studentId: input.studentId } }).catch(() => {});
      await prisma.student.deleteMany({ where: { id: input.studentId } }).catch(() => {});
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

async function main() {
  const profileName = (parseArg("profile", "5090") ?? "5090") as GpuProfileName;
  const profile = GPU_PROFILES[profileName];
  if (!profile) {
    throw new Error(`unsupported profile: ${profileName}`);
  }

  const sourceAudioPath = path.resolve(
    parseArg("source-audio", "C:/Users/lukew/Desktop/01-30 面談_ 受験戦略とルール運用（時間配分・見直し・難問後回し.mp3")!
  );
  const outputPath = path.resolve(parseArg("out", `.tmp/runpod-ux-${profileName}.json`)!);
  const clipStartSeconds = readNumberArg("clip-start", 30);
  const clipDurationSeconds = readNumberArg("clip-duration", 0);
  const timeoutMs = readNumberArg("timeout-ms", 45 * 60 * 1000);
  const pollMs = readNumberArg("poll-ms", 5000);
  const autoStopIdleMs = readNumberArg("auto-stop-idle-ms", 5 * 60 * 1000);
  const createRetries = readNumberArg("create-retries", 2);
  const createRetryWaitMs = readNumberArg("create-retry-wait-ms", 30000);
  const interruptible = readBoolArg("interruptible", false);
  const startupMode = (parseArg("startup-mode", "direct") ?? "direct") as StartupMode;
  const gitRef = parseArg("git-ref", "main")!;
  const fallbackEnvFile = path.resolve(parseArg("fallback-env-file", ".tmp/.env.production.runpod")!);
  const outputDir = path.resolve(parseArg("out-dir", ".tmp/runpod-ux")!);
  const workerImage = parseArg("image", process.env.RUNPOD_WORKER_IMAGE?.trim() || "ghcr.io/mirr-luke/pararia-runpod-worker:latest");
  const workerName = parseArg("worker-name", `pararia-ux-${profileName}-reuse`) ?? `pararia-ux-${profileName}-reuse`;
  const prepareFresh = readBoolArg("prepare-fresh", true);
  const containerRegistryAuthId = parseArg(
    "registry-auth-id",
    process.env.RUNPOD_WORKER_CONTAINER_REGISTRY_AUTH_ID?.trim() || ""
  );

  if (!existsSync(sourceAudioPath)) {
    throw new Error(`source audio not found: ${sourceAudioPath}`);
  }

  await mkdir(outputDir, { recursive: true });
  await loadLocalEnvFiles();
  await loadEnvFile(fallbackEnvFile, { overrideExisting: false, optional: true });

  process.env.PARARIA_BACKGROUND_MODE = "external";
  process.env.PARARIA_AUDIO_STORAGE_MODE = "blob";
  process.env.PARARIA_AUDIO_BLOB_ACCESS = "private";
  process.env.NEXT_PUBLIC_AUDIO_STORAGE_MODE = "blob";

  must(process.env.DATABASE_URL, "DATABASE_URL is required.");
  must(process.env.DIRECT_URL, "DIRECT_URL is required.");
  must(process.env.BLOB_READ_WRITE_TOKEN, "BLOB_READ_WRITE_TOKEN is required.");
  must(process.env.OPENAI_API_KEY, "OPENAI_API_KEY is required.");
  must(process.env.RUNPOD_API_KEY, "RUNPOD_API_KEY is required.");

  const result: RunpodMeasureResult = {
    ok: false,
    profile: profile.name,
    gpu: profile.gpu,
    startupMode,
    workerImage: startupMode === "direct" ? workerImage : null,
    workerName: startupMode === "reuse" ? workerName : null,
    interruptible,
    sourceAudioPath,
    audioDurationSeconds: null,
    enqueueStartedAt: new Date().toISOString(),
  };

  let clipAudioPath: string | null = null;
  let uploadedStorageUrl: string | null = null;
  let createdStudentId: string | null = null;
  let createdSessionId: string | null = null;
  let createdPartId: string | null = null;
  let createdConversationId: string | null = null;
  let podId: string | null = null;
  let keepStoppedPod = false;

  try {
    const [
      { prisma },
      { SessionPartStatus, SessionPartType, SessionStatus, SessionType, ConversationSourceType, JobStatus, ConversationStatus },
      { saveSessionPartUpload },
      { enqueueSessionPartJob },
      { updateSessionStatusFromParts },
      { toSessionPartMetaJson, readSessionPartMeta },
      { getAudioDurationSeconds },
      { getAudioExpiryDate },
    ] = await Promise.all([
      import("../lib/db"),
      import("@prisma/client"),
      import("../lib/session-part-storage"),
      import("../lib/jobs/sessionPartJobs"),
      import("../lib/session-service"),
      import("../lib/session-part-meta"),
      import("../lib/audio-processing"),
      import("../lib/system-config"),
    ]);

    if (startupMode === "reuse") {
      if (prepareFresh) {
        await terminatePodsByName(workerName);
      }
      const prepared = await createDirectWorkerPod({
        profile,
        sessionId: "__prepare__",
        autoStopIdleMs,
        name: workerName,
        interruptible,
        createRetries,
        createRetryWaitMs,
        image: must(workerImage, "worker image is required for reuse startup."),
        containerRegistryAuthId: containerRegistryAuthId || null,
      });
      result.reusePreparedPodId = prepared.podId;
      result.reusePreparedAt = prepared.requestedAt.toISOString();
      await waitForWorkerReady(prepared.podId, timeoutMs, pollMs);
      await stopRunpodPod(prepared.podId);
      podId = prepared.podId;
      keepStoppedPod = true;
    }

    let measureAudioPath = sourceAudioPath;
    if (clipDurationSeconds > 0) {
      clipAudioPath = path.join(outputDir, `runpod-ux-${profileName}-${Date.now()}-${randomUUID()}.m4a`);
      await createAudioClip(sourceAudioPath, clipAudioPath, clipStartSeconds, clipDurationSeconds);
      measureAudioPath = clipAudioPath;
      result.clipAudioPath = clipAudioPath;
      result.clipStartSeconds = clipStartSeconds;
      result.clipDurationSeconds = clipDurationSeconds;
    }

    result.audioDurationSeconds = await getAudioDurationSeconds(measureAudioPath).catch(() => null);

    const organization = await prisma.organization.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!organization) throw new Error("organization not found in target database.");

    const user = await prisma.user.findFirst({
      where: { organizationId: organization.id },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (!user) throw new Error("user not found in target database.");

    const enqueueStartedAt = new Date();
    result.enqueueStartedAt = enqueueStartedAt.toISOString();

    const student = await prisma.student.create({
      data: {
        organizationId: organization.id,
        name: `[Runpod UX ${profile.name}] ${enqueueStartedAt.toISOString().slice(11, 19)}`,
        grade: "計測用",
        course: `runpod-ux-${profile.name}`,
      },
      select: { id: true },
    });
    createdStudentId = student.id;

    const session = await prisma.session.create({
      data: {
        organizationId: organization.id,
        studentId: student.id,
        userId: user.id,
        type: SessionType.INTERVIEW,
        status: SessionStatus.COLLECTING,
        title: `Runpod UX ${profile.name}`,
        sessionDate: enqueueStartedAt,
      },
      select: { id: true },
    });
    createdSessionId = session.id;
    result.sessionId = session.id;

    const podPromise =
      startupMode === "reuse"
        ? (async () => {
            const preparedPodId = must(podId, "prepared pod id is required for reuse startup.");
            await patchRunpodPodWorkerConfig({
              podId: preparedPodId,
              sessionId: session.id,
              autoStopIdleMs,
              profile,
            });
            const requestedAt = new Date();
            await startRunpodPod(preparedPodId);
            return {
              podId: preparedPodId,
              requestedAt,
              attempt: 0,
            };
          })()
        : startupMode === "direct"
        ? createDirectWorkerPod({
            profile,
            sessionId: session.id,
            autoStopIdleMs,
            name: `pararia-ux-${profile.name}-${Date.now()}`,
            interruptible,
            createRetries,
            createRetryWaitMs,
            image: must(workerImage, "worker image is required for direct startup."),
            containerRegistryAuthId: containerRegistryAuthId || null,
          })
        : createBootstrapWorkerPod({
            profile,
            gitRef,
            sessionId: session.id,
            autoStopIdleMs,
            name: `pararia-ux-${profile.name}-${Date.now()}`,
            interruptible,
            createRetries,
            createRetryWaitMs,
          });

    const audioBuffer = await readFile(measureAudioPath);
    const stored = await saveSessionPartUpload({
      sessionId: session.id,
      partType: SessionPartType.FULL,
      fileName: path.basename(measureAudioPath),
      buffer: audioBuffer,
      contentType: clipDurationSeconds > 0 ? "audio/mp4" : "audio/mpeg",
    });
    uploadedStorageUrl = stored.storageUrl;

    const part = await prisma.sessionPart.create({
      data: {
        sessionId: session.id,
        partType: SessionPartType.FULL,
        sourceType: ConversationSourceType.AUDIO,
        status: SessionPartStatus.TRANSCRIBING,
        fileName: path.basename(measureAudioPath),
        mimeType: clipDurationSeconds > 0 ? "audio/mp4" : "audio/mpeg",
        byteSize: stored.byteSize,
        storageUrl: stored.storageUrl,
        rawTextOriginal: "",
        rawTextCleaned: "",
        reviewedText: null,
        reviewState: "NONE",
        rawSegments: [],
        qualityMetaJson: toSessionPartMetaJson(
          {},
          {
            pipelineStage: "TRANSCRIBING",
            uploadMode: "file_upload",
            captureSource: "file_upload",
            lastAcceptedAt: enqueueStartedAt.toISOString(),
            lastQueuedAt: enqueueStartedAt.toISOString(),
            uploadedFileName: path.basename(measureAudioPath),
            uploadedMimeType: clipDurationSeconds > 0 ? "audio/mp4" : "audio/mpeg",
            uploadedBytes: stored.byteSize,
            audioDurationSeconds: result.audioDurationSeconds,
            transcriptionPhase: "PREPARING_STT",
            transcriptionPhaseUpdatedAt: enqueueStartedAt.toISOString(),
            sttEngine: "faster-whisper",
          }
        ),
        transcriptExpiresAt: getAudioExpiryDate(),
      },
      select: { id: true },
    });
    createdPartId = part.id;
    result.partId = part.id;

    await updateSessionStatusFromParts(session.id);
    await enqueueSessionPartJob(part.id, "TRANSCRIBE_FILE");

    const pod = await podPromise;
    podId = pod.podId;
    result.podId = podId;
    result.createAttempts = pod.attempt;

    const readiness = await waitForWorkerReady(podId, timeoutMs, pollMs, pod.requestedAt.getTime());
    result.podReadyAt = readiness.checkedAt.toISOString();
    result.podReadyMs = readiness.checkedAt.getTime() - pod.requestedAt.getTime();

    const timeoutAt = Date.now() + timeoutMs;
    while (Date.now() < timeoutAt) {
      const currentSession = await prisma.session.findUnique({
        where: { id: session.id },
        include: {
          parts: {
            include: {
              jobs: true,
            },
          },
          conversation: {
            include: {
              jobs: true,
            },
          },
        },
      });

      if (!currentSession) {
        throw new Error("session disappeared during polling.");
      }

      const currentPart = currentSession.parts.find((item: any) => item.partType === SessionPartType.FULL) ?? null;
      const partMeta = readSessionPartMeta(currentPart?.qualityMetaJson);
      const currentConversation = currentSession.conversation;
      const finalizeJob = currentConversation?.jobs.find((job: any) => job.type === "FINALIZE") ?? null;

      result.conversationId = currentConversation?.id ?? null;
      createdConversationId = currentConversation?.id ?? null;

      if (currentPart?.status === "ERROR") {
        throw new Error(`session part failed: ${String(partMeta.lastError ?? "unknown error")}`);
      }
      if (currentConversation?.status === ConversationStatus.ERROR) {
        throw new Error(
          `conversation finalize failed: ${String(finalizeJob?.lastError ?? currentConversation?.qualityMetaJson ?? "unknown error")}`
        );
      }

      if (!result.sttCompletedAt && currentPart?.status === SessionPartStatus.READY) {
        const completedAt = typeof partMeta.lastCompletedAt === "string" ? new Date(partMeta.lastCompletedAt) : new Date();
        result.sttCompletedAt = completedAt.toISOString();
        result.queueToSttMs = completedAt.getTime() - enqueueStartedAt.getTime();
        result.sttSeconds = typeof partMeta.sttSeconds === "number" ? partMeta.sttSeconds : null;
        result.sttModel = typeof partMeta.sttModel === "string" ? partMeta.sttModel : null;
        result.sttDevice = typeof partMeta.sttDevice === "string" ? partMeta.sttDevice : null;
        result.sttComputeType = typeof partMeta.sttComputeType === "string" ? partMeta.sttComputeType : null;
        result.sttPipeline = typeof partMeta.sttPipeline === "string" ? partMeta.sttPipeline : null;
        result.sttBatchSize = typeof partMeta.sttBatchSize === "number" ? partMeta.sttBatchSize : null;
        result.transcriptChars = currentPart.rawTextOriginal?.length ?? null;
      }

      if (currentConversation?.status === ConversationStatus.DONE && finalizeJob?.status === JobStatus.DONE) {
        const completedAt = finalizeJob.completedAt ?? finalizeJob.finishedAt ?? new Date();
        const qualityMeta =
          currentConversation.qualityMetaJson && typeof currentConversation.qualityMetaJson === "object" && !Array.isArray(currentConversation.qualityMetaJson)
            ? (currentConversation.qualityMetaJson as Record<string, unknown>)
            : {};

        result.conversationCompletedAt = completedAt.toISOString();
        result.queueToConversationMs = completedAt.getTime() - enqueueStartedAt.getTime();
        result.finalizeDurationMs = typeof finalizeJob.lastRunDurationMs === "number" ? finalizeJob.lastRunDurationMs : null;
        result.finalizeQueueLagMs = typeof finalizeJob.lastQueueLagMs === "number" ? finalizeJob.lastQueueLagMs : null;
        result.llmCostUsd = typeof qualityMeta.llmCostUsd === "number" ? qualityMeta.llmCostUsd : null;
        result.finalizeModel = typeof qualityMeta.modelFinalize === "string" ? qualityMeta.modelFinalize : null;
        result.artifactChars = currentConversation.summaryMarkdown?.length ?? null;
        result.ok = true;
        break;
      }

      await sleep(pollMs);
    }

    if (!result.ok) {
      throw new Error("timed out waiting for Runpod UX completion.");
    }
  } catch (error: any) {
    result.error = error?.message ?? String(error);
    process.exitCode = 1;
  } finally {
    await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
    if (keepStoppedPod && podId) {
      await stopRunpodPod(podId).catch(() => {});
    } else {
      await deleteRunpodPod(podId);
    }
    await cleanupBenchmarkRecords({
      sessionId: createdSessionId,
      studentId: createdStudentId,
      partId: createdPartId,
      conversationId: createdConversationId,
      storageUrl: uploadedStorageUrl,
    });
    if (clipAudioPath) {
      await rm(clipAudioPath, { force: true }).catch(() => {});
    }
    console.log(JSON.stringify(result, null, 2));
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
