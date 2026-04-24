#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pararia-write-production-ops-env-"));
  const outputPath = path.join(tempDir, "ops.env");
  const outputArgPath = outputPath.replace(/\\/g, "/");

  try {
    const env = {
      ...process.env,
      DATABASE_URL: "postgresql://db",
      DIRECT_URL: "postgresql://direct",
      BLOB_READ_WRITE_TOKEN: "blob-token",
      MAINTENANCE_SECRET: "maintenance-secret",
      RUNPOD_API_KEY: "runpod-api-key",
      RUNPOD_WORKER_NAME: "custom-worker",
      RUNPOD_WORKER_IMAGE: "ghcr.io/example/worker:sha-test",
      PARARIA_BACKGROUND_MODE: "external",
      PARARIA_AUDIO_STORAGE_MODE: "blob",
      PARARIA_AUDIO_BLOB_ACCESS: "private",
    };

    if (process.platform === "win32") {
      execFileSync(
        "cmd.exe",
        [
          "/d",
          "/s",
          "/c",
          `npx tsx scripts/write-production-ops-env.ts --output=${outputArgPath} --base-url=https://pararia.vercel.app`,
        ],
        { cwd: process.cwd(), stdio: "pipe", env }
      );
    } else {
      execFileSync(
        "npx",
        [
          "tsx",
          "scripts/write-production-ops-env.ts",
          `--output=${outputPath}`,
          "--base-url=https://pararia.vercel.app",
        ],
        { cwd: process.cwd(), stdio: "pipe", env }
      );
    }

    const raw = await readFile(outputPath, "utf8");
    assert.match(raw, /NEXTAUTH_URL="https:\/\/pararia\.vercel\.app"/);
    assert.match(raw, /NEXT_PUBLIC_APP_URL="https:\/\/pararia\.vercel\.app"/);
    assert.match(raw, /MAINTENANCE_SECRET="maintenance-secret"/);
    assert.match(raw, /CRON_SECRET="maintenance-secret"/);
    assert.match(raw, /RUNPOD_WORKER_NAME="custom-worker"/);
    assert.match(raw, /RUNPOD_WORKER_IMAGE="ghcr\.io\/example\/worker:sha-test"/);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log("write-production-ops-env smoke check passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
