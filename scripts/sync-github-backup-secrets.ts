import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadBackupEnv } from "./lib/load-backup-env";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

function inferProjectRefFromUrl(input: string | undefined | null) {
  if (!input) return null;
  try {
    const url = new URL(input);
    const directMatch = url.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/i);
    if (directMatch) return directMatch[1];
    const usernameMatch = decodeURIComponent(url.username).match(/^postgres\.([a-z0-9]{20})$/i);
    if (usernameMatch) return usernameMatch[1];
  } catch {}
  return null;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function setSecret(repo: string, name: string, value: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("gh", ["secret", "set", name, "--repo", repo], {
      cwd: ROOT,
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.stdin.write(value);
    child.stdin.end();
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `gh secret set failed for ${name}. GitHub token に Actions secrets の write 権限があるか確認してください。`
        )
      );
    });
  });
}

async function main() {
  await loadBackupEnv(ROOT, { includeTmpEnv: hasFlag("--include-tmp-env") });

  const repo = process.argv[2] || "MIRR-LUKE/pararia";
  const databaseSource: "PARARIA_BACKUP_DATABASE_URL" | "DIRECT_URL" | "DATABASE_URL" | null = process.env.PARARIA_BACKUP_DATABASE_URL?.trim()
    ? "PARARIA_BACKUP_DATABASE_URL"
    : process.env.DIRECT_URL?.trim()
      ? "DIRECT_URL"
      : process.env.DATABASE_URL?.trim()
        ? "DATABASE_URL"
        : null;
  const supabaseDbUrl =
    process.env.PARARIA_BACKUP_DATABASE_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  const supabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const backupBlobToken = process.env.PARARIA_BLOB_BACKUP_TOKEN?.trim();
  const sharedBlobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const projectRef =
    process.env.SUPABASE_PROJECT_REF?.trim() ||
    inferProjectRefFromUrl(supabaseDbUrl) ||
    inferProjectRefFromUrl(process.env.DATABASE_URL);

  const required = [
    ["PARARIA_BACKUP_DATABASE_URL", supabaseDbUrl],
    ["SUPABASE_ACCESS_TOKEN", supabaseAccessToken],
    ["SUPABASE_PROJECT_REF", projectRef],
  ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;

  if (required.length < 3) {
    throw new Error("PARARIA_BACKUP_DATABASE_URL / SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF を解決できませんでした。");
  }

  if (databaseSource && databaseSource !== "PARARIA_BACKUP_DATABASE_URL") {
    console.warn(
      `[sync-github-backup-secrets] backup 専用の PARARIA_BACKUP_DATABASE_URL が未設定です。いまは ${databaseSource} を使って GitHub secret を作っています。`
    );
  }

  if (!backupBlobToken && sharedBlobToken) {
    console.warn(
      "[sync-github-backup-secrets] BLOB_READ_WRITE_TOKEN は backup には流用しません。PARARIA_BLOB_BACKUP_TOKEN を別で用意してください。"
    );
  }

  const optional = backupBlobToken ? [["PARARIA_BLOB_BACKUP_TOKEN", backupBlobToken] as [string, string]] : [];
  const secrets = [...required, ...optional];

  for (const [name, value] of secrets) {
    await setSecret(repo, name, value);
  }

  console.log(
    JSON.stringify(
      {
        repo,
        syncedSecrets: secrets.map(([name]) => name),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[sync-github-backup-secrets] failed:", error);
  process.exitCode = 1;
});
