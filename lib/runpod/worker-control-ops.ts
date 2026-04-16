import { prisma } from "@/lib/db";

import {
  buildRunpodWorkerCreateBody,
  getRunpodPodsByName,
  getManagedRunpodPods,
  getRunpodGpuCandidates,
  getRunpodWorkerConfig,
  isActivePod,
  isRunpodCapacityErrorMessage,
  isStoppedPod,
  isTerminatedPod,
  readPodStatus,
  runpodRequest,
  sleep,
  type RunpodPod,
  type RunpodWorkerConfig,
  type RunpodWorkerEnsureResult,
  type RunpodWorkerStopResult,
  type RunpodWorkerTerminateResult,
  type RunpodWorkerWakeResult,
} from "./worker-control-core";

const pendingManagedWorkerWakeByName = new Map<string, Promise<RunpodWorkerWakeResult>>();

export function requireRunpodWorkerConfig() {
  const config = getRunpodWorkerConfig();
  if (!config) {
    throw new Error("RUNPOD_API_KEY が必要です。");
  }
  return config;
}

async function withRunpodWakeLock<T>(config: RunpodWorkerConfig, callback: () => Promise<T>) {
  const lockKey = `pararia-runpod-worker-wake:${config.name}`;
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      return callback();
    },
    {
      maxWait: config.apiTimeoutMs,
      timeout: config.apiTimeoutMs * 2,
    }
  );
}

async function applyRunpodWorkerRuntimeConfig(podId: string, config: RunpodWorkerConfig) {
  const updated = await runpodRequest(`/pods/${podId}`, config, {
    method: "PATCH",
    body: JSON.stringify({
      dockerStartCmd: ["bash", "/workspace/scripts/runpod-worker-start.sh"],
      env: buildRunpodWorkerCreateBody(config, undefined, { includeRuntimeConfig: true }).env,
    }),
  });
  return updated as RunpodPod;
}

function shouldRecycleStoppedPod(pod: RunpodPod, config: RunpodWorkerConfig) {
  const desiredRevision = buildRunpodWorkerCreateBody(config, undefined, { includeRuntimeConfig: true }).env?.RUNPOD_WORKER_RUNTIME_REVISION?.trim() ?? "";
  const currentRevision = pod.env?.RUNPOD_WORKER_RUNTIME_REVISION?.trim() ?? "";
  const currentImage = (pod.imageName || pod.image || "").trim();
  const desiredImage = config.image.trim();

  if (currentImage && currentImage !== desiredImage) {
    return true;
  }

  if (desiredRevision && currentRevision !== desiredRevision) {
    return true;
  }

  return false;
}

function buildCreateBody(
  config: RunpodWorkerConfig,
  overrides?: Partial<Omit<RunpodWorkerConfig, "apiKey" | "apiTimeoutMs" | "autoStopIdleMs">>,
  options?: {
    includeRuntimeConfig?: boolean;
  }
) {
  return buildRunpodWorkerCreateBody(config, overrides, options);
}

async function terminateRunpodPod(podId: string, config: RunpodWorkerConfig) {
  await runpodRequest(`/pods/${podId}`, config, { method: "DELETE" });
}

export async function createRunpodWorkerPod(
  overrides?: Partial<Omit<RunpodWorkerConfig, "apiKey" | "apiTimeoutMs" | "autoStopIdleMs">>,
  config?: RunpodWorkerConfig
) {
  const resolved = config ?? requireRunpodWorkerConfig();
  const createAttempts = Number(process.env.RUNPOD_CREATE_RETRY_ATTEMPTS ?? 6);
  const createDelayMs = Number(process.env.RUNPOD_CREATE_RETRY_DELAY_MS ?? 5_000);
  const capacityErrors: string[] = [];
  const gpuCandidates = getRunpodGpuCandidates(resolved, overrides);

  for (const gpu of gpuCandidates) {
    let payload: unknown;
    let lastError: unknown;

    for (let attempt = 1; attempt <= createAttempts; attempt += 1) {
      try {
        payload = await runpodRequest("/pods", resolved, {
          method: "POST",
          // Work around Runpod custom-image create failures when env is included in the initial POST.
          body: JSON.stringify(buildCreateBody(resolved, { ...overrides, gpu }, { includeRuntimeConfig: false })),
        });
        lastError = null;
        break;
      } catch (error: any) {
        lastError = error;
        const message = String(error?.message ?? error);
        const shouldRetry = attempt < createAttempts && isRunpodCapacityErrorMessage(message);
        if (!shouldRetry) {
          if (!isRunpodCapacityErrorMessage(message)) {
            throw error;
          }
          break;
        }
        await sleep(createDelayMs);
      }
    }

    if (!payload) {
      capacityErrors.push(`${gpu}: ${String((lastError as Error | undefined)?.message ?? lastError ?? "capacity unavailable")}`);
      continue;
    }

    const created = payload as RunpodPod;
    if (!created.id) {
      return created;
    }

    try {
      return await applyRunpodWorkerRuntimeConfig(created.id, resolved);
    } catch (error) {
      await terminateRunpodPod(created.id, resolved).catch(() => {});
      throw error;
    }
  }

  throw new Error(
    `Runpod worker creation failed for all GPU candidates (${gpuCandidates.join(" -> ")}): ${capacityErrors.join(" | ")}`
  );
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
  const preferSameNamePod = resolved.image.trim().toLowerCase().endsWith(":latest");
  const existingPods = await getManagedRunpodPods(resolved);
  if (fresh && existingPods.length > 0) {
    for (const pod of existingPods) {
      await terminateRunpodPod(pod.id, resolved);
      terminatedPodIds.push(pod.id);
    }
  }
  if (fresh) {
    const created = await createRunpodWorkerPod(undefined, resolved);
    return { action: "created_new", pod: created as RunpodPod, terminatedPodIds };
  }

  if (preferSameNamePod && existingPods.length === 0) {
    const namedPods = await getRunpodPodsByName(resolved);
    const activeNamedPod = namedPods.find((pod) => isActivePod(pod));
    if (activeNamedPod) {
      return { action: "already_running", pod: activeNamedPod, terminatedPodIds };
    }

    const stoppedNamedPod = namedPods.find((pod) => isStoppedPod(pod));
    if (stoppedNamedPod) {
      const refreshed = await applyRunpodWorkerRuntimeConfig(stoppedNamedPod.id, resolved);
      try {
        await runpodRequest(`/pods/${stoppedNamedPod.id}/start`, resolved, { method: "POST" });
      } catch (error: any) {
        const message = String(error?.message ?? error);
        if (!isRunpodCapacityErrorMessage(message)) {
          throw error;
        }
        await terminateRunpodPod(stoppedNamedPod.id, resolved).catch(() => {});
        terminatedPodIds.push(stoppedNamedPod.id);
        const created = await createRunpodWorkerPod(undefined, resolved);
        return {
          action: "created_new",
          pod: created as RunpodPod,
          terminatedPodIds,
        };
      }
      return {
        action: "started_existing",
        pod: {
          ...refreshed,
          desiredStatus: "RUNNING",
        },
        terminatedPodIds,
      };
    }
  }

  const running = existingPods.find((pod) => isActivePod(pod));
  if (running) {
    return { action: "already_running", pod: running };
  }

  const stopped = existingPods.find((pod) => isStoppedPod(pod));
  if (stopped) {
    if (shouldRecycleStoppedPod(stopped, resolved)) {
      await terminateRunpodPod(stopped.id, resolved);
      terminatedPodIds.push(stopped.id);
      const created = await createRunpodWorkerPod(undefined, resolved);
      return { action: "created_new", pod: created as RunpodPod, terminatedPodIds };
    }

    const refreshed = await applyRunpodWorkerRuntimeConfig(stopped.id, resolved);
    try {
      await runpodRequest(`/pods/${stopped.id}/start`, resolved, { method: "POST" });
    } catch (error: any) {
      const message = String(error?.message ?? error);
      if (!isRunpodCapacityErrorMessage(message)) {
        throw error;
      }

      await terminateRunpodPod(stopped.id, resolved).catch(() => {});
      terminatedPodIds.push(stopped.id);
      const created = await createRunpodWorkerPod(undefined, resolved);
      return {
        action: "created_new",
        pod: created as RunpodPod,
        terminatedPodIds,
      };
    }
    return {
      action: "started_existing",
      pod: {
        ...refreshed,
        desiredStatus: "RUNNING",
      },
      terminatedPodIds,
    };
  }

  const created = await createRunpodWorkerPod(undefined, resolved);
  return { action: "created_new", pod: created as RunpodPod };
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

  const existing = pendingManagedWorkerWakeByName.get(config.name);
  if (existing) {
    return existing;
  }

  const wakePromise = (async () => {
    try {
      const ensured = await withRunpodWakeLock(config, () => ensureRunpodWorker(config));
      return {
        attempted: true,
        ok: true,
        action: ensured.action,
        podId: ensured.pod.id,
        desiredStatus: readPodStatus(ensured.pod),
        name: config.name,
      } satisfies RunpodWorkerWakeResult;
    } catch (error: any) {
      return {
        attempted: true,
        ok: false,
        error: error?.message ?? String(error),
        name: config.name,
      } satisfies RunpodWorkerWakeResult;
    } finally {
      pendingManagedWorkerWakeByName.delete(config.name);
    }
  })();

  pendingManagedWorkerWakeByName.set(config.name, wakePromise);
  return wakePromise;
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
    const pods = await getRunpodPodsByName(resolved);
    const activePods = pods.filter((pod) => isActivePod(pod));
    const alreadyStoppedPods = pods.filter((pod) => isStoppedPod(pod) || isTerminatedPod(pod));

    for (const pod of activePods) {
      await runpodRequest(`/pods/${pod.id}/stop`, resolved, { method: "POST" });
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
  const podId = process.env.RUNPOD_POD_ID?.trim();
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
    await runpodRequest(`/pods/${podId}/stop`, config, { method: "POST" });
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
