import { acquireRunpodWorkerWakeLease, releaseRunpodWorkerWakeLease } from "./wake-lease";

import {
  buildRunpodWorkerCreateBody,
  getRunpodPodsByName,
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
const RUNPOD_INITIAL_BOOTSTRAP_START_COMMAND = [
  "bash",
  "-lc",
  "mkdir -p /tmp/runpod-bootstrap && printf 'waiting_runtime_config\\n' >/tmp/runpod-bootstrap/status.txt && printf '{\"stage\":\"waiting_runtime_config\"}\\n' >/tmp/runpod-bootstrap/status.json && exec python3 -m http.server 8888 --bind 0.0.0.0 --directory /tmp/runpod-bootstrap",
] as const;

export function requireRunpodWorkerConfig() {
  const config = getRunpodWorkerConfig();
  if (!config) {
    throw new Error("RUNPOD_API_KEY が必要です。");
  }
  return config;
}

async function applyRunpodWorkerRuntimeConfig(podId: string, config: RunpodWorkerConfig) {
  const runtimeConfig = buildRunpodWorkerCreateBody(config, undefined, { includeRuntimeConfig: true });
  const updated = await runpodRequest(`/pods/${podId}`, config, {
    method: "PATCH",
    body: JSON.stringify({
      dockerStartCmd: runtimeConfig.dockerStartCmd,
      env: runtimeConfig.env,
    }),
  });
  return updated as RunpodPod;
}

function shouldRecycleStoppedPod(pod: RunpodPod, config: RunpodWorkerConfig) {
  const desiredRevision = buildRunpodWorkerCreateBody(config, undefined, { includeRuntimeConfig: true }).env?.RUNPOD_WORKER_RUNTIME_REVISION?.trim() ?? "";
  const currentRevision = pod.env?.RUNPOD_WORKER_RUNTIME_REVISION?.trim() ?? "";
  const currentImage = (pod.imageName || pod.image || "").trim();
  const desiredImage = config.image.trim();
  const desiredImageIsMutable = desiredImage.toLowerCase().endsWith(":latest");

  if (!desiredImageIsMutable && currentImage && currentImage !== desiredImage) {
    return true;
  }

  if (desiredRevision && currentRevision !== desiredRevision) {
    return true;
  }

  return false;
}

async function terminateRunpodPods(
  pods: RunpodPod[],
  config: RunpodWorkerConfig,
  terminatedPodIds: string[]
) {
  for (const pod of pods) {
    if (!pod.id || terminatedPodIds.includes(pod.id)) continue;
    await terminateRunpodPod(pod.id, config);
    terminatedPodIds.push(pod.id);
  }
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
        const createBody = buildCreateBody(resolved, { ...overrides, gpu }, { includeRuntimeConfig: false });
        payload = await runpodRequest("/pods", resolved, {
          method: "POST",
          // Work around Runpod custom-image create failures when env is included in the initial POST.
          // Keep the container alive with a harmless bootstrap HTTP server until runtime env is patched in.
          body: JSON.stringify({
            ...createBody,
            dockerStartCmd: [...RUNPOD_INITIAL_BOOTSTRAP_START_COMMAND],
          }),
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
    const pods = await getRunpodPodsByName(resolved);
    await terminateRunpodPods(pods, resolved, []);
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
  const namedPods = await getRunpodPodsByName(resolved);
  if (fresh && namedPods.length > 0) {
    await terminateRunpodPods(namedPods, resolved, terminatedPodIds);
  }
  if (fresh) {
    const created = await createRunpodWorkerPod(undefined, resolved);
    return { action: "created_new", pod: created as RunpodPod, terminatedPodIds };
  }

  const reusablePods = namedPods.filter((pod) => !shouldRecycleStoppedPod(pod, resolved));
  const stalePods = namedPods.filter((pod) => shouldRecycleStoppedPod(pod, resolved));

  const activeReusablePod = reusablePods.find((pod) => isActivePod(pod));
  if (activeReusablePod) {
    return { action: "already_running", pod: activeReusablePod, terminatedPodIds };
  }

  const activeStalePods = stalePods.filter((pod) => isActivePod(pod));
  if (activeStalePods.length > 0) {
    await terminateRunpodPods(activeStalePods, resolved, terminatedPodIds);
  }

  const stoppedReusablePod = reusablePods.find((pod) => isStoppedPod(pod));
  if (stoppedReusablePod) {
    const stoppedStalePods = stalePods.filter((pod) => isStoppedPod(pod));
    if (stoppedStalePods.length > 0) {
      await terminateRunpodPods(stoppedStalePods, resolved, terminatedPodIds);
    }

    const refreshed = await applyRunpodWorkerRuntimeConfig(stoppedReusablePod.id, resolved);
    try {
      await runpodRequest(`/pods/${stoppedReusablePod.id}/start`, resolved, { method: "POST" });
    } catch (error: any) {
      const message = String(error?.message ?? error);
      if (!isRunpodCapacityErrorMessage(message)) {
        throw error;
      }

      await terminateRunpodPod(stoppedReusablePod.id, resolved).catch(() => {});
      terminatedPodIds.push(stoppedReusablePod.id);
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

  const stoppedStalePods = stalePods.filter((pod) => isStoppedPod(pod));
  if (stoppedStalePods.length > 0) {
    await terminateRunpodPods(stoppedStalePods, resolved, terminatedPodIds);
  }

  const created = await createRunpodWorkerPod(undefined, resolved);
  return { action: "created_new", pod: created as RunpodPod, terminatedPodIds };
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
    const lease = await acquireRunpodWorkerWakeLease(config.name, config.image);
    if (!lease.acquired) {
      return {
        attempted: false,
        ok: true,
        skipped: `Runpod worker wake is already in progress for ${config.name}.`,
        name: config.name,
      } satisfies RunpodWorkerWakeResult;
    }

    let ok = false;
    try {
      const ensured = await ensureRunpodWorker(config);
      ok = true;
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
      await releaseRunpodWorkerWakeLease(config.name, lease.ownerToken, ok).catch(() => {});
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
