#!/usr/bin/env tsx

const RUNPOD_API_BASE = "https://rest.runpod.io/v1";

type Args = {
  gpu: string;
  name: string;
  image: string;
  secureCloud: boolean;
  containerDiskInGb: number;
  volumeInGb: number;
  gpuCount: number;
};

function readArg(name: string, fallback?: string) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (raw) return raw.slice(prefix.length);
  return fallback;
}

function readIntArg(name: string, fallback: number) {
  const raw = Number(readArg(name, String(fallback)));
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : fallback;
}

function readBoolArg(name: string, fallback: boolean) {
  const raw = readArg(name);
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} が必要です。`);
  }
  return value;
}

function buildArgs(): Args {
  return {
    gpu: readArg("gpu", "NVIDIA GeForce RTX 4090")!,
    name: readArg("name", "pararia-gpu-worker")!,
    image: readArg("image", "ghcr.io/mirr-luke/pararia-runpod-worker:latest")!,
    secureCloud: readBoolArg("secure-cloud", false),
    containerDiskInGb: readIntArg("container-disk", 30),
    volumeInGb: readIntArg("volume", 0),
    gpuCount: readIntArg("gpu-count", 1),
  };
}

async function main() {
  const apiKey = requireEnv("RUNPOD_API_KEY");
  const args = buildArgs();

  const requiredWorkerEnvNames = [
    "DATABASE_URL",
    "DIRECT_URL",
    "BLOB_READ_WRITE_TOKEN",
    "OPENAI_API_KEY",
  ] as const;

  const workerEnv = {
    DATABASE_URL: requireEnv("DATABASE_URL"),
    DIRECT_URL: requireEnv("DIRECT_URL"),
    BLOB_READ_WRITE_TOKEN: requireEnv("BLOB_READ_WRITE_TOKEN"),
    OPENAI_API_KEY: requireEnv("OPENAI_API_KEY"),
    PARARIA_BACKGROUND_MODE: process.env.PARARIA_BACKGROUND_MODE?.trim() || "external",
    PARARIA_AUDIO_STORAGE_MODE: process.env.PARARIA_AUDIO_STORAGE_MODE?.trim() || "blob",
    PARARIA_AUDIO_BLOB_ACCESS: process.env.PARARIA_AUDIO_BLOB_ACCESS?.trim() || "private",
    FASTER_WHISPER_MODEL: process.env.FASTER_WHISPER_MODEL?.trim() || "large-v3",
    FASTER_WHISPER_REQUIRE_CUDA: process.env.FASTER_WHISPER_REQUIRE_CUDA?.trim() || "1",
    FASTER_WHISPER_DEVICE: process.env.FASTER_WHISPER_DEVICE?.trim() || "auto",
    FASTER_WHISPER_COMPUTE_TYPE: process.env.FASTER_WHISPER_COMPUTE_TYPE?.trim() || "auto",
    FASTER_WHISPER_BATCH_SIZE: process.env.FASTER_WHISPER_BATCH_SIZE?.trim() || "16",
    FASTER_WHISPER_CHUNKING_ENABLED: process.env.FASTER_WHISPER_CHUNKING_ENABLED?.trim() || "0",
    FASTER_WHISPER_POOL_SIZE: process.env.FASTER_WHISPER_POOL_SIZE?.trim() || "1",
  } satisfies Record<string, string>;

  for (const name of requiredWorkerEnvNames) {
    if (!workerEnv[name]) {
      throw new Error(`${name} が空です。`);
    }
  }

  const body = {
    name: args.name,
    imageName: args.image,
    gpuTypeIds: [args.gpu],
    gpuCount: args.gpuCount,
    containerDiskInGb: args.containerDiskInGb,
    volumeInGb: args.volumeInGb,
    cloudType: args.secureCloud ? "SECURE" : "COMMUNITY",
    env: workerEnv,
  };

  const response = await fetch(`${RUNPOD_API_BASE}/pods`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Runpod pod 作成に失敗しました: ${response.status} ${JSON.stringify(payload)}`);
  }

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error("[runpod-deploy] fatal", error);
  process.exit(1);
});
