import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

type ManifestChunk = {
  storageUrl: string;
  durationMs: number;
  mimeType?: string | null;
};

type Manifest = {
  totalDurationMs: number;
  chunks: ManifestChunk[];
};

type TranscribeResult = {
  transcript: string;
  durationMs: number;
  sttWallMs: number;
  chunkCount: number;
};

type BenchResult = {
  mode: "INTERVIEW" | "LESSON_REPORT";
  audioSeconds: number;
  sttSeconds: number;
  finalizeSeconds: number;
  totalSeconds: number;
  splitChunkCount: number | string;
  promptInputTokensEstimate: number;
  outputTokensEstimate: number;
  summaryChars: number;
};

async function main() {
  const [
    { splitAudioIntoChunks, cleanupChunkDirectory, getAudioDurationMs, guessAudioMimeType },
    { preprocessTranscript, preprocessTranscriptWithSegments },
    { transcribeAudioForPipeline },
    { generateConversationDraftFast, estimateTokens },
    ffmpegStaticModule,
  ] = await Promise.all([
    import("../lib/audio-chunking"),
    import("../lib/transcript/preprocess"),
    import("../lib/ai/stt"),
    import("../lib/ai/conversationPipeline"),
    import("ffmpeg-static"),
  ]);

  const ffmpegPath = typeof ffmpegStaticModule.default === "string" ? ffmpegStaticModule.default : "";
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static is unavailable.");
  }

  const fileSplitMinSeconds = readClampedEnvInt(["FILE_SPLIT_MIN_SECONDS"], 75, 60, 300);
  const fileSplitChunkSecondsInterview = readClampedEnvInt(
    ["FILE_SPLIT_CHUNK_SECONDS_INTERVIEW", "FILE_SPLIT_CHUNK_SECONDS"],
    60,
    20,
    120
  );
  const fileSplitChunkSecondsLesson = readClampedEnvInt(
    ["FILE_SPLIT_CHUNK_SECONDS_LESSON", "FILE_SPLIT_CHUNK_SECONDS"],
    45,
    20,
    120
  );
  const fileSplitConcurrencyInterview = readClampedEnvInt(
    ["FILE_SPLIT_CONCURRENCY_INTERVIEW", "FILE_SPLIT_CONCURRENCY"],
    8,
    1,
    8
  );
  const fileSplitConcurrencyLesson = readClampedEnvInt(
    ["FILE_SPLIT_CONCURRENCY_LESSON", "FILE_SPLIT_CONCURRENCY"],
    8,
    1,
    8
  );
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "pararia-bench-"));

  try {
    const interviewManifestPath = path.join(
      process.cwd(),
      ".data",
      "session-audio",
      "live",
      "bench-interview-1774437575300",
      "full",
      "manifest.json"
    );
    const lessonCheckInManifestPath = path.join(
      process.cwd(),
      ".data",
      "session-audio",
      "live",
      "bench-lesson-1774437602787",
      "check_in",
      "manifest.json"
    );
    const lessonCheckOutManifestPath = path.join(
      process.cwd(),
      ".data",
      "session-audio",
      "live",
      "bench-lesson-1774437602787",
      "check_out",
      "manifest.json"
    );

    const interviewManifest = readManifest(interviewManifestPath);
    const lessonCheckInManifest = readManifest(lessonCheckInManifestPath);
    const lessonCheckOutManifest = readManifest(lessonCheckOutManifestPath);

    const interviewAudioPath = path.join(tempRoot, "interview-full.m4a");
    const lessonCheckInAudioPath = path.join(tempRoot, "lesson-checkin-full.m4a");
    const lessonCheckOutAudioPath = path.join(tempRoot, "lesson-checkout-full.m4a");

    await concatChunks(ffmpegPath, interviewManifest.chunks.map((chunk) => chunk.storageUrl), interviewAudioPath, tempRoot);
    await concatChunks(ffmpegPath, lessonCheckInManifest.chunks.map((chunk) => chunk.storageUrl), lessonCheckInAudioPath, tempRoot);
    await concatChunks(ffmpegPath, lessonCheckOutManifest.chunks.map((chunk) => chunk.storageUrl), lessonCheckOutAudioPath, tempRoot);

    const interviewTranscription = await transcribeFile({
      audioPath: interviewAudioPath,
      fileSplitMinSeconds,
      fileSplitChunkSeconds: fileSplitChunkSecondsInterview,
      fileSplitConcurrency: fileSplitConcurrencyInterview,
      splitAudioIntoChunks,
      cleanupChunkDirectory,
      getAudioDurationMs,
      guessAudioMimeType,
      preprocessTranscript,
      preprocessTranscriptWithSegments,
      transcribeAudioForPipeline,
    });

    const interviewFinalizeStartedAt = Date.now();
    const interviewDraft = await generateConversationDraftFast({
      transcript: interviewTranscription.transcript,
      studentName: "堂林 徹生",
      teacherName: "PARARIA Admin",
      sessionDate: "2026-03-22",
      minSummaryChars: minSummaryCharsFor("INTERVIEW", interviewTranscription.transcript),
      sessionType: "INTERVIEW",
    });
    const interviewFinalizeMs = Date.now() - interviewFinalizeStartedAt;

    const lessonSttStartedAt = Date.now();
    const [lessonCheckInTranscription, lessonCheckOutTranscription] = await Promise.all([
      transcribeFile({
        audioPath: lessonCheckInAudioPath,
        fileSplitMinSeconds,
        fileSplitChunkSeconds: fileSplitChunkSecondsLesson,
        fileSplitConcurrency: fileSplitConcurrencyLesson,
        splitAudioIntoChunks,
        cleanupChunkDirectory,
        getAudioDurationMs,
        guessAudioMimeType,
        preprocessTranscript,
        preprocessTranscriptWithSegments,
        transcribeAudioForPipeline,
      }),
      transcribeFile({
        audioPath: lessonCheckOutAudioPath,
        fileSplitMinSeconds,
        fileSplitChunkSeconds: fileSplitChunkSecondsLesson,
        fileSplitConcurrency: fileSplitConcurrencyLesson,
        splitAudioIntoChunks,
        cleanupChunkDirectory,
        getAudioDurationMs,
        guessAudioMimeType,
        preprocessTranscript,
        preprocessTranscriptWithSegments,
        transcribeAudioForPipeline,
      }),
    ]);
    const lessonSttMs = Date.now() - lessonSttStartedAt;
    const lessonTranscript = [
      "## 授業前チェックイン",
      lessonCheckInTranscription.transcript,
      "",
      "## 授業後チェックアウト",
      lessonCheckOutTranscription.transcript,
    ]
      .join("\n")
      .trim();

    const lessonFinalizeStartedAt = Date.now();
    const lessonDraft = await generateConversationDraftFast({
      transcript: lessonTranscript,
      studentName: "堂林 徹生",
      teacherName: "PARARIA Admin",
      sessionDate: "2026-03-22",
      minSummaryChars: minSummaryCharsFor("LESSON_REPORT", lessonTranscript),
      sessionType: "LESSON_REPORT",
    });
    const lessonFinalizeMs = Date.now() - lessonFinalizeStartedAt;

    const results: BenchResult[] = [
      {
        mode: "INTERVIEW",
        audioSeconds: roundSeconds(interviewTranscription.durationMs),
        sttSeconds: roundSeconds(interviewTranscription.sttWallMs),
        finalizeSeconds: roundSeconds(interviewFinalizeMs),
        totalSeconds: roundSeconds(interviewTranscription.sttWallMs + interviewFinalizeMs),
        splitChunkCount: interviewTranscription.chunkCount,
        promptInputTokensEstimate: interviewDraft.inputTokensEstimate,
        outputTokensEstimate: estimateTokens(interviewDraft.summaryMarkdown),
        summaryChars: interviewDraft.summaryMarkdown.length,
      },
      {
        mode: "LESSON_REPORT",
        audioSeconds: roundSeconds(lessonCheckInManifest.totalDurationMs + lessonCheckOutManifest.totalDurationMs),
        sttSeconds: roundSeconds(lessonSttMs),
        finalizeSeconds: roundSeconds(lessonFinalizeMs),
        totalSeconds: roundSeconds(lessonSttMs + lessonFinalizeMs),
        splitChunkCount: `${lessonCheckInTranscription.chunkCount}+${lessonCheckOutTranscription.chunkCount}`,
        promptInputTokensEstimate: lessonDraft.inputTokensEstimate,
        outputTokensEstimate: estimateTokens(lessonDraft.summaryMarkdown),
        summaryChars: lessonDraft.summaryMarkdown.length,
      },
    ];

    console.log(JSON.stringify(results, null, 2));
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function readManifest(filePath: string): Manifest {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Manifest;
}

function roundSeconds(durationMs: number) {
  return Math.round((durationMs / 1000) * 10) / 10;
}

function readClampedEnvInt(names: string[], fallback: number, min: number, max: number) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    return Math.max(min, Math.min(max, Math.floor(value)));
  }
  return Math.max(min, Math.min(max, Math.floor(fallback)));
}

function minSummaryCharsFor(sessionType: "INTERVIEW" | "LESSON_REPORT", sourceText: string) {
  if (sessionType === "LESSON_REPORT") {
    if (sourceText.length >= 12000) return 760;
    if (sourceText.length <= 2500) return 520;
    return 640;
  }
  if (sourceText.length >= 12000) return 560;
  if (sourceText.length <= 2500) return 380;
  return 480;
}

async function concatChunks(ffmpegPath: string, inputPaths: string[], outputPath: string, workDir: string) {
  const concatFilePath = path.join(workDir, `${path.basename(outputPath)}.txt`);
  const lines = inputPaths.map((inputPath) => `file '${inputPath.replace(/'/g, "'\\''")}'`);
  await fsp.writeFile(concatFilePath, lines.join("\n"), "utf8");

  await runCommand(ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFilePath,
    "-c",
    "copy",
    outputPath,
  ]);
}

async function runCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `Command failed with code ${code}`));
    });
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function offsetSegments(
  segments: Array<{ start?: number; end?: number; text?: string; speaker?: string }>,
  offsetMs: number
) {
  const offsetSeconds = offsetMs / 1000;
  return segments.map((segment) => ({
    ...segment,
    start: typeof segment.start === "number" ? segment.start + offsetSeconds : segment.start,
    end: typeof segment.end === "number" ? segment.end + offsetSeconds : segment.end,
  }));
}

async function transcribeFile(args: {
  audioPath: string;
  fileSplitMinSeconds: number;
  fileSplitChunkSeconds: number;
  fileSplitConcurrency: number;
  splitAudioIntoChunks: (inputPath: string, targetDir: string, segmentSeconds: number) => Promise<string[]>;
  cleanupChunkDirectory: (targetDir: string) => Promise<void>;
  getAudioDurationMs: (filePath: string) => Promise<number>;
  guessAudioMimeType: (filePath: string) => string;
  preprocessTranscript: (rawText: string) => { rawTextOriginal: string; rawTextCleaned: string };
  preprocessTranscriptWithSegments: (
    rawText: string,
    segments: Array<{ start?: number; end?: number; text?: string; speaker?: string }>
  ) => { rawTextOriginal: string; rawTextCleaned: string };
  transcribeAudioForPipeline: (input: {
    buffer: Buffer;
    filename?: string;
    mimeType?: string;
    language?: string;
  }) => Promise<{
    rawTextOriginal: string;
    segments: Array<{ start?: number; end?: number; text?: string; speaker?: string }>;
    meta: Record<string, unknown>;
  }>;
}): Promise<TranscribeResult> {
  const durationMs = await args.getAudioDurationMs(args.audioPath);
  const shouldSplit = durationMs / 1000 >= args.fileSplitMinSeconds;
  const startedAt = Date.now();

  if (!shouldSplit) {
    const buffer = await fsp.readFile(args.audioPath);
    const stt = await args.transcribeAudioForPipeline({
      buffer,
      filename: path.basename(args.audioPath),
      mimeType: args.guessAudioMimeType(args.audioPath),
      language: "ja",
    });
    const pre =
      stt.segments.length > 0
        ? args.preprocessTranscriptWithSegments(stt.rawTextOriginal, stt.segments)
        : args.preprocessTranscript(stt.rawTextOriginal);
    return {
      transcript: pre.rawTextCleaned || pre.rawTextOriginal,
      durationMs,
      sttWallMs: Date.now() - startedAt,
      chunkCount: 1,
    };
  }

  const chunkDir = `${args.audioPath}.bench-chunks`;
  const chunkPaths = await args.splitAudioIntoChunks(args.audioPath, chunkDir, args.fileSplitChunkSeconds);
  const chunkDurations = await Promise.all(chunkPaths.map((chunkPath) => args.getAudioDurationMs(chunkPath)));
  const offsetsMs: number[] = [];
  let cursorMs = 0;
  for (const chunkDuration of chunkDurations) {
    offsetsMs.push(cursorMs);
    cursorMs += chunkDuration;
  }

  try {
    const results = await mapWithConcurrency(chunkPaths, args.fileSplitConcurrency, async (chunkPath, index) => {
      const buffer = await fsp.readFile(chunkPath);
      const stt = await args.transcribeAudioForPipeline({
        buffer,
        filename: path.basename(chunkPath),
        mimeType: args.guessAudioMimeType(chunkPath),
        language: "ja",
      });
      const rawSegments = offsetSegments(stt.segments ?? [], offsetsMs[index] ?? 0);
      const pre =
        rawSegments.length > 0
          ? args.preprocessTranscriptWithSegments(stt.rawTextOriginal, rawSegments)
          : args.preprocessTranscript(stt.rawTextOriginal);
      return {
        rawTextOriginal: pre.rawTextOriginal,
        rawSegments,
      };
    });

    const combinedOriginal = results
      .map((result) => String(result.rawTextOriginal ?? "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    const combinedSegments = results.flatMap((result) => result.rawSegments);
    const pre =
      combinedSegments.length > 0
        ? args.preprocessTranscriptWithSegments(combinedOriginal, combinedSegments)
        : args.preprocessTranscript(combinedOriginal);

    return {
      transcript: pre.rawTextCleaned || pre.rawTextOriginal,
      durationMs,
      sttWallMs: Date.now() - startedAt,
      chunkCount: chunkPaths.length,
    };
  } finally {
    await args.cleanupChunkDirectory(chunkDir);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
