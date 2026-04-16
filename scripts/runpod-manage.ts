#!/usr/bin/env tsx

import { readStorageText } from "../lib/audio-storage";
import {
  ensureRunpodWorker,
  getRunpodPodsByName,
  getRunpodPodById,
  getRunpodWorkerConfig,
  type RunpodWorkerConfig,
  stopManagedRunpodWorker,
  terminateManagedRunpodWorker,
} from "../lib/runpod/worker-control";
import { loadLocalEnvFiles } from "./lib/load-local-env";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readArg(name: string) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (raw) return raw.slice(prefix.length);
  return null;
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function readNumberArg(name: string, fallback: number, min = 0) {
  const raw = readArg(name);
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function readBoolArg(name: string, fallback: boolean) {
  const raw = readArg(name);
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

function isSensitiveKey(key: string) {
  return (
    key === "DATABASE_URL" ||
    key === "DIRECT_URL" ||
    /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD)(?:$|_)/i.test(key)
  );
}

function sanitizeForOutput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForOutput(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
    if (key === "env" && entryValue && typeof entryValue === "object" && !Array.isArray(entryValue)) {
      const sanitizedEnv = Object.fromEntries(
        Object.keys(entryValue as Record<string, unknown>)
          .sort()
          .map((envKey) => [envKey, "[redacted]"])
      );
      return [key, sanitizedEnv];
    }

    if (isSensitiveKey(key)) {
      return [key, "[redacted]"];
    }

    return [key, sanitizeForOutput(entryValue)];
  });

  return Object.fromEntries(entries);
}

function printJson(value: unknown) {
  console.log(JSON.stringify(sanitizeForOutput(value), null, 2));
}

function applyConfigOverrides(config: RunpodWorkerConfig): RunpodWorkerConfig {
  return {
    ...config,
    name: readArg("name") ?? config.name,
    image: readArg("image") ?? config.image,
    containerRegistryAuthId: readArg("registry-auth-id") ?? config.containerRegistryAuthId ?? null,
    gpu: readArg("gpu") ?? config.gpu,
    secureCloud: readBoolArg("secure-cloud", config.secureCloud),
    containerDiskInGb: readNumberArg("container-disk", config.containerDiskInGb, 0),
    volumeInGb: readNumberArg("volume", config.volumeInGb, 0),
    gpuCount: readNumberArg("gpu-count", config.gpuCount, 1),
    autoStopIdleMs: readNumberArg("auto-stop-idle-ms", config.autoStopIdleMs, 0),
  };
}

function getWorkerHeartbeatPath(podId: string, fileName: string) {
  return `runpod-worker/heartbeats/${podId}/${fileName}`;
}

async function tryReadStorageJson(storagePathname: string) {
  try {
    return JSON.parse(await readStorageText(storagePathname));
  } catch {
    return null;
  }
}

async function waitForPodRunning(podId: string, timeoutMs: number, pollMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const pod = await getRunpodPodById(podId);
    const status = pod.desiredStatus?.trim().toUpperCase() || null;
    if (status === "RUNNING") {
      return {
        ok: true,
        pod,
      };
    }
    await sleep(pollMs);
  }
  return {
    ok: false,
    error: `timeout waiting for pod ${podId} to reach RUNNING`,
  };
}

async function waitForWorkerReady(podId: string, timeoutMs: number, pollMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const pod = await getRunpodPodById(podId);
    const status = pod.desiredStatus?.trim().toUpperCase() || null;
    const dbOk = await tryReadStorageJson(getWorkerHeartbeatPath(podId, "db-ok.json"));
    if (dbOk) {
      return {
        ok: true,
        pod,
        readiness: dbOk,
      };
    }

    const dbError = await tryReadStorageJson(getWorkerHeartbeatPath(podId, "db-error.json"));
    if (dbError) {
      return {
        ok: false,
        pod,
        error: `worker reported startup db error: ${String(dbError.error ?? "unknown error")}`,
        readiness: dbError,
      };
    }

    const startup = await tryReadStorageJson(getWorkerHeartbeatPath(podId, "startup.json"));
    if (status === "EXITED" || status === "STOPPED" || status === "TERMINATED") {
      return {
        ok: false,
        pod,
        error: `pod ${podId} left RUNNING before readiness heartbeat (${status})`,
        readiness: startup,
      };
    }

    await sleep(pollMs);
  }

  const pod = await getRunpodPodById(podId);
  return {
    ok: false,
    pod,
    error: `timeout waiting for worker ${podId} readiness heartbeat`,
    readiness: await tryReadStorageJson(getWorkerHeartbeatPath(podId, "startup.json")),
  };
}

async function main() {
  await loadLocalEnvFiles();
  const config = getRunpodWorkerConfig();
  if (!config) {
    throw new Error("RUNPOD_API_KEY が必要です。");
  }
  const resolvedConfig = applyConfigOverrides(config);

  const command = (process.argv[2] || "status").trim();

  if (command === "status") {
    const pods = await getRunpodPodsByName(resolvedConfig);
    printJson({
      workerName: resolvedConfig.name,
      image: resolvedConfig.image,
      gpu: resolvedConfig.gpu,
      autoStopIdleMs: resolvedConfig.autoStopIdleMs,
      pods,
    });
    return;
  }

  if (command === "start") {
    const ensured = await ensureRunpodWorker(resolvedConfig, { fresh: hasFlag("fresh") });
    const wait = hasFlag("wait");
    const timeoutMs = Number(readArg("timeout-ms") ?? 8 * 60 * 1000);
    const pollMs = Number(readArg("poll-ms") ?? 5_000);
    if (!wait || !ensured.pod.id) {
      printJson(ensured);
      return;
    }

    const waited = await waitForPodRunning(ensured.pod.id, timeoutMs, pollMs);
    if (!waited.ok) {
      printJson({
        ...ensured,
        waited,
      });
      return;
    }

    const readiness = await waitForWorkerReady(ensured.pod.id, timeoutMs, pollMs);
    printJson({
      ...ensured,
      waited,
      readiness,
    });
    return;
  }

  if (command === "stop") {
    const stopped = await stopManagedRunpodWorker(resolvedConfig);
    printJson(stopped);
    return;
  }

  if (command === "terminate") {
    const terminated = await terminateManagedRunpodWorker(resolvedConfig);
    printJson(terminated);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error("[runpod-manage] fatal", error);
  process.exit(1);
});
