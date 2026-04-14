import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadEnvFile } from "./lib/load-env-file";

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
  await loadEnvFile(path.join(ROOT, ".env"), { optional: true, overrideExisting: false });
  await loadEnvFile(path.join(ROOT, ".env.local"), { optional: true, overrideExisting: false });
  await loadEnvFile(path.join(ROOT, ".tmp", "vercel.env"), { optional: true, overrideExisting: false });
  await loadEnvFile(path.join(ROOT, ".tmp", "vercel-prod.env"), { optional: true, overrideExisting: true });

  const repo = process.argv[2] || "MIRR-LUKE/pararia";
  const supabaseDbUrl =
    process.env.PARARIA_BACKUP_DATABASE_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  const supabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const blobToken = process.env.PARARIA_BLOB_BACKUP_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const projectRef =
    process.env.SUPABASE_PROJECT_REF?.trim() ||
    inferProjectRefFromUrl(supabaseDbUrl) ||
    inferProjectRefFromUrl(process.env.DATABASE_URL);

  const required = [
    ["SUPABASE_DB_URL", supabaseDbUrl],
    ["SUPABASE_ACCESS_TOKEN", supabaseAccessToken],
    ["SUPABASE_PROJECT_REF", projectRef],
  ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;

  if (required.length < 3) {
    throw new Error("SUPABASE_DB_URL / SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF を解決できませんでした。");
  }

  const optional = blobToken ? [["BLOB_READ_WRITE_TOKEN", blobToken] as [string, string]] : [];
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
