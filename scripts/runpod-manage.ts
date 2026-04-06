#!/usr/bin/env tsx

import {
  ensureRunpodWorker,
  getManagedRunpodPods,
  getRunpodPodById,
  getRunpodWorkerConfig,
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

async function main() {
  await loadLocalEnvFiles();
  const config = getRunpodWorkerConfig();
  if (!config) {
    throw new Error("RUNPOD_API_KEY が必要です。");
  }

  const command = (process.argv[2] || "status").trim();

  if (command === "status") {
    const pods = await getManagedRunpodPods(config);
    console.log(
      JSON.stringify(
        {
          workerName: config.name,
          image: config.image,
          gpu: config.gpu,
          autoStopIdleMs: config.autoStopIdleMs,
          pods,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === "start") {
    const ensured = await ensureRunpodWorker(config, { fresh: hasFlag("fresh") });
    const wait = hasFlag("wait");
    const timeoutMs = Number(readArg("timeout-ms") ?? 8 * 60 * 1000);
    const pollMs = Number(readArg("poll-ms") ?? 5_000);
    if (!wait || !ensured.pod.id) {
      console.log(JSON.stringify(ensured, null, 2));
      return;
    }

    const waited = await waitForPodRunning(ensured.pod.id, timeoutMs, pollMs);
    console.log(
      JSON.stringify(
        {
          ...ensured,
          waited,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === "stop") {
    const stopped = await stopManagedRunpodWorker(config);
    console.log(JSON.stringify(stopped, null, 2));
    return;
  }

  if (command === "terminate") {
    const terminated = await terminateManagedRunpodWorker(config);
    console.log(JSON.stringify(terminated, null, 2));
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error("[runpod-manage] fatal", error);
  process.exit(1);
});
