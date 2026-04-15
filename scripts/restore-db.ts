#!/usr/bin/env tsx

import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBackupEnv } from "./lib/load-backup-env";
import { assertRestoreDrillTargetSafe } from "./lib/environment-safety";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

function getArgValue(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function runCommand(command: string, args: string[], cwd = ROOT) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
      shell: false,
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error(`${command} が見つかりません。PostgreSQL client を入れてから再実行してください。`));
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function dropAndRecreatePublicSchema(databaseUrl: string) {
  await runCommand("psql", [
    databaseUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "drop schema if exists public cascade; create schema public;",
  ]);
}

async function restoreSqlBundle(backupDir: string, databaseUrl: string, restoreRoles = false) {
  const rolesPath = path.join(backupDir, "roles.sql");
  const schemaPath = path.join(backupDir, "schema.sql");
  const dataPath = path.join(backupDir, "data.sql");

  if (restoreRoles) {
    await runCommand("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", rolesPath]);
  }

  await dropAndRecreatePublicSchema(databaseUrl);
  await runCommand("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", schemaPath]);
  await runCommand("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", dataPath]);
}

async function restorePgDumpDump(dumpFile: string, databaseUrl: string) {
  await runCommand("pg_restore", [
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    databaseUrl,
    dumpFile,
  ]);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await loadBackupEnv(ROOT);

  const backupDir = getArgValue("--backup-dir");
  const dumpFile = getArgValue("--dump-file");
  const databaseUrl = getArgValue("--database-url") || process.env.DATABASE_URL?.trim() || "";
  const restoreRoles = /^(1|true|yes)$/i.test(getArgValue("--restore-roles") ?? "");

  if (!databaseUrl) {
    throw new Error("--database-url か DATABASE_URL が必要です。");
  }

  assertRestoreDrillTargetSafe(databaseUrl, "restore-db");

  if (backupDir) {
    const metadataPath = path.join(backupDir, "metadata.json");
    const metadataRaw = await readFile(metadataPath, "utf8").catch(() => "");
    const metadata = metadataRaw ? (JSON.parse(metadataRaw) as { dumpFormat?: string }) : {};
    const customDump = path.join(backupDir, "pararia.dump");
    const hasCustomDump = (metadata.dumpFormat ?? "").includes("pg_dump custom") || (await fileExists(customDump));

    if (hasCustomDump) {
      await restorePgDumpDump(customDump, databaseUrl);
    } else {
      await restoreSqlBundle(backupDir, databaseUrl, restoreRoles);
    }
  } else if (dumpFile) {
    await restorePgDumpDump(dumpFile, databaseUrl);
  } else {
    throw new Error("--backup-dir か --dump-file のどちらかが必要です。");
  }

  console.log(
    JSON.stringify(
      {
        restoredTo: databaseUrl.replace(/:[^@/]*@/, ":***@"),
        backupDir: backupDir ?? null,
        dumpFile: dumpFile ?? null,
        restoreRoles,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[restore-db] failed:", error);
  process.exitCode = 1;
});
