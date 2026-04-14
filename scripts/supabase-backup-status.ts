import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { loadBackupEnv } from "./lib/load-backup-env";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

function getArgValue(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function inferProjectRefFromUrl(input: string | undefined | null) {
  if (!input) return null;
  try {
    const url = new URL(input);
    const directMatch = url.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/i);
    if (directMatch) return directMatch[1];
    const usernameMatch = decodeURIComponent(url.username).match(/^postgres\.([a-z0-9]{20})$/i);
    if (usernameMatch) return usernameMatch[1];
    return null;
  } catch {
    return null;
  }
}

async function fetchJson(pathname: string, token: string) {
  const response = await fetch(`https://api.supabase.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: text.length > 0 ? JSON.parse(text) : null,
  };
}

async function main() {
  await loadBackupEnv(ROOT);

  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new Error("SUPABASE_ACCESS_TOKEN が必要です。");
  }

  const projectRef =
    getArgValue("--project-ref") ||
    process.env.SUPABASE_PROJECT_REF?.trim() ||
    inferProjectRefFromUrl(process.env.PARARIA_BACKUP_DATABASE_URL) ||
    inferProjectRefFromUrl(process.env.DIRECT_URL) ||
    inferProjectRefFromUrl(process.env.DATABASE_URL);

  if (!projectRef) {
    throw new Error("project ref を解決できません。--project-ref または SUPABASE_PROJECT_REF を指定してください。");
  }

  const [backups, addons] = await Promise.all([
    fetchJson(`/v1/projects/${projectRef}/database/backups`, accessToken),
    fetchJson(`/v1/projects/${projectRef}/billing/addons`, accessToken),
  ]);

  const status = {
    checkedAt: new Date().toISOString(),
    projectRef,
    backups: backups.body,
    addons: addons.body,
  };

  const outFile = getArgValue("--out");
  if (outFile) {
    const absolute = path.isAbsolute(outFile) ? outFile : path.join(ROOT, outFile);
    await writeFile(absolute, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(status, null, 2));
}

main().catch((error) => {
  console.error("[supabase-backup-status] failed:", error);
  process.exitCode = 1;
});
