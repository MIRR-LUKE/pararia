import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { getRuntimeRootDir, PARARIA_RUNTIME_DIR_ENV } from "../lib/runtime-paths";

const originalRuntimeDir = process.env[PARARIA_RUNTIME_DIR_ENV];
const originalVercel = process.env.VERCEL;

try {
  process.env[PARARIA_RUNTIME_DIR_ENV] = "/tmp/custom-pararia-runtime";
  assert.equal(getRuntimeRootDir(), path.resolve("/tmp/custom-pararia-runtime"));

  delete process.env[PARARIA_RUNTIME_DIR_ENV];
  process.env.VERCEL = "1";
  assert.equal(getRuntimeRootDir(), path.join(os.tmpdir(), "pararia-runtime"));

  console.log("runtime path regression checks passed");
} finally {
  if (originalRuntimeDir === undefined) {
    delete process.env[PARARIA_RUNTIME_DIR_ENV];
  } else {
    process.env[PARARIA_RUNTIME_DIR_ENV] = originalRuntimeDir;
  }

  if (originalVercel === undefined) {
    delete process.env.VERCEL;
  } else {
    process.env.VERCEL = originalVercel;
  }
}
