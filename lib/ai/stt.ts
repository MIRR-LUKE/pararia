type TranscribeInput = {
  buffer: Buffer;
  filename?: string;
  mimeType?: string;
  language?: string;
  knownSpeakerSamples?: Array<{ name: string; referenceDataUrl: string }>;
};

const STT_MODEL = "gpt-4o-transcribe-diarize";
const STT_RESPONSE_FORMAT = "diarized_json" as const;
const STT_CHUNKING_STRATEGY = "auto" as const;

export type TranscriptSegment = {
  id?: number | string;
  seek?: number;
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
};

export type SegmentedTranscriptResult = {
  rawTextOriginal: string;
  segments: TranscriptSegment[];
};

export type PipelineTranscriptionResult = SegmentedTranscriptResult & {
  meta: {
    model: string;
    responseFormat: SttResponseFormat;
    recoveryUsed: boolean;
    attemptCount: number;
    segmentCount: number;
    speakerCount: number;
    qualityWarnings: TranscriptQualityWarning[];
  };
};

type SttResponseFormat = typeof STT_RESPONSE_FORMAT;
export type TranscriptQualityWarning =
  | "missing_speaker_labels"
  | "single_speaker_detected"
  | "too_many_short_segments"
  | "adjacent_duplicates_removed";

function getApiKey() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.STT_API_KEY || "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY or STT_API_KEY is required.");
  }
  return apiKey;
}

function getPrimaryTimeoutMs(bufferSize: number) {
  const fileSizeMB = bufferSize / (1024 * 1024);
  return Math.min(Math.max(60000, fileSizeMB * 15000), 120000);
}

function buildTranscriptionForm(input: TranscribeInput, model: string) {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(input.buffer)], {
    type: input.mimeType || "application/octet-stream",
  });
  form.append("file", blob, input.filename || "audio.webm");
  form.append("model", model);
  form.append("language", input.language || "ja");
  form.append("response_format", STT_RESPONSE_FORMAT);
  form.append("chunking_strategy", STT_CHUNKING_STRATEGY);

  for (const sample of input.knownSpeakerSamples ?? []) {
    if (!sample?.name?.trim() || !sample?.referenceDataUrl?.trim()) continue;
    form.append("known_speaker_names[]", sample.name.trim());
    form.append("known_speaker_references[]", sample.referenceDataUrl.trim());
  }

  return form;
}

function tryParseErrorPayload(text: string) {
  try {
    return JSON.parse(text) as {
      error?: {
        message?: string;
        param?: string;
        code?: string;
      };
    };
  } catch {
    return null;
  }
}

async function callTranscriptionApi(form: FormData, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: form,
      signal: controller.signal,
    });

    const contentType = res.headers.get("content-type") || "";
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail: unknown = text || res.statusText;
      try {
        detail = text ? JSON.parse(text) : { error: res.statusText };
      } catch {
        // keep raw text
      }
      throw new Error(`STT failed (${res.status}): ${JSON.stringify(detail)}`);
    }

    if (/application\/json/i.test(contentType)) {
      return res.json();
    }

    const text = await res.text();
    return { text };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("Speech-to-text timed out. Try a shorter file or retry later.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeSegmentText(text: unknown) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

function comparableSegmentText(text: string) {
  return text.replace(/[\s、。,，．！？!?\-ー〜～]/g, "");
}

function joinSegmentText(left: string, right: string) {
  if (!left) return right;
  if (!right) return left;
  if (/[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)) {
    return `${left} ${right}`.trim();
  }
  return `${left}${right}`.trim();
}

function pickSpeakerLabel(left?: string, right?: string) {
  const a = typeof left === "string" && left.trim() ? left.trim() : "";
  const b = typeof right === "string" && right.trim() ? right.trim() : "";
  return a || b || undefined;
}

function buildRawTextFromSegments(segments: TranscriptSegment[]) {
  const lines: string[] = [];
  let previousSpeaker: string | undefined;
  let buffer = "";

  const flush = () => {
    const next = buffer.trim();
    if (next) lines.push(next);
    buffer = "";
  };

  for (const segment of segments) {
    const text = normalizeSegmentText(segment.text);
    if (!text) continue;
    const speaker = typeof segment.speaker === "string" ? segment.speaker.trim() : undefined;
    if (buffer && previousSpeaker && speaker && previousSpeaker === speaker) {
      buffer = joinSegmentText(buffer, text);
    } else {
      flush();
      buffer = text;
    }
    previousSpeaker = speaker;
  }

  flush();
  return lines.join("\n").trim();
}

function normalizeSegments(data: {
  segments?: Array<Record<string, unknown>>;
  text?: string;
}): {
  segments: TranscriptSegment[];
  speakerCount: number;
  qualityWarnings: TranscriptQualityWarning[];
  removedDuplicateCount: number;
} {
  if (!Array.isArray(data.segments)) {
    return {
      segments: [],
      speakerCount: 0,
      qualityWarnings: [],
      removedDuplicateCount: 0,
    };
  }

  const mapped = data.segments
    .map((segment) => ({
      id:
        typeof segment.id === "number" || typeof segment.id === "string"
          ? segment.id
          : undefined,
      seek: typeof segment.seek === "number" ? segment.seek : undefined,
      start: typeof segment.start === "number" ? segment.start : undefined,
      end: typeof segment.end === "number" ? segment.end : undefined,
      text: normalizeSegmentText(segment.text),
      speaker: typeof segment.speaker === "string" ? segment.speaker.trim() || undefined : undefined,
    }))
    .filter((segment) => Boolean(segment.text));

  const merged: TranscriptSegment[] = [];
  let removedDuplicateCount = 0;

  for (const current of mapped) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(current);
      continue;
    }

    const previousComparable = comparableSegmentText(previous.text ?? "");
    const currentComparable = comparableSegmentText(current.text ?? "");
    const gap =
      typeof previous.end === "number" && typeof current.start === "number"
        ? current.start - previous.end
        : null;
    const sameSpeaker =
      previous.speaker &&
      current.speaker &&
      previous.speaker === current.speaker;
    const exactDuplicate =
      previousComparable.length > 0 &&
      previousComparable === currentComparable &&
      (gap === null || gap <= 1.2);
    const overlapDuplicate =
      sameSpeaker &&
      previousComparable.length > 8 &&
      currentComparable.length > 8 &&
      (previousComparable.includes(currentComparable) || currentComparable.includes(previousComparable)) &&
      (gap === null || gap <= 0.8);
    const shortContinuation =
      sameSpeaker &&
      gap !== null &&
      gap >= 0 &&
      gap <= 0.35 &&
      currentComparable.length > 0 &&
      currentComparable.length <= 12 &&
      !/[。！？!?]$/.test(previous.text ?? "");

    if (exactDuplicate || overlapDuplicate) {
      const richerText =
        (current.text?.length ?? 0) > (previous.text?.length ?? 0) ? current.text : previous.text;
      merged[merged.length - 1] = {
        ...previous,
        end: typeof current.end === "number" ? current.end : previous.end,
        text: richerText,
        speaker: pickSpeakerLabel(previous.speaker, current.speaker),
      };
      removedDuplicateCount += 1;
      continue;
    }

    if (shortContinuation) {
      merged[merged.length - 1] = {
        ...previous,
        end: typeof current.end === "number" ? current.end : previous.end,
        text: joinSegmentText(previous.text ?? "", current.text ?? ""),
        speaker: pickSpeakerLabel(previous.speaker, current.speaker),
      };
      continue;
    }

    merged.push(current);
  }

  const speakerCount = new Set(
    merged
      .map((segment) => (typeof segment.speaker === "string" ? segment.speaker.trim() : ""))
      .filter(Boolean)
  ).size;
  const shortSegmentRatio =
    merged.length > 0
      ? merged.filter((segment) => comparableSegmentText(segment.text ?? "").length <= 4).length / merged.length
      : 0;

  const qualityWarnings: TranscriptQualityWarning[] = [];
  if (speakerCount === 0 && merged.length > 0) qualityWarnings.push("missing_speaker_labels");
  if (speakerCount === 1 && merged.length >= 6) qualityWarnings.push("single_speaker_detected");
  if (shortSegmentRatio >= 0.55 && merged.length >= 8) qualityWarnings.push("too_many_short_segments");
  if (removedDuplicateCount > 0) qualityWarnings.push("adjacent_duplicates_removed");

  return {
    segments: merged,
    speakerCount,
    qualityWarnings,
    removedDuplicateCount,
  };
}

async function transcribeAttempt(args: {
  input: TranscribeInput;
  model: string;
  timeoutMs: number;
}) {
  const data = (await callTranscriptionApi(
    buildTranscriptionForm(args.input, args.model),
    args.timeoutMs
  )) as {
    text?: string;
    segments?: Array<Record<string, unknown>>;
  };

  const normalized = normalizeSegments(data);
  const segments = normalized.segments;
  const rawTextOriginal =
    (buildRawTextFromSegments(segments) ||
      (typeof data.text === "string" ? normalizeSegmentText(data.text) : ""))
      .trim();

  if (!rawTextOriginal) {
    throw new Error("STT returned an empty transcript.");
  }

  return {
    rawTextOriginal,
    segments,
    meta: {
      model: args.model,
      responseFormat: STT_RESPONSE_FORMAT,
      recoveryUsed: false,
      attemptCount: 1,
      segmentCount: segments.length,
      speakerCount: normalized.speakerCount,
      qualityWarnings: normalized.qualityWarnings,
    },
  };
}

function shouldRetryStt(error: unknown) {
  const message = String((error as any)?.message ?? "");
  if (/timed out/i.test(message)) return true;

  const payload = tryParseErrorPayload(message);
  const statusMatch = message.match(/STT failed \((\d+)\)/i);
  const statusCode = statusMatch ? Number(statusMatch[1]) : null;

  if (statusCode !== null && statusCode >= 500) return true;
  if (statusCode === 429) return true;
  if (payload?.error?.code === "rate_limit_exceeded") return true;
  return false;
}

export async function transcribeAudio({
  buffer,
  filename = "audio.webm",
  mimeType = "audio/webm",
  language = "ja",
}: TranscribeInput): Promise<string> {
  const result = await transcribeAudioForPipeline({ buffer, filename, mimeType, language });
  return result.rawTextOriginal;
}

export async function transcribeAudioForPipeline(input: TranscribeInput): Promise<PipelineTranscriptionResult> {
  try {
    return await transcribeAttempt({
      input,
      model: STT_MODEL,
      timeoutMs: getPrimaryTimeoutMs(input.buffer.length),
    });
  } catch (error) {
    if (!shouldRetryStt(error)) {
      throw error;
    }

    const recovered = await transcribeAttempt({
      input,
      model: STT_MODEL,
      timeoutMs: getPrimaryTimeoutMs(input.buffer.length),
    });

    return {
      ...recovered,
      meta: {
        ...recovered.meta,
        recoveryUsed: true,
        attemptCount: 2,
      },
    };
  }
}
