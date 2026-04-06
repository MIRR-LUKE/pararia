import { SessionPartType } from "@prisma/client";
import { transcribeAudioForPipeline, type TranscriptSegment } from "@/lib/ai/stt";
import {
  materializeStorageFile,
  readStorageText,
  saveStorageBuffer,
  saveStorageText,
} from "@/lib/audio-storage";
import { buildLiveChunkPathname, buildLiveManifestPathname } from "@/lib/audio-storage-paths";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "@/lib/transcript/preprocess";

type LiveChunkStatus = "PENDING" | "TRANSCRIBING" | "READY" | "ERROR";

type LiveChunkMeta = {
  sttSeconds?: number;
  sttModel?: string;
  sttResponseFormat?: string;
  sttRecoveryUsed?: boolean;
  sttFallbackUsed?: boolean;
  sttAttemptCount?: number;
  sttSegmentCount?: number;
  sttSpeakerCount?: number;
  sttQualityWarnings?: string[];
};

type LiveChunkEntry = {
  sequence: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  storageUrl: string;
  startedAtMs: number;
  durationMs: number;
  status: LiveChunkStatus;
  rawTextOriginal?: string;
  rawTextCleaned?: string;
  rawSegments?: TranscriptSegment[];
  error?: string;
  meta?: LiveChunkMeta;
};

type LivePartManifest = {
  sessionId: string;
  partType: SessionPartType;
  mimeType: string | null;
  totalDurationMs: number;
  updatedAt: string;
  chunks: LiveChunkEntry[];
};

type AppendChunkInput = {
  sessionId: string;
  partType: SessionPartType;
  sequence: number;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  startedAtMs: number;
  durationMs: number;
};

type FinalizedLivePart = {
  fileName: string;
  mimeType: string | null;
  byteSize: number;
  storageUrl: string;
  rawTextOriginal: string;
  displayTranscript: string;
  rawTextCleaned: string;
  rawSegments: TranscriptSegment[];
  qualityMeta: Record<string, unknown>;
};

const manifestLocks = new Map<string, Promise<void>>();
const chunkTranscriptionRuns = new Map<string, Promise<void>>();

function partKey(sessionId: string, partType: SessionPartType) {
  return `${sessionId}:${partType}`;
}

function chunkKey(sessionId: string, partType: SessionPartType, sequence: number) {
  return `${sessionId}:${partType}:${sequence}`;
}

function getManifestPath(sessionId: string, partType: SessionPartType) {
  return buildLiveManifestPathname(sessionId, partType);
}

async function withManifestLock<T>(key: string, fn: () => Promise<T>) {
  const previous = manifestLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => {}).then(() => gate);
  manifestLocks.set(key, queued);
  try {
    await previous.catch(() => {});
    return await fn();
  } finally {
    release();
    queued.finally(() => {
      if (manifestLocks.get(key) === queued) {
        manifestLocks.delete(key);
      }
    });
  }
}

async function readManifest(sessionId: string, partType: SessionPartType): Promise<LivePartManifest> {
  try {
    const raw = await readStorageText(getManifestPath(sessionId, partType));
    const parsed = JSON.parse(raw) as LivePartManifest;
    return {
      sessionId,
      partType,
      mimeType: parsed.mimeType ?? null,
      totalDurationMs: Number(parsed.totalDurationMs ?? 0),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
    };
  } catch {
    return {
      sessionId,
      partType,
      mimeType: null,
      totalDurationMs: 0,
      updatedAt: new Date().toISOString(),
      chunks: [],
    };
  }
}

async function writeManifest(manifest: LivePartManifest) {
  await saveStorageText({
    storagePathname: getManifestPath(manifest.sessionId, manifest.partType),
    text: JSON.stringify(
      {
        ...manifest,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    contentType: "application/json; charset=utf-8",
    allowOverwrite: true,
  });
}

function withOffsetSegments(segments: TranscriptSegment[] = [], offsetMs: number) {
  const offsetSeconds = offsetMs / 1000;
  return segments.map((segment) => ({
    ...segment,
    start: typeof segment.start === "number" ? segment.start + offsetSeconds : segment.start,
    end: typeof segment.end === "number" ? segment.end + offsetSeconds : segment.end,
  }));
}

function combineChunkText(chunks: LiveChunkEntry[], field: "rawTextOriginal" | "rawTextCleaned") {
  return chunks
    .map((chunk) => String(chunk[field] ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function countRecoveredChunks(chunks: LiveChunkEntry[]) {
  return chunks.filter((chunk) => chunk.meta?.sttRecoveryUsed).length;
}

export async function appendLiveTranscriptionChunk(input: AppendChunkInput) {
  const key = partKey(input.sessionId, input.partType);
  return withManifestLock(key, async () => {
    const manifest = await readManifest(input.sessionId, input.partType);
    const existing = manifest.chunks.find((chunk) => chunk.sequence === input.sequence);
    if (existing) {
      return {
        manifest,
        entry: existing,
        manifestPath: getManifestPath(input.sessionId, input.partType),
      };
    }

    const storage = await saveStorageBuffer({
      storagePathname: buildLiveChunkPathname(
        input.sessionId,
        input.partType,
        input.sequence,
        input.fileName || "audio.webm"
      ),
      buffer: input.buffer,
      contentType: input.mimeType || "audio/webm",
    });

    const entry: LiveChunkEntry = {
      sequence: input.sequence,
      fileName: input.fileName,
      mimeType: input.mimeType,
      byteSize: input.buffer.byteLength,
      storageUrl: storage.storageUrl,
      startedAtMs: Math.max(0, Math.floor(input.startedAtMs)),
      durationMs: Math.max(0, Math.floor(input.durationMs)),
      status: "PENDING",
    };

    manifest.mimeType = manifest.mimeType ?? input.mimeType;
    manifest.totalDurationMs = Math.max(manifest.totalDurationMs, entry.startedAtMs + entry.durationMs);
    manifest.chunks = [...manifest.chunks, entry].sort((a, b) => a.sequence - b.sequence);
    await writeManifest(manifest);

    return {
      manifest,
      entry,
      manifestPath: getManifestPath(input.sessionId, input.partType),
    };
  });
}

export async function startLiveChunkTranscription(sessionId: string, partType: SessionPartType, sequence: number) {
  const key = chunkKey(sessionId, partType, sequence);
  const running = chunkTranscriptionRuns.get(key);
  if (running) return running;

  const task = (async () => {
    const partLockKey = partKey(sessionId, partType);
    const chunk = await withManifestLock(partLockKey, async () => {
      const manifest = await readManifest(sessionId, partType);
      const current = manifest.chunks.find((entry) => entry.sequence === sequence);
      if (!current) return null;
      if (current.status === "READY") return current;
      if (current.status !== "TRANSCRIBING") {
        current.status = "TRANSCRIBING";
        current.error = undefined;
        await writeManifest(manifest);
      }
      return current;
    });

    if (!chunk || chunk.status === "READY") return;

    let localAudio: Awaited<ReturnType<typeof materializeStorageFile>> | null = null;
    try {
      const sttStart = Date.now();
      localAudio = await materializeStorageFile(chunk.storageUrl, {
        fileName: chunk.fileName,
      });
      const stt = await transcribeAudioForPipeline({
        filePath: localAudio.filePath,
        filename: chunk.fileName || "audio.webm",
        mimeType: chunk.mimeType || "audio/webm",
        language: "ja",
      });
      const pre =
        stt.segments.length > 0
          ? preprocessTranscriptWithSegments(stt.rawTextOriginal, stt.segments ?? [])
          : preprocessTranscript(stt.rawTextOriginal);

      await withManifestLock(partLockKey, async () => {
        const manifest = await readManifest(sessionId, partType);
        const current = manifest.chunks.find((entry) => entry.sequence === sequence);
        if (!current) return;
        current.status = "READY";
        current.rawTextOriginal = pre.rawTextOriginal;
        current.rawTextCleaned = pre.displayTranscript;
        current.rawSegments = stt.segments ?? [];
        current.meta = {
          sttSeconds: Math.round((Date.now() - sttStart) / 1000),
          sttModel: stt.meta.model,
          sttResponseFormat: stt.meta.responseFormat,
          sttRecoveryUsed: stt.meta.recoveryUsed,
          sttFallbackUsed: stt.meta.fallbackUsed,
          sttAttemptCount: stt.meta.attemptCount,
          sttSegmentCount: stt.meta.segmentCount,
          sttSpeakerCount: stt.meta.speakerCount,
          sttQualityWarnings: stt.meta.qualityWarnings,
        };
        current.error = undefined;
        await writeManifest(manifest);
      });
    } catch (error: any) {
      await withManifestLock(partLockKey, async () => {
        const manifest = await readManifest(sessionId, partType);
        const current = manifest.chunks.find((entry) => entry.sequence === sequence);
        if (!current) return;
        current.status = "ERROR";
        current.error = error?.message ?? "live chunk transcription failed";
        await writeManifest(manifest);
      });
      throw error;
    } finally {
      await localAudio?.cleanup().catch(() => {});
    }
  })();

  chunkTranscriptionRuns.set(key, task);
  try {
    await task;
  } finally {
    chunkTranscriptionRuns.delete(key);
  }
}

export async function finalizeLiveTranscriptionPart(sessionId: string, partType: SessionPartType): Promise<FinalizedLivePart> {
  const manifest = await readManifest(sessionId, partType);
  if (manifest.chunks.length === 0) {
    throw new Error("live chunks are missing");
  }

  const settled = await Promise.allSettled(
    manifest.chunks.map((chunk) => startLiveChunkTranscription(sessionId, partType, chunk.sequence))
  );
  const rejected = settled.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
  if (rejected) {
    throw rejected.reason;
  }

  const latest = await readManifest(sessionId, partType);
  const failed = latest.chunks.find((chunk) => chunk.status === "ERROR");
  if (failed) {
    throw new Error(failed.error ?? "live chunk transcription failed");
  }

  return buildFinalizedLivePartFromManifest(latest);
}

export function buildFinalizedLivePartFromManifest(manifest: {
  sessionId: string;
  partType: SessionPartType;
  mimeType: string | null;
  totalDurationMs: number;
  chunks: LiveChunkEntry[];
}): FinalizedLivePart {
  const readyChunks = [...manifest.chunks]
    .filter((chunk) => chunk.status === "READY")
    .sort((a, b) => a.sequence - b.sequence);
  if (readyChunks.length === 0) {
    throw new Error("live transcription produced no ready chunks");
  }

  const combinedOriginal = combineChunkText(readyChunks, "rawTextOriginal");
  const combinedSegments = readyChunks.flatMap((chunk) =>
    withOffsetSegments(chunk.rawSegments ?? [], chunk.startedAtMs)
  );
  const pre =
    combinedSegments.length > 0
      ? preprocessTranscriptWithSegments(combinedOriginal, combinedSegments)
      : preprocessTranscript(combinedOriginal);

  return {
    fileName: `${manifest.partType.toLowerCase()}-live.webm`,
    mimeType: manifest.mimeType,
    byteSize: readyChunks.reduce((total, chunk) => total + chunk.byteSize, 0),
    storageUrl: getManifestPath(manifest.sessionId, manifest.partType),
    rawTextOriginal: pre.rawTextOriginal,
    displayTranscript: pre.displayTranscript,
    rawTextCleaned: pre.displayTranscript,
    rawSegments: combinedSegments,
    qualityMeta: {
      liveTranscription: true,
      liveChunkCount: readyChunks.length,
      liveDurationSeconds: Math.round(manifest.totalDurationMs / 1000),
      sttSeconds: readyChunks.reduce((total, chunk) => total + Number(chunk.meta?.sttSeconds ?? 0), 0),
      sttModel: readyChunks[readyChunks.length - 1]?.meta?.sttModel ?? null,
      sttResponseFormat: readyChunks[readyChunks.length - 1]?.meta?.sttResponseFormat ?? null,
      sttRecoveryUsed: countRecoveredChunks(readyChunks) > 0,
      sttFallbackUsed: readyChunks.some((chunk) => chunk.meta?.sttFallbackUsed),
      sttAttemptCount: readyChunks.reduce((total, chunk) => total + Number(chunk.meta?.sttAttemptCount ?? 1), 0),
      sttSegmentCount: readyChunks.reduce((total, chunk) => total + Number(chunk.meta?.sttSegmentCount ?? 0), 0),
      sttSpeakerCount:
        readyChunks[readyChunks.length - 1]?.meta?.sttSpeakerCount ??
        null,
      sttQualityWarnings: Array.from(
        new Set(readyChunks.flatMap((chunk) => chunk.meta?.sttQualityWarnings ?? []))
      ),
      liveRecoveredChunkCount: countRecoveredChunks(readyChunks),
      liveFinalizedAt: new Date().toISOString(),
    },
  };
}

export async function getLiveTranscriptionProgress(sessionId: string, partType: SessionPartType) {
  const manifest = await readManifest(sessionId, partType);
  return {
    chunkCount: manifest.chunks.length,
    readyChunkCount: manifest.chunks.filter((chunk) => chunk.status === "READY").length,
    errorChunkCount: manifest.chunks.filter((chunk) => chunk.status === "ERROR").length,
    totalDurationMs: manifest.totalDurationMs,
    manifestPath: getManifestPath(sessionId, partType),
  };
}
