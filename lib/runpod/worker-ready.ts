import { readStorageText } from "@/lib/audio-storage";
import { maybeEnsureRunpodWorker } from "@/lib/runpod/worker-control";
import { getRunpodPodById, getRunpodWorkerConfig, runpodRequest, sleep, type RunpodWorkerWakeResult } from "@/lib/runpod/worker-control-core";

type WorkerReadyStage = "db_ok" | "db_error" | "proxy_fatal" | "pod_exited" | "timeout" | "wake_failed";

export type RunpodWorkerReadyResult = {
  attempted: boolean;
  ok: boolean;
  podId: string | null;
  stage: WorkerReadyStage;
  wake: RunpodWorkerWakeResult;
  readiness: Record<string, unknown> | null;
  error?: string;
  terminatedPodId?: string | null;
};

type WaitForRunpodWorkerReadyOptions = {
  timeoutMs?: number;
  pollMs?: number;
  terminateOnFailure?: boolean;
  wake?: RunpodWorkerWakeResult;
  proxyTimeoutMs?: number;
  deps?: {
    maybeEnsureRunpodWorker?: typeof maybeEnsureRunpodWorker;
    getRunpodPodById?: typeof getRunpodPodById;
    tryReadStorageJson?: typeof tryReadStorageJson;
    tryReadProxyHealth?: typeof tryReadProxyHealth;
    terminateRunpodPodById?: typeof terminateRunpodPodById;
    sleep?: typeof sleep;
  };
};

function getHeartbeatPath(podId: string, fileName: string) {
  return `runpod-worker/heartbeats/${podId}/${fileName}`;
}

function parseTimestampMs(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readFreshnessTimestampMs(
  value: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  if (!value) return 0;
  for (const key of keys) {
    const parsed = parseTimestampMs(value[key]);
    if (parsed > 0) return parsed;
  }
  return 0;
}

async function tryReadStorageJson(storagePathname: string) {
  try {
    return JSON.parse(await readStorageText(storagePathname)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function tryReadProxyHealth(podId: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://${podId}-8888.proxy.runpod.net/status.json`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function readPodFreshnessFloorMs(pod: { lastStartedAt?: string | null; createdAt?: string | null } | null | undefined) {
  return Math.max(parseTimestampMs(pod?.lastStartedAt ?? ""), parseTimestampMs(pod?.createdAt ?? ""));
}

async function terminateRunpodPodById(podId: string) {
  const config = getRunpodWorkerConfig();
  if (!config || !podId) return false;
  await runpodRequest(`/pods/${podId}`, config, { method: "DELETE" });
  return true;
}

export async function maybeEnsureRunpodWorkerReady(
  options: WaitForRunpodWorkerReadyOptions = {}
): Promise<RunpodWorkerReadyResult> {
  const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs ?? Number(process.env.RUNPOD_WORKER_READY_TIMEOUT_MS ?? 20_000)));
  const pollMs = Math.max(500, Math.floor(options.pollMs ?? Number(process.env.RUNPOD_WORKER_READY_POLL_MS ?? 2_000)));
  const proxyTimeoutMs = Math.max(500, Math.floor(options.proxyTimeoutMs ?? Number(process.env.RUNPOD_WORKER_READY_PROXY_TIMEOUT_MS ?? 3_000)));
  const deps = options.deps ?? {};
  const ensureWorker = deps.maybeEnsureRunpodWorker ?? maybeEnsureRunpodWorker;
  const loadPod = deps.getRunpodPodById ?? getRunpodPodById;
  const readStorageJson = deps.tryReadStorageJson ?? tryReadStorageJson;
  const readProxyHealth = deps.tryReadProxyHealth ?? tryReadProxyHealth;
  const terminatePod = deps.terminateRunpodPodById ?? terminateRunpodPodById;
  const sleepMs = deps.sleep ?? sleep;
  const wake = options.wake ?? (await ensureWorker());

  if (!wake.ok || !wake.podId) {
    return {
      attempted: wake.attempted,
      ok: false,
      podId: wake.podId ?? null,
      stage: "wake_failed",
      wake,
      readiness: null,
      error: wake.error ?? wake.skipped ?? "Runpod worker wake did not return a ready pod id.",
    };
  }

  const deadlineAtMs = Date.now() + timeoutMs;
  const initialPod = await loadPod(wake.podId).catch(() => null);
  const freshnessFloorMs = readPodFreshnessFloorMs(initialPod);

  while (Date.now() <= deadlineAtMs) {
    const [pod, dbOk, dbError, proxyHealth] = await Promise.all([
      loadPod(wake.podId).catch(() => null),
      readStorageJson(getHeartbeatPath(wake.podId, "db-ok.json")),
      readStorageJson(getHeartbeatPath(wake.podId, "db-error.json")),
      readProxyHealth(wake.podId, proxyTimeoutMs),
    ]);

    const dbOkCheckedAtMs = readFreshnessTimestampMs(dbOk, ["checkedAt", "updatedAt", "startedAt"]);
    if (dbOk && dbOkCheckedAtMs >= freshnessFloorMs) {
      return {
        attempted: true,
        ok: true,
        podId: wake.podId,
        stage: "db_ok",
        wake,
        readiness: dbOk,
      };
    }

    const dbErrorCheckedAtMs = readFreshnessTimestampMs(dbError, ["checkedAt", "updatedAt", "startedAt"]);
    if (dbError && dbErrorCheckedAtMs >= freshnessFloorMs) {
      const terminatedPodId =
        options.terminateOnFailure ? ((await terminatePod(wake.podId).catch(() => false)) ? wake.podId : null) : null;
      return {
        attempted: true,
        ok: false,
        podId: wake.podId,
        stage: "db_error",
        wake,
        readiness: dbError,
        error: String(dbError.error ?? "worker reported startup error"),
        terminatedPodId,
      };
    }

    const proxyStage = typeof proxyHealth?.stage === "string" ? proxyHealth.stage : null;
    const proxyUpdatedAtMs = readFreshnessTimestampMs(proxyHealth, ["updatedAt", "checkedAt"]);
    if (
      proxyHealth &&
      proxyUpdatedAtMs >= freshnessFloorMs &&
      (proxyStage === "worker_fatal" || proxyStage === "bootstrap_failed")
    ) {
      const terminatedPodId =
        options.terminateOnFailure ? ((await terminatePod(wake.podId).catch(() => false)) ? wake.podId : null) : null;
      return {
        attempted: true,
        ok: false,
        podId: wake.podId,
        stage: "proxy_fatal",
        wake,
        readiness: proxyHealth,
        error: `worker proxy reported fatal stage: ${proxyStage}`,
        terminatedPodId,
      };
    }

    const status = pod?.desiredStatus?.trim().toUpperCase() || null;
    if (status === "EXITED" || status === "STOPPED" || status === "TERMINATED") {
      return {
        attempted: true,
        ok: false,
        podId: wake.podId,
        stage: "pod_exited",
        wake,
        readiness: proxyHealth ?? dbError ?? dbOk,
        error: `pod ${wake.podId} left RUNNING before readiness heartbeat (${status})`,
      };
    }

    await sleepMs(pollMs);
  }

  const terminatedPodId =
    options.terminateOnFailure ? ((await terminatePod(wake.podId).catch(() => false)) ? wake.podId : null) : null;
  return {
    attempted: true,
    ok: false,
    podId: wake.podId,
    stage: "timeout",
    wake,
    readiness:
      (await readStorageJson(getHeartbeatPath(wake.podId, "startup.json"))) ??
      (await readProxyHealth(wake.podId, proxyTimeoutMs)),
    error: `worker ${wake.podId} did not become ready within ${timeoutMs}ms`,
    terminatedPodId,
  };
}
