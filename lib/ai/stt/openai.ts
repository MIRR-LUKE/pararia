import { readFile, stat } from "node:fs/promises";
import { cleanupAudioChunkDirectory, getAudioDurationSeconds, splitAudioForParallelTranscription } from "@/lib/audio-processing";
import { getRuntimePath } from "@/lib/runtime-paths";
import { materializeInputFile } from "./input";
import type { PipelineTranscriptionResult, TranscribeInput } from "./types";

const OPENAI_AUDIO_TRANSCRIPT_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_AUDIO_TRANSCRIPT_MAX_BYTES = 25 * 1024 * 1024;
const OPENAI_AUDIO_TRANSCRIPT_TARGET_BYTES = 23 * 1024 * 1024;
const OPENAI_AUDIO_TRANSCRIPT_MAX_SECONDS = 1400;
const OPENAI_AUDIO_TRANSCRIPT_TARGET_SECONDS = 1320;

function readOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || process.env.LLM_API_KEY?.trim() || "";
}

function readOpenAiTranscriptionModel() {
  return process.env.OPENAI_STT_MODEL?.trim() || process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "gpt-4o-transcribe";
}

function readOpenAiTranscriptionTimeoutMs() {
  const parsed = Number(process.env.OPENAI_STT_TIMEOUT_MS ?? 180_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.floor(parsed)) : 180_000;
}

async function postOpenAiTranscription(input: {
  filePath: string;
  fileName: string;
  mimeType: string;
  language: string;
  model: string;
  timeoutMs: number;
}) {
  const apiKey = readOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY (or LLM_API_KEY) is not set for OpenAI STT fallback.");
  }

  const buffer = await readFile(input.filePath);
  return postOpenAiTranscriptionFromBytes({
    bytes: buffer,
    ...input,
    apiKey,
  });
}

async function postOpenAiTranscriptionFromBytes(input: {
  bytes: Buffer;
  fileName: string;
  filePath: string;
  mimeType: string;
  language: string;
  model: string;
  timeoutMs: number;
  apiKey: string;
}) {
  const formData = new FormData();
  formData.set("model", input.model);
  formData.set("language", input.language);
  formData.set(
    "file",
    new File([new Uint8Array(input.bytes)], input.fileName, {
      type: input.mimeType || "application/octet-stream",
    })
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(OPENAI_AUDIO_TRANSCRIPT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI transcription failed: ${response.status} ${bodyText}`);
    }

    if (!contentType.includes("application/json")) {
      return {
        text: bodyText.trim(),
        attempts: 1,
      };
    }

    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    return {
      text: typeof parsed.text === "string" ? parsed.text.trim() : "",
      attempts: 1,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildOpenAiChunkSeconds(fileSizeBytes: number, durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  const bytesPerSecond = fileSizeBytes / durationSeconds;
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return 0;
  const estimated = Math.floor(OPENAI_AUDIO_TRANSCRIPT_TARGET_BYTES / bytesPerSecond);
  const cappedByApi = Math.min(
    estimated,
    OPENAI_AUDIO_TRANSCRIPT_TARGET_SECONDS,
    OPENAI_AUDIO_TRANSCRIPT_MAX_SECONDS
  );
  return Math.max(30, cappedByApi);
}

async function transcribeLargeAudioViaChunks(input: {
  audioPath: string;
  filename: string;
  mimeType: string;
  language: string;
  fileSizeBytes: number;
  model: string;
  timeoutMs: number;
}) {
  const durationSeconds = await getAudioDurationSeconds(input.audioPath).catch(() => 0);
  const chunkSeconds = buildOpenAiChunkSeconds(input.fileSizeBytes, durationSeconds);
  if (chunkSeconds <= 0) {
    throw new Error(
      `audio file is too large for OpenAI STT fallback (${Math.round(input.fileSizeBytes / 1024 / 1024)} MiB) and could not be chunked safely`
    );
  }

  const chunkDir = getRuntimePath("temp", "openai-stt-chunks", String(Date.now()));
  const split = await splitAudioForParallelTranscription(input.audioPath, chunkDir, {
    chunkSeconds,
    overlapSeconds: 0,
  });

  try {
    const texts: string[] = [];
    for (const chunk of split.chunks) {
      const chunkResult = await postOpenAiTranscription({
        filePath: chunk.filePath,
        fileName: `${chunk.index}-${input.filename || "audio.m4a"}`,
        mimeType: "audio/mp4",
        language: input.language,
        model: input.model,
        timeoutMs: input.timeoutMs,
      });
      if (chunkResult.text) {
        texts.push(chunkResult.text);
      }
    }
    return {
      text: texts.join("\n").trim(),
      attempts: split.chunks.length,
    };
  } finally {
    await cleanupAudioChunkDirectory(chunkDir).catch(() => {});
  }
}

export async function transcribeAudioWithOpenAiForPipeline(
  input: TranscribeInput
): Promise<PipelineTranscriptionResult> {
  const file = await materializeInputFile(input);
  const model = readOpenAiTranscriptionModel();
  const timeoutMs = readOpenAiTranscriptionTimeoutMs();
  const startedAt = Date.now();

  try {
    const fileStats = await stat(file.audioPath);
    const singleResult =
      fileStats.size <= OPENAI_AUDIO_TRANSCRIPT_MAX_BYTES
        ? await postOpenAiTranscription({
            filePath: file.audioPath,
            fileName: input.filename || "audio.webm",
            mimeType: input.mimeType || "audio/webm",
            language: input.language || "ja",
            model,
            timeoutMs,
          })
        : await transcribeLargeAudioViaChunks({
            audioPath: file.audioPath,
            filename: input.filename || "audio.webm",
            mimeType: input.mimeType || "audio/webm",
            language: input.language || "ja",
            fileSizeBytes: fileStats.size,
            model,
            timeoutMs,
          });
    const text = singleResult.text;

    if (!text) {
      throw new Error("OpenAI STT fallback returned an empty transcript.");
    }

    return {
      rawTextOriginal: text,
      segments: [],
      meta: {
        model: `openai:${model}`,
        responseFormat: "json",
        recoveryUsed: false,
        fallbackUsed: true,
        attemptCount: singleResult.attempts ?? 1,
        segmentCount: 0,
        speakerCount: 0,
        qualityWarnings: [],
        device: "openai",
        pipeline: "openai-api",
        transcribeElapsedMs: Date.now() - startedAt,
      },
    };
  } finally {
    await file.cleanup().catch(() => {});
  }
}
