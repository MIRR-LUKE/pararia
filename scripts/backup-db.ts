import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadBackupEnv } from "./lib/load-backup-env";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

function getArgValue(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function timestampLabel(date: Date) {
  return date.toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
}

function maskDatabaseUrl(input: string) {
  try {
    const parsed = new URL(input);
    const database = parsed.pathname.replace(/^\//, "") || "postgres";
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || "5432"}/${database}`;
  } catch {
    return "unparseable";
  }
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

async function runPgDump(dumpPath: string, databaseUrl: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        dumpPath,
        `--dbname=${databaseUrl}`,
      ],
      {
        cwd: ROOT,
        env: process.env,
        stdio: ["ignore", "inherit", "inherit"],
      }
    );

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("pg_dump が見つかりません。PostgreSQL client をインストールし、PATH に通してください。"));
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pg_dump exited with code ${code ?? "unknown"}`));
    });
  });
}

async function commandExists(command: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ["--version"], {
      cwd: ROOT,
      env: process.env,
      stdio: "ignore",
      shell: false,
    });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

type BackupResult =
  | {
      dumpFormat: "supabase-cli-sql-split";
      files: string[];
    }
  | {
      dumpFormat: "pg_dump custom";
      files: string[];
      bytes: number;
      sha256: string;
    };

async function runSupabaseDbDump(outputDir: string, databaseUrl: string) {
  const rolesPath = path.join(outputDir, "roles.sql");
  const schemaPath = path.join(outputDir, "schema.sql");
  const dataPath = path.join(outputDir, "data.sql");

  const runs: Array<{ label: string; args: string[] }> = [
    {
      label: "roles",
      args: ["supabase", "db", "dump", "--db-url", databaseUrl, "-f", rolesPath, "--role-only"],
    },
    {
      label: "schema",
      args: ["supabase", "db", "dump", "--db-url", databaseUrl, "-f", schemaPath],
    },
    {
      label: "data",
      args: ["supabase", "db", "dump", "--db-url", databaseUrl, "-f", dataPath, "--data-only", "--use-copy"],
    },
  ];

  for (const item of runs) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npx", item.args, {
        cwd: ROOT,
        env: process.env,
        stdio: ["ignore", "inherit", "inherit"],
        shell: true,
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`supabase db dump (${item.label}) exited with code ${code ?? "unknown"}`));
      });
    });
  }

  const [rolesHash, schemaHash, dataHash] = await Promise.all([
    sha256File(rolesPath),
    sha256File(schemaPath),
    sha256File(dataPath),
  ]);
  const checksumFile = path.join(outputDir, "SHA256SUMS");
  await writeFile(
    checksumFile,
    `SHA256 ${path.basename(rolesPath)} ${rolesHash}\nSHA256 ${path.basename(schemaPath)} ${schemaHash}\nSHA256 ${path.basename(dataPath)} ${dataHash}\n`,
    "utf8"
  );

  return {
    dumpFormat: "supabase-cli-sql-split",
    files: [
      path.relative(ROOT, rolesPath),
      path.relative(ROOT, schemaPath),
      path.relative(ROOT, dataPath),
      path.relative(ROOT, checksumFile),
    ],
  } satisfies BackupResult;
}

async function main() {
  await loadBackupEnv(ROOT);

  const outputRoot =
    getArgValue("--output-dir") ?? path.join(ROOT, ".backups", "db");
  const stamp = timestampLabel(new Date());
  const backupDir = path.join(outputRoot, stamp);
  const metadataPath = path.join(backupDir, "metadata.json");

  const databaseUrl =
    process.env.PARARIA_BACKUP_DATABASE_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("PARARIA_BACKUP_DATABASE_URL, DIRECT_URL, DATABASE_URL のいずれかが必要です。");
  }

  await mkdir(backupDir, { recursive: true });
  const preferSupabaseCli =
    process.env.PARARIA_BACKUP_USE_SUPABASE_CLI?.trim() === "1" ||
    !(await commandExists("pg_dump"));

  const dockerAvailable = await commandExists("docker");
  if (preferSupabaseCli && !dockerAvailable) {
    throw new Error(
      "pg_dump が見つからず、Supabase CLI fallback には Docker Desktop が必要です。GitHub Actions を使うか、pg_dump か Docker を入れてください。"
    );
  }

  const result: BackupResult = preferSupabaseCli
    ? await runSupabaseDbDump(backupDir, databaseUrl)
    : await (async () => {
        const dumpPath = path.join(backupDir, "pararia.dump");
        await runPgDump(dumpPath, databaseUrl);
        const [dumpStats, checksum] = await Promise.all([stat(dumpPath), sha256File(dumpPath)]);
        return {
          dumpFormat: "pg_dump custom",
          files: [path.relative(ROOT, dumpPath)],
          bytes: dumpStats.size,
          sha256: checksum,
        } satisfies BackupResult;
      })();

  const metadata = {
    createdAt: new Date().toISOString(),
    dumpFormat: result.dumpFormat,
    dumpFiles: result.files,
    metadataFile: path.relative(ROOT, metadataPath),
    ...("bytes" in result ? { bytes: result.bytes } : {}),
    ...("sha256" in result ? { sha256: result.sha256 } : {}),
    database: maskDatabaseUrl(databaseUrl),
    source: preferSupabaseCli ? "supabase-cli" : "pg_dump",
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((error) => {
  console.error("[backup-db] failed:", error);
  process.exitCode = 1;
});
