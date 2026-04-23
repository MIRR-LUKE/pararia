import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dockerfile = readFileSync("Dockerfile.runpod-worker", "utf8");
assert.ok(!dockerfile.includes("COPY lib ./lib"), "worker Dockerfile must not copy the entire lib tree");
assert.ok(!dockerfile.includes("COPY scripts ./scripts"), "worker Dockerfile must not copy the entire scripts tree");
assert.ok(
  dockerfile.includes("COPY lib/runpod/worker-stop.ts ./lib/runpod/worker-stop.ts"),
  "worker Dockerfile must copy the dedicated worker-stop module"
);

const publishWorkflow = readFileSync(".github/workflows/publish-runpod-worker.yml", "utf8");
assert.ok(!publishWorkflow.includes("- lib/**"), "publish workflow must not rebuild the worker for every lib change");
assert.ok(
  publishWorkflow.includes("- lib/runpod/worker-stop.ts"),
  "publish workflow must include the dedicated worker-stop module"
);

const productionSmokeWorkflow = readFileSync(".github/workflows/production-recording-smoke.yml", "utf8");
assert.ok(
  productionSmokeWorkflow.includes("worker_changed=false"),
  "production smoke must classify worker-affecting files explicitly"
);
assert.ok(
  !productionSmokeWorkflow.includes("|lib/|README\\.md"),
  "production smoke must not treat every lib change as worker-affecting"
);

const workerEntrypoint = readFileSync("scripts/run-runpod-worker.ts", "utf8");
assert.ok(
  workerEntrypoint.includes('from "../lib/runpod/worker-stop"'),
  "worker entrypoint must import the isolated stop helper directly"
);

console.log("ok");
