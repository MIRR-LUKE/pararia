import assert from "node:assert/strict";
import { maybeEnsureRunpodWorkerReady } from "../lib/runpod/worker-ready";

const wake = {
  attempted: true,
  ok: true,
  podId: "pod-ready-smoke",
  desiredStatus: "RUNNING",
} as const;

async function main() {
  const ready = await maybeEnsureRunpodWorkerReady({
    wake,
    timeoutMs: 1_000,
    pollMs: 10,
    deps: {
      getRunpodPodById: async () => ({
        id: wake.podId,
        desiredStatus: "RUNNING",
        createdAt: "2026-04-24T00:00:00.000Z",
        lastStartedAt: "2026-04-24T00:00:00.000Z",
      }),
      tryReadStorageJson: async (pathname) =>
        pathname.endsWith("db-ok.json")
          ? {
              checkedAt: "2026-04-24T00:00:05.000Z",
            }
          : null,
      tryReadProxyHealth: async () => null,
      sleep: async () => {},
    },
  });

  assert.equal(ready.ok, true);
  assert.equal(ready.stage, "db_ok");

  let terminatedPodId: string | null = null;
  const dbError = await maybeEnsureRunpodWorkerReady({
    wake,
    terminateOnFailure: true,
    timeoutMs: 1_000,
    pollMs: 10,
    deps: {
      getRunpodPodById: async () => ({
        id: wake.podId,
        desiredStatus: "RUNNING",
        createdAt: "2026-04-24T00:00:00.000Z",
        lastStartedAt: "2026-04-24T00:00:00.000Z",
      }),
      tryReadStorageJson: async (pathname) =>
        pathname.endsWith("db-error.json")
          ? {
              checkedAt: "2026-04-24T00:00:05.000Z",
              error: "still fetching image",
            }
          : null,
      tryReadProxyHealth: async () => null,
      terminateRunpodPodById: async (podId) => {
        terminatedPodId = podId;
        return true;
      },
      sleep: async () => {},
    },
  });

  assert.equal(dbError.ok, false);
  assert.equal(dbError.stage, "db_error");
  assert.equal(terminatedPodId, wake.podId);
  assert.equal(dbError.terminatedPodId, wake.podId);

  console.log("runpod worker readiness regression checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
