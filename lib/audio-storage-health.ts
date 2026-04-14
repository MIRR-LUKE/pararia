import { getAudioStorageAccess, getAudioStorageMode } from "@/lib/audio-storage";

type AudioBlobWriteHealthResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: "blob_store_suspended" | "blob_store_unavailable";
      message: string;
      detail: string;
    };

type CachedAudioBlobWriteHealth = {
  expiresAt: number;
  result: AudioBlobWriteHealthResult;
};

const SUCCESS_CACHE_MS = 30_000;
const FAILURE_CACHE_MS = 10_000;

let cachedAudioBlobWriteHealth: CachedAudioBlobWriteHealth | null = null;

function readCachedAudioBlobWriteHealth(now: number) {
  if (!cachedAudioBlobWriteHealth) return null;
  if (cachedAudioBlobWriteHealth.expiresAt <= now) {
    cachedAudioBlobWriteHealth = null;
    return null;
  }
  return cachedAudioBlobWriteHealth.result;
}

function writeCachedAudioBlobWriteHealth(result: AudioBlobWriteHealthResult, ttlMs: number, now: number) {
  cachedAudioBlobWriteHealth = {
    expiresAt: now + ttlMs,
    result,
  };
  return result;
}

function buildBlobWriteProbePath(now: number) {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `session-audio/.health/blob-write-${now}-${suffix}.txt`;
}

export async function checkAudioBlobWriteHealth(): Promise<AudioBlobWriteHealthResult> {
  if (getAudioStorageMode() !== "blob") {
    return { ok: true };
  }

  const now = Date.now();
  const cached = readCachedAudioBlobWriteHealth(now);
  if (cached) return cached;

  try {
    const { del, put } = await import("@vercel/blob");
    const probe = await put(buildBlobWriteProbePath(now), Buffer.from("ok", "utf8"), {
      access: getAudioStorageAccess(),
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "text/plain; charset=utf-8",
    });
    await del(probe.url).catch(() => {});
    return writeCachedAudioBlobWriteHealth({ ok: true }, SUCCESS_CACHE_MS, now);
  } catch (error: any) {
    const detail = String(error?.message ?? error ?? "unknown blob storage error");
    const suspended = /store is suspended/i.test(detail);
    const result: AudioBlobWriteHealthResult = suspended
      ? {
          ok: false,
          code: "blob_store_suspended",
          message:
            "音声保存ストレージが停止中です。Vercel Blob の Billing State を Active に戻してから、もう一度お試しください。",
          detail,
        }
      : {
          ok: false,
          code: "blob_store_unavailable",
          message: "音声保存ストレージに接続できませんでした。時間をおいて再度お試しください。",
          detail,
        };
    return writeCachedAudioBlobWriteHealth(result, FAILURE_CACHE_MS, now);
  }
}
