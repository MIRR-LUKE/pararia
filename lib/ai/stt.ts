type TranscribeInput = {
  buffer: Buffer;
  filename?: string;
  mimeType?: string;
  language?: string;
};

const STT_MODEL = process.env.STT_MODEL || "gpt-4o-transcribe";
const STT_FALLBACK_MODEL = process.env.STT_FALLBACK_MODEL || "gpt-4o-mini-transcribe";
const STT_DETAILED_MODEL = process.env.STT_DETAILED_MODEL || "gpt-4o-transcribe-diarize";
const STT_CORE_RESPONSE_FORMAT = (process.env.STT_CORE_RESPONSE_FORMAT || "text") as SttResponseFormat;

export type WhisperVerboseSegment = {
  id?: number | string;
  seek?: number;
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
};

export type WhisperVerboseResult = {
  rawTextOriginal: string;
  segments: WhisperVerboseSegment[];
};

export type PipelineTranscriptionResult = WhisperVerboseResult & {
  meta: {
    model: string;
    responseFormat: SttResponseFormat;
    fallbackUsed: boolean;
  };
};

type SttResponseFormat = "json" | "text" | "verbose_json" | "diarized_json";

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

function getFallbackTimeoutMs(bufferSize: number) {
  const fileSizeMB = bufferSize / (1024 * 1024);
  return Math.min(Math.max(45000, fileSizeMB * 12000), 90000);
}

function isDiarizeModel(model: string) {
  return /gpt-4o-transcribe-diarize/i.test(model);
}

function isGpt4oTranscribeModel(model: string) {
  return /gpt-4o(?:-mini)?-transcribe/i.test(model);
}

function getPreferredVerboseFormat(model: string): SttResponseFormat {
  if (isDiarizeModel(model)) return "diarized_json";
  if (isGpt4oTranscribeModel(model)) return "json";
  return "verbose_json";
}

function buildTranscriptionForm(
  input: TranscribeInput,
  model: string,
  options?: { responseFormat?: SttResponseFormat }
) {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(input.buffer)], {
    type: input.mimeType || "application/octet-stream",
  });
  form.append("file", blob, input.filename || "audio.webm");
  form.append("model", model);
  form.append("language", input.language || "ja");

  if (options?.responseFormat) {
    form.append("response_format", options.responseFormat);
  }

  if (isGpt4oTranscribeModel(model) || isDiarizeModel(model)) {
    form.append("chunking_strategy", "auto");
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

function normalizeSegments(data: {
  segments?: Array<Record<string, unknown>>;
  text?: string;
}): WhisperVerboseSegment[] {
  if (!Array.isArray(data.segments)) return [];

  return data.segments
    .map((segment) => ({
      id:
        typeof segment.id === "number" || typeof segment.id === "string"
          ? segment.id
          : undefined,
      seek: typeof segment.seek === "number" ? segment.seek : undefined,
      start: typeof segment.start === "number" ? segment.start : undefined,
      end: typeof segment.end === "number" ? segment.end : undefined,
      text: typeof segment.text === "string" ? segment.text : undefined,
      speaker: typeof segment.speaker === "string" ? segment.speaker : undefined,
    }))
    .filter((segment) => Boolean(segment.text?.trim()));
}

async function transcribeAttempt(args: {
  input: TranscribeInput;
  model: string;
  responseFormat: SttResponseFormat;
  timeoutMs: number;
}) {
  const data = (await callTranscriptionApi(
    buildTranscriptionForm(args.input, args.model, { responseFormat: args.responseFormat }),
    args.timeoutMs
  )) as {
    text?: string;
    segments?: Array<Record<string, unknown>>;
  };

  const segments = normalizeSegments(data);
  const rawTextOriginal =
    (typeof data.text === "string" ? data.text : segments.map((segment) => segment.text).join(" ")).trim();

  if (!rawTextOriginal) {
    throw new Error("STT returned an empty transcript.");
  }

  return {
    rawTextOriginal,
    segments,
    meta: {
      model: args.model,
      responseFormat: args.responseFormat,
      fallbackUsed: false,
    },
  };
}

function shouldRetryWithFallback(error: unknown) {
  const message = String((error as any)?.message ?? "");
  if (/timed out/i.test(message)) return true;

  const payload = tryParseErrorPayload(message);
  const statusMatch = message.match(/STT failed \((\d+)\)/i);
  const statusCode = statusMatch ? Number(statusMatch[1]) : null;

  if (statusCode !== null && statusCode >= 500) return true;
  if (payload?.error?.param === "response_format") return true;
  if (payload?.error?.code === "unsupported_value") return true;
  return false;
}

export async function transcribeAudio({
  buffer,
  filename = "audio.webm",
  mimeType = "audio/webm",
  language = "ja",
}: TranscribeInput): Promise<string> {
  const result = await transcribeAttempt({
    input: { buffer, filename, mimeType, language },
    model: STT_MODEL,
    responseFormat: STT_CORE_RESPONSE_FORMAT,
    timeoutMs: getPrimaryTimeoutMs(buffer.length),
  });
  return result.rawTextOriginal;
}

export async function transcribeAudioForPipeline(input: TranscribeInput): Promise<PipelineTranscriptionResult> {
  try {
    return await transcribeAttempt({
      input,
      model: STT_MODEL,
      responseFormat: STT_CORE_RESPONSE_FORMAT,
      timeoutMs: getPrimaryTimeoutMs(input.buffer.length),
    });
  } catch (error) {
    if (!shouldRetryWithFallback(error)) {
      throw error;
    }

    const fallback = await transcribeAttempt({
      input,
      model: STT_FALLBACK_MODEL,
      responseFormat: "text",
      timeoutMs: getFallbackTimeoutMs(input.buffer.length),
    });

    return {
      ...fallback,
      segments: [],
      meta: {
        ...fallback.meta,
        fallbackUsed: true,
      },
    };
  }
}

export async function transcribeAudioVerbose(input: TranscribeInput): Promise<WhisperVerboseResult> {
  const preferredFormat = getPreferredVerboseFormat(STT_DETAILED_MODEL);

  try {
    const data = await transcribeAttempt({
      input,
      model: STT_DETAILED_MODEL,
      responseFormat: preferredFormat,
      timeoutMs: getPrimaryTimeoutMs(input.buffer.length),
    });

    return {
      rawTextOriginal: data.rawTextOriginal,
      segments: data.segments,
    };
  } catch (error: any) {
    const message = String(error?.message ?? "");
    const payload = tryParseErrorPayload(message);
    const responseFormatUnsupported =
      /response_format/i.test(message) ||
      payload?.error?.param === "response_format" ||
      payload?.error?.code === "unsupported_value";

    if (!responseFormatUnsupported || preferredFormat === "json") {
      throw error;
    }

    const fallback = await transcribeAttempt({
      input,
      model: STT_DETAILED_MODEL,
      responseFormat: "json",
      timeoutMs: getPrimaryTimeoutMs(input.buffer.length),
    });

    return {
      rawTextOriginal: fallback.rawTextOriginal,
      segments: fallback.segments,
    };
  }
}
