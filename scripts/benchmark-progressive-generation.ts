#!/usr/bin/env tsx

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { parseFile } from "music-metadata";
import {
  ConversationSourceType,
  SessionPartStatus,
  SessionPartType,
  SessionType,
} from "@prisma/client";
import {
  appendLiveTranscriptionChunk,
  finalizeLiveTranscriptionPart,
  startLiveChunkTranscription,
} from "../lib/live-session-transcription";
import { transcribeAudioForPipeline } from "../lib/ai/stt";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "../lib/transcript/preprocess";
import { buildSessionTranscript } from "../lib/session-service";
import {
  generateConversationArtifactsSinglePass,
  getPromptVersion,
} from "../lib/ai/conversationPipeline";

const desktopDir = "C:\\Users\\lukew\\Desktop";
const checkInPath = path.join(desktopDir, "3-22________________.m4a");
const checkOutPath = path.join(desktopDir, "3-22________________-1.m4a");
const outputDir = path.join(process.cwd(), ".tmp", "progressive-benchmarks");
const tmpRoot = path.join(os.tmpdir(), "pararia-progressive-benchmarks");
const interviewChunkSeconds = 15;
const lessonChunkSeconds = 8;

function assertFfmpeg() {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static is unavailable.");
  }
  return ffmpegPath;
}

function extToMime(filePath: string) {
  return /\.m4a$/i.test(filePath) || /\.mp4$/i.test(filePath) ? "audio/mp4" : "audio/webm";
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(assertFfmpeg(), args, { stdio: ["ignore", "ignore", "pipe"] });
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
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

async function concatAudio(inputs: string[], outputPath: string) {
  if (inputs.length < 2) {
    throw new Error("concatAudio requires at least two inputs");
  }
  const args = ["-y"];
  for (const input of inputs) {
    args.push("-i", input);
  }
  args.push(
    "-filter_complex",
    `${inputs.map((_, index) => `[${index}:a]`).join("")}concat=n=${inputs.length}:v=0:a=1[out]`,
    "-map",
    "[out]",
    outputPath
  );
  await runFfmpeg(args);
}

async function splitAudio(inputPath: string, targetDir: string, segmentSeconds: number) {
  await mkdir(targetDir, { recursive: true });
  try {
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      String(segmentSeconds),
      "-reset_timestamps",
      "1",
      "-c",
      "copy",
      path.join(targetDir, "chunk-%03d.m4a"),
    ]);
  } catch {
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      String(segmentSeconds),
      "-reset_timestamps",
      "1",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      path.join(targetDir, "chunk-%03d.m4a"),
    ]);
  }
}

async function listChunks(targetDir: string) {
  const entries = await (await import("node:fs/promises")).readdir(targetDir);
  return entries
    .filter((name) => /^chunk-\d+\./.test(name))
    .sort()
    .map((name) => path.join(targetDir, name));
}

async function getAudioDurationMs(filePath: string) {
  const metadata = await parseFile(filePath);
  return Math.max(0, Math.round((metadata.format.duration ?? 0) * 1000));
}

async function transcribeFullAudio(filePath: string) {
  const buffer = await readFile(filePath);
  const stt = await transcribeAudioForPipeline({
    buffer,
    filename: path.basename(filePath),
    mimeType: extToMime(filePath),
    language: "ja",
  });
  const pre =
    stt.segments.length > 0
      ? preprocessTranscriptWithSegments(stt.rawTextOriginal, stt.segments ?? [])
      : preprocessTranscript(stt.rawTextOriginal);
  return {
    pre,
    stt,
  };
}

async function generateInterviewFromTranscript(transcript: string) {
  return generateConversationArtifactsSinglePass({
    transcript,
    studentName: "堂林 徹生",
    teacherName: "PARARIA Admin",
    sessionDate: "2026-03-22",
    minSummaryChars: 700,
    minTimelineSections: 2,
    sessionType: "INTERVIEW",
  });
}

async function generateLessonFromTranscript(transcript: string) {
  return generateConversationArtifactsSinglePass({
    transcript,
    studentName: "堂林 徹生",
    teacherName: "PARARIA Admin",
    sessionDate: "2026-03-22",
    minSummaryChars: 900,
    minTimelineSections: 3,
    sessionType: "LESSON_REPORT",
  });
}

async function benchmarkInterview(interviewAudioPath: string) {
  console.log("[interview] baseline start");
  const baselineStart = Date.now();
  const baselineStt = await transcribeFullAudio(interviewAudioPath);
  const baselineTranscript = buildSessionTranscript(SessionType.INTERVIEW, [
    {
      id: "full",
      partType: SessionPartType.FULL,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.AUDIO,
      rawTextOriginal: baselineStt.pre.rawTextOriginal,
      rawTextCleaned: baselineStt.pre.rawTextCleaned,
      rawSegments: baselineStt.stt.segments,
    },
  ]);
  const baselineGeneration = await generateInterviewFromTranscript(baselineTranscript);
  const baselineElapsedMs = Date.now() - baselineStart;
  console.log("[interview] baseline done");

  const sessionId = `bench-interview-${Date.now()}`;
  const chunkDir = path.join(tmpRoot, sessionId);
  await splitAudio(interviewAudioPath, chunkDir, interviewChunkSeconds);
  const chunkPaths = await listChunks(chunkDir);

  let startedAtMs = 0;
  for (const [index, chunkPath] of chunkPaths.entries()) {
    if (index === chunkPaths.length - 1) break;
    const durationMs = await getAudioDurationMs(chunkPath);
    const buffer = await readFile(chunkPath);
    await appendLiveTranscriptionChunk({
      sessionId,
      partType: SessionPartType.FULL,
      sequence: index,
      fileName: path.basename(chunkPath),
      mimeType: extToMime(chunkPath),
      buffer,
      startedAtMs,
      durationMs,
    });
    await startLiveChunkTranscription(sessionId, SessionPartType.FULL, index);
    startedAtMs += durationMs;
  }

  const finalChunkPath = chunkPaths[chunkPaths.length - 1];
  const finalChunkDurationMs = await getAudioDurationMs(finalChunkPath);
  console.log("[interview] progressive stop-to-done start");
  const stopToDoneStart = Date.now();
  await appendLiveTranscriptionChunk({
    sessionId,
    partType: SessionPartType.FULL,
    sequence: chunkPaths.length - 1,
    fileName: path.basename(finalChunkPath),
    mimeType: extToMime(finalChunkPath),
    buffer: await readFile(finalChunkPath),
    startedAtMs,
    durationMs: finalChunkDurationMs,
  });
  const finalized = await finalizeLiveTranscriptionPart(sessionId, SessionPartType.FULL);
  const progressiveTranscript = buildSessionTranscript(SessionType.INTERVIEW, [
    {
      id: "full-live",
      partType: SessionPartType.FULL,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.AUDIO,
      rawTextOriginal: finalized.rawTextOriginal,
      rawTextCleaned: finalized.rawTextCleaned,
      rawSegments: finalized.rawSegments,
    },
  ]);
  const progressiveGeneration = await generateInterviewFromTranscript(progressiveTranscript);
  const stopToDoneElapsedMs = Date.now() - stopToDoneStart;
  console.log("[interview] progressive done");

  return {
    mode: "INTERVIEW" as const,
    baselineElapsedMs,
    progressiveStopToDoneMs: stopToDoneElapsedMs,
    chunkCount: chunkPaths.length,
    chunkSeconds: interviewChunkSeconds,
    baselineSummary: baselineGeneration.result.summaryMarkdown,
    progressiveSummary: progressiveGeneration.result.summaryMarkdown,
    baselineModel: baselineGeneration.model,
    progressiveModel: progressiveGeneration.model,
    progressiveApiCalls: progressiveGeneration.apiCalls,
  };
}

async function benchmarkLesson() {
  console.log("[lesson] baseline start");
  const baselineStart = Date.now();
  const [checkInBaseline, checkOutBaseline] = await Promise.all([
    transcribeFullAudio(checkInPath),
    transcribeFullAudio(checkOutPath),
  ]);
  const baselineTranscript = buildSessionTranscript(SessionType.LESSON_REPORT, [
    {
      id: "check-in",
      partType: SessionPartType.CHECK_IN,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.AUDIO,
      rawTextOriginal: checkInBaseline.pre.rawTextOriginal,
      rawTextCleaned: checkInBaseline.pre.rawTextCleaned,
      rawSegments: checkInBaseline.stt.segments,
    },
    {
      id: "check-out",
      partType: SessionPartType.CHECK_OUT,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.AUDIO,
      rawTextOriginal: checkOutBaseline.pre.rawTextOriginal,
      rawTextCleaned: checkOutBaseline.pre.rawTextCleaned,
      rawSegments: checkOutBaseline.stt.segments,
    },
  ]);
  const baselineGeneration = await generateLessonFromTranscript(baselineTranscript);
  const baselineElapsedMs = Date.now() - baselineStart;
  console.log("[lesson] baseline done");

  const sessionId = `bench-lesson-${Date.now()}`;
  const checkInDir = path.join(tmpRoot, `${sessionId}-checkin`);
  const checkOutDir = path.join(tmpRoot, `${sessionId}-checkout`);
  await splitAudio(checkInPath, checkInDir, lessonChunkSeconds);
  await splitAudio(checkOutPath, checkOutDir, lessonChunkSeconds);
  const [checkInChunks, checkOutChunks] = await Promise.all([listChunks(checkInDir), listChunks(checkOutDir)]);

  let checkInOffsetMs = 0;
  for (const [index, chunkPath] of checkInChunks.entries()) {
    const durationMs = await getAudioDurationMs(chunkPath);
    await appendLiveTranscriptionChunk({
      sessionId,
      partType: SessionPartType.CHECK_IN,
      sequence: index,
      fileName: path.basename(chunkPath),
      mimeType: extToMime(chunkPath),
      buffer: await readFile(chunkPath),
      startedAtMs: checkInOffsetMs,
      durationMs,
    });
    await startLiveChunkTranscription(sessionId, SessionPartType.CHECK_IN, index);
    checkInOffsetMs += durationMs;
  }
  const finalizedCheckIn = await finalizeLiveTranscriptionPart(sessionId, SessionPartType.CHECK_IN);

  let checkOutOffsetMs = 0;
  for (const [index, chunkPath] of checkOutChunks.entries()) {
    if (index === checkOutChunks.length - 1) break;
    const durationMs = await getAudioDurationMs(chunkPath);
    await appendLiveTranscriptionChunk({
      sessionId,
      partType: SessionPartType.CHECK_OUT,
      sequence: index,
      fileName: path.basename(chunkPath),
      mimeType: extToMime(chunkPath),
      buffer: await readFile(chunkPath),
      startedAtMs: checkOutOffsetMs,
      durationMs,
    });
    await startLiveChunkTranscription(sessionId, SessionPartType.CHECK_OUT, index);
    checkOutOffsetMs += durationMs;
  }

  const finalCheckOutChunk = checkOutChunks[checkOutChunks.length - 1];
  const finalCheckOutDurationMs = await getAudioDurationMs(finalCheckOutChunk);
  console.log("[lesson] progressive stop-to-done start");
  const stopToDoneStart = Date.now();
  await appendLiveTranscriptionChunk({
    sessionId,
    partType: SessionPartType.CHECK_OUT,
    sequence: checkOutChunks.length - 1,
    fileName: path.basename(finalCheckOutChunk),
    mimeType: extToMime(finalCheckOutChunk),
    buffer: await readFile(finalCheckOutChunk),
    startedAtMs: checkOutOffsetMs,
    durationMs: finalCheckOutDurationMs,
  });
  const finalizedCheckOut = await finalizeLiveTranscriptionPart(sessionId, SessionPartType.CHECK_OUT);
  const progressiveTranscript = buildSessionTranscript(SessionType.LESSON_REPORT, [
    {
      id: "check-in-live",
      partType: SessionPartType.CHECK_IN,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.AUDIO,
      rawTextOriginal: finalizedCheckIn.rawTextOriginal,
      rawTextCleaned: finalizedCheckIn.rawTextCleaned,
      rawSegments: finalizedCheckIn.rawSegments,
    },
    {
      id: "check-out-live",
      partType: SessionPartType.CHECK_OUT,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.AUDIO,
      rawTextOriginal: finalizedCheckOut.rawTextOriginal,
      rawTextCleaned: finalizedCheckOut.rawTextCleaned,
      rawSegments: finalizedCheckOut.rawSegments,
    },
  ]);
  const progressiveGeneration = await generateLessonFromTranscript(progressiveTranscript);
  const stopToDoneElapsedMs = Date.now() - stopToDoneStart;
  console.log("[lesson] progressive done");

  return {
    mode: "LESSON_REPORT" as const,
    baselineElapsedMs,
    progressiveStopToDoneMs: stopToDoneElapsedMs,
    checkInChunkCount: checkInChunks.length,
    checkOutChunkCount: checkOutChunks.length,
    chunkSeconds: lessonChunkSeconds,
    baselineSummary: baselineGeneration.result.summaryMarkdown,
    progressiveSummary: progressiveGeneration.result.summaryMarkdown,
    baselineModel: baselineGeneration.model,
    progressiveModel: progressiveGeneration.model,
    progressiveApiCalls: progressiveGeneration.apiCalls,
  };
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(tmpRoot, { recursive: true });

  const interviewAudioPath = path.join(tmpRoot, "interview-source.m4a");
  console.log("[setup] concatenating interview proxy audio");
  await concatAudio([checkInPath, checkOutPath], interviewAudioPath);

  const [interview, lesson] = await Promise.all([
    benchmarkInterview(interviewAudioPath),
    benchmarkLesson(),
  ]);

  const payload = {
    promptVersion: getPromptVersion(),
    generatedAt: new Date().toISOString(),
    interview,
    lesson,
  };

  await writeFile(path.join(outputDir, "latest-benchmark.json"), JSON.stringify(payload, null, 2), "utf8");
  await writeFile(path.join(outputDir, "latest-interview-summary.md"), interview.progressiveSummary, "utf8");
  await writeFile(path.join(outputDir, "latest-lesson-summary.md"), lesson.progressiveSummary, "utf8");

  console.log(JSON.stringify(payload, null, 2));

  await rm(interviewAudioPath, { force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
