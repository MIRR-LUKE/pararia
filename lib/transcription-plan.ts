function readClampedEnvInt(keys: string[], fallback: number, min: number, max: number) {
  for (const key of keys) {
    const raw = process.env[key];
    if (!raw) continue;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, parsed));
    }
  }
  return Math.max(min, Math.min(max, fallback));
}

export type TranscriptionSessionType = "INTERVIEW" | "LESSON_REPORT";

export const FILE_SPLIT_MIN_SECONDS = readClampedEnvInt(["FILE_SPLIT_MIN_SECONDS"], 75, 60, 300);
export const FILE_SPLIT_CHUNK_SECONDS_INTERVIEW = readClampedEnvInt(
  ["FILE_SPLIT_CHUNK_SECONDS_INTERVIEW", "FILE_SPLIT_CHUNK_SECONDS"],
  120,
  20,
  180
);
export const FILE_SPLIT_CHUNK_SECONDS_LESSON = readClampedEnvInt(
  ["FILE_SPLIT_CHUNK_SECONDS_LESSON", "FILE_SPLIT_CHUNK_SECONDS"],
  45,
  20,
  120
);
export const FILE_SPLIT_CONCURRENCY_INTERVIEW = readClampedEnvInt(
  ["FILE_SPLIT_CONCURRENCY_INTERVIEW", "FILE_SPLIT_CONCURRENCY"],
  8,
  1,
  8
);
export const FILE_SPLIT_CONCURRENCY_LESSON = readClampedEnvInt(
  ["FILE_SPLIT_CONCURRENCY_LESSON", "FILE_SPLIT_CONCURRENCY"],
  8,
  1,
  8
);

export type TranscriptionPlan = {
  sessionType: TranscriptionSessionType;
  durationSeconds: number | null;
  shouldSplit: boolean;
  minSplitSeconds: number;
  chunkSeconds: number;
  concurrency: number;
  chunkCount: number;
  requestCount: number;
  requestWaves: number;
};

export function buildCustomTranscriptionPlan(input: {
  sessionType: TranscriptionSessionType;
  durationSeconds: number | null | undefined;
  minSplitSeconds: number;
  chunkSeconds: number;
  concurrency: number;
}): TranscriptionPlan {
  const durationSeconds =
    typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds) && input.durationSeconds >= 0
      ? input.durationSeconds
      : null;
  const shouldSplit = durationSeconds !== null && durationSeconds >= input.minSplitSeconds;
  const chunkCount =
    shouldSplit && durationSeconds !== null ? Math.max(1, Math.ceil(durationSeconds / Math.max(1, input.chunkSeconds))) : 1;
  const requestCount = shouldSplit ? chunkCount : 1;
  const requestWaves = Math.max(1, Math.ceil(requestCount / Math.max(1, input.concurrency)));

  return {
    sessionType: input.sessionType,
    durationSeconds,
    shouldSplit,
    minSplitSeconds: input.minSplitSeconds,
    chunkSeconds: input.chunkSeconds,
    concurrency: input.concurrency,
    chunkCount,
    requestCount,
    requestWaves,
  };
}

export function buildTranscriptionPlan(input: {
  sessionType: TranscriptionSessionType;
  durationSeconds: number | null | undefined;
}): TranscriptionPlan {
  return buildCustomTranscriptionPlan({
    sessionType: input.sessionType,
    durationSeconds: input.durationSeconds,
    minSplitSeconds: FILE_SPLIT_MIN_SECONDS,
    chunkSeconds:
      input.sessionType === "LESSON_REPORT" ? FILE_SPLIT_CHUNK_SECONDS_LESSON : FILE_SPLIT_CHUNK_SECONDS_INTERVIEW,
    concurrency:
      input.sessionType === "LESSON_REPORT" ? FILE_SPLIT_CONCURRENCY_LESSON : FILE_SPLIT_CONCURRENCY_INTERVIEW,
  });
}
