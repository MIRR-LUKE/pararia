import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRuntimeRootDir } from "@/lib/runtime-paths";

const AUDIO_STORAGE_MODE_ENV = "PARARIA_AUDIO_STORAGE_MODE";
const AUDIO_BLOB_ACCESS_ENV = "PARARIA_AUDIO_BLOB_ACCESS";

export type AudioStorageMode = "local" | "blob";
export type AudioStorageAccess = "public" | "private";

export function getAudioStorageMode(): AudioStorageMode {
  const configured = process.env[AUDIO_STORAGE_MODE_ENV]?.trim().toLowerCase();
  if (configured === "blob") return "blob";
  if (configured === "local") return "local";
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() ? "blob" : "local";
}

export function getAudioStorageAccess(): AudioStorageAccess {
  return process.env[AUDIO_BLOB_ACCESS_ENV]?.trim().toLowerCase() === "public" ? "public" : "private";
}

export function isRemoteStorageUrl(storageUrl: string) {
  return /^https?:\/\//i.test(String(storageUrl || ""));
}

async function getBlobSdk() {
  return import("@vercel/blob");
}

function toBlobStorageWriteError(error: unknown) {
  const detail = String((error as any)?.message ?? error ?? "unknown blob storage error");
  const suspended =
    String((error as any)?.name ?? "") === "BlobStoreSuspendedError" || /store has been suspended|store is suspended/i.test(detail);
  if (suspended) {
    return new Error("音声保存ストレージが停止中です。Vercel Blob の Billing State を Active に戻してから、もう一度お試しください。");
  }
  return error instanceof Error ? error : new Error(detail);
}

function toLocalRuntimePath(storagePathname: string) {
  return path.join(getRuntimeRootDir(), ...String(storagePathname).split("/").filter(Boolean));
}

export function resolveStorageReference(storagePathname: string) {
  return getAudioStorageMode() === "blob" ? storagePathname : toLocalRuntimePath(storagePathname);
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>) {
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function saveStorageBuffer(input: {
  storagePathname: string;
  buffer: Buffer;
  contentType?: string;
  allowOverwrite?: boolean;
}) {
  if (getAudioStorageMode() === "blob") {
    const { put } = await getBlobSdk();
    let blob;
    try {
      blob = await put(input.storagePathname, input.buffer, {
        access: getAudioStorageAccess(),
        addRandomSuffix: false,
        allowOverwrite: input.allowOverwrite ?? true,
        contentType: input.contentType,
      });
    } catch (error) {
      throw toBlobStorageWriteError(error);
    }
    return {
      storageUrl: blob.url,
      storagePathname: blob.pathname,
      byteSize: input.buffer.byteLength,
    };
  }

  const localPath = toLocalRuntimePath(input.storagePathname);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, input.buffer);
  return {
    storageUrl: localPath,
    storagePathname: input.storagePathname,
    byteSize: input.buffer.byteLength,
  };
}

export async function saveStorageText(input: {
  storagePathname: string;
  text: string;
  contentType?: string;
  allowOverwrite?: boolean;
}) {
  const buffer = Buffer.from(input.text, "utf8");
  return saveStorageBuffer({
    storagePathname: input.storagePathname,
    buffer,
    contentType: input.contentType ?? "application/json; charset=utf-8",
    allowOverwrite: input.allowOverwrite,
  });
}

export async function readStorageBuffer(storageUrl: string) {
  if (getAudioStorageMode() === "blob" && !path.isAbsolute(storageUrl)) {
    const { get } = await getBlobSdk();
    const blob = await get(storageUrl, {
      access: getAudioStorageAccess(),
      useCache: false,
    });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      throw new Error("storage object could not be read");
    }
    return streamToBuffer(blob.stream);
  }

  const localPath = path.isAbsolute(storageUrl) ? storageUrl : toLocalRuntimePath(storageUrl);
  return readFile(localPath);
}

export async function readStorageText(storageUrl: string) {
  const buffer = await readStorageBuffer(storageUrl);
  return buffer.toString("utf8");
}

export async function materializeStorageFile(
  storageUrl: string,
  opts?: {
    fileName?: string | null;
  }
) {
  if (!isRemoteStorageUrl(storageUrl)) {
    return {
      filePath: path.isAbsolute(storageUrl) ? storageUrl : resolveStorageReference(storageUrl),
      cleanup: async () => {},
    };
  }

  const tempRoot = path.join(getRuntimeRootDir(), ".tmp", "audio-downloads");
  await mkdir(tempRoot, { recursive: true });
  const tempDir = await mkdtemp(path.join(tempRoot, "blob-"));

  let guessedName = String(opts?.fileName || "").trim();
  if (!guessedName) {
    try {
      const parsed = new URL(storageUrl);
      guessedName = path.basename(parsed.pathname) || "audio.bin";
    } catch {
      guessedName = "audio.bin";
    }
  }

  const filePath = path.join(tempDir, guessedName);
  const buffer = await readStorageBuffer(storageUrl);
  await writeFile(filePath, buffer);

  return {
    filePath,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export async function deleteStorageEntry(storageUrl: string) {
  return (await deleteStorageEntryDetailed(storageUrl)).ok;
}

export async function deleteStorageEntryDetailed(storageUrl: string): Promise<{ ok: boolean; error?: string }> {
  if (!storageUrl) return { ok: false, error: "empty storage target" };

  if ((getAudioStorageMode() === "blob" && !path.isAbsolute(storageUrl)) || isRemoteStorageUrl(storageUrl)) {
    const { del } = await getBlobSdk();
    try {
      await del(storageUrl);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? "blob deletion failed" };
    }
  }

  const localPath = path.isAbsolute(storageUrl) ? storageUrl : toLocalRuntimePath(storageUrl);
  const runtimeRoot = path.resolve(getRuntimeRootDir()).toLowerCase();
  const target = path.resolve(localPath).toLowerCase();
  if (!(target === runtimeRoot || target.startsWith(`${runtimeRoot}${path.sep}`))) {
    return { ok: false, error: "runtime root 外のパスは削除できません。" };
  }
  try {
    await rm(localPath, { recursive: true, force: true });
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? "local deletion failed" };
  }
}
