#!/usr/bin/env tsx
import type { RunpodWorkerConfig } from "../lib/runpod/worker-control";
import { createRunpodWorkerPod, getRunpodWorkerConfig } from "../lib/runpod/worker-control";
import { loadLocalEnvFiles } from "./lib/load-local-env";

type Args = Partial<Omit<RunpodWorkerConfig, "apiKey" | "apiTimeoutMs" | "autoStopIdleMs">>;

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

function buildArgs(current: RunpodWorkerConfig): Args {
  return {
    gpu: readArg("gpu", current.gpu)!,
    name: readArg("name", current.name)!,
    image: readArg("image", current.image)!,
    secureCloud: readBoolArg("secure-cloud", current.secureCloud),
    containerDiskInGb: readIntArg("container-disk", current.containerDiskInGb),
    volumeInGb: readIntArg("volume", current.volumeInGb),
    gpuCount: readIntArg("gpu-count", current.gpuCount),
  };
}

async function main() {
  await loadLocalEnvFiles();
  const config = getRunpodWorkerConfig();
  if (!config) {
    throw new Error("RUNPOD_API_KEY が必要です。");
  }

  const created = await createRunpodWorkerPod(buildArgs(config), config);
  console.log(JSON.stringify(created, null, 2));
}

main().catch((error) => {
  console.error("[runpod-deploy] fatal", error);
  process.exit(1);
});
