import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, list } from "@vercel/blob";
import { loadBackupEnv } from "./lib/load-backup-env";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

function getArgValue(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function timestampLabel(date: Date) {
  return date.toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
}

function toBackupPath(rootDir: string, pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return path.join(rootDir, ...parts);
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

async function main() {
  await loadBackupEnv(ROOT);

  const prefix = getArgValue("--prefix") ?? "session-audio/";
  const outputRoot = getArgValue("--output-dir") ?? path.join(ROOT, ".backups", "blob");
  const token = process.env.PARARIA_BLOB_BACKUP_TOKEN?.trim();
  const access = ((process.env.PARARIA_BLOB_BACKUP_ACCESS ?? process.env.PARARIA_AUDIO_BLOB_ACCESS ?? "private").trim()
    .toLowerCase() === "public"
      ? "public"
      : "private") as "private" | "public";
  const manifestOnly = hasFlag("--manifest-only");

  if (!token) {
    throw new Error("PARARIA_BLOB_BACKUP_TOKEN が必要です。BLOB_READ_WRITE_TOKEN は backup には流用せず、専用 token を設定してください。");
  }

  const stamp = timestampLabel(new Date());
  const backupDir = path.join(outputRoot, stamp);
  const filesDir = path.join(backupDir, "files");
  const manifestPath = path.join(backupDir, "manifest.json");
  await mkdir(filesDir, { recursive: true });

  const blobs: Array<{
    pathname: string;
    url: string;
    downloadUrl: string;
    uploadedAt: string;
    size: number;
    etag: string;
    localPath?: string;
    localSha256?: string;
  }> = [];

  let cursor: string | undefined;
  do {
    const page = await list({
      token,
      prefix,
      cursor,
      limit: 1000,
    });

    for (const blob of page.blobs) {
      const item = {
        pathname: blob.pathname,
        url: blob.url,
        downloadUrl: blob.downloadUrl,
        uploadedAt: blob.uploadedAt.toISOString(),
        size: blob.size,
        etag: blob.etag,
      } as {
        pathname: string;
        url: string;
        downloadUrl: string;
        uploadedAt: string;
        size: number;
        etag: string;
        localPath?: string;
        localSha256?: string;
      };

      if (!manifestOnly) {
        const filePath = toBackupPath(filesDir, blob.pathname);
        const response = await get(blob.pathname, {
          token,
          access,
          useCache: false,
        });
        if (!response || response.statusCode !== 200 || !response.stream) {
          throw new Error(`blob download failed for ${blob.pathname}`);
        }
        await mkdir(path.dirname(filePath), { recursive: true });
        await pipeline(Readable.fromWeb(response.stream as any), createWriteStream(filePath));
        item.localPath = path.relative(ROOT, filePath);
        item.localSha256 = await sha256File(filePath);
      }

      blobs.push(item);
    }

    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const manifest = {
    createdAt: new Date().toISOString(),
    prefix,
    access,
    manifestOnly,
    blobCount: blobs.length,
    outputDir: path.relative(ROOT, backupDir),
    blobs,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    createdAt: manifest.createdAt,
    prefix,
    manifestOnly,
    blobCount: blobs.length,
    manifestPath: path.relative(ROOT, manifestPath),
    filesDir: manifestOnly ? null : path.relative(ROOT, filesDir),
  }, null, 2));
}

main().catch((error) => {
  console.error("[backup-blob-runtime] failed:", error);
  process.exitCode = 1;
});
