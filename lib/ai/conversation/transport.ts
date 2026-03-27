import type { ChatResult } from "./types";

const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const DEFAULT_LLM_TIMEOUT_MS = clampInt(Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000), 10000, 180000);

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: unknown; refusal?: string };
    finish_reason?: string;
  }>;
};

type ResponsesApiResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  incomplete_details?: {
    reason?: string;
  };
};

function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractChatCompletionContent(data: ChatCompletionResponse) {
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") {
    return {
      contentText: content,
      finishReason: choice?.finish_reason,
      refusal: choice?.message?.refusal,
    };
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return typeof (item as { text?: unknown }).text === "string"
            ? (item as { text: string }).text
            : "";
        }
        return "";
      })
      .join("")
      .trim();
    return {
      contentText: joined || null,
      finishReason: choice?.finish_reason,
      refusal: choice?.message?.refusal,
    };
  }
  return {
    contentText: null,
    finishReason: choice?.finish_reason,
    refusal: choice?.message?.refusal,
  };
}

function extractResponsesContent(data: ResponsesApiResponse) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return {
      contentText: data.output_text.trim(),
      finishReason: data.incomplete_details?.reason,
      refusal: undefined,
    };
  }

  const message = Array.isArray(data.output)
    ? data.output.find((item) => item?.type === "message" && Array.isArray(item.content))
    : null;
  const contentText = message?.content
    ?.filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text?.trim() || "")
    .filter(Boolean)
    .join("\n")
    .trim();
  const refusal = message?.content?.find((item) => item?.type === "refusal")?.refusal;

  return {
    contentText: contentText || null,
    finishReason: data.incomplete_details?.reason,
    refusal,
  };
}

function waitForLlmRetry(attempt: number) {
  const base = Math.min(4000, 600 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 250);
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}

function isRetryableLlmStatus(status: number, raw: string) {
  if (status === 408 || status === 409 || status === 429 || status >= 500) return true;
  return /timeout|timed out|temporar|overloaded|rate limit|try again|unavailable/i.test(raw);
}

function isRetryableLlmError(error: unknown) {
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : typeof error === "string" ? error : "";
  return /abort|timeout|timed out|fetch failed|network|econnreset|etimedout|socket/i.test(message.toLowerCase());
}

async function callChatCompletions(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_completion_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
  timeoutMs?: number;
  prompt_cache_key?: string;
  prompt_cache_retention?: "in_memory" | "24h";
}): Promise<ChatResult> {
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY (or OPENAI_API_KEY) is not set.");
  }

  const timeoutMs = Math.max(10000, params.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
  let body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    ...(params.max_completion_tokens ? { max_completion_tokens: params.max_completion_tokens } : {}),
    ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
    ...(params.response_format ? { response_format: params.response_format } : {}),
    ...(params.prompt_cache_key ? { prompt_cache_key: params.prompt_cache_key } : {}),
    ...(params.prompt_cache_retention ? { prompt_cache_retention: params.prompt_cache_retention } : {}),
  };

  const requestOnce = async (requestBody: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const raw = await res.text().catch(() => "");
      return { res, raw };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const { res, raw } = await requestOnce(body);
      if (!res.ok) {
        const retryBody = { ...body };
        let changed = false;
        if (typeof retryBody.temperature === "number" && /temperature/i.test(raw) && /default|unsupported|not supported/i.test(raw)) {
          delete retryBody.temperature;
          changed = true;
        }
        if ("response_format" in retryBody && /response_format/i.test(raw)) {
          delete retryBody.response_format;
          changed = true;
        }
        if (/(prompt_cache_key|prompt_cache_retention)/i.test(raw)) {
          delete retryBody.prompt_cache_key;
          delete retryBody.prompt_cache_retention;
          changed = true;
        }
        if (changed) {
          body = retryBody;
          continue;
        }
        if (attempt < 3 && isRetryableLlmStatus(res.status, raw)) {
          await waitForLlmRetry(attempt);
          continue;
        }
        throw new Error(`LLM API failed (${res.status}): ${raw}`);
      }

      const data = tryParseJson<ChatCompletionResponse>(raw);
      if (!data) return { raw, contentText: null };
      return { raw, ...extractChatCompletionContent(data) };
    } catch (error) {
      if (attempt < 3 && isRetryableLlmError(error)) {
        await waitForLlmRetry(attempt);
        continue;
      }
      throw error;
    }
  }

  throw new Error("LLM API retry budget exceeded.");
}

function toResponsesPromptCacheRetention(retention?: "in_memory" | "24h") {
  if (retention === "24h") return "24h";
  if (retention === "in_memory") return "in-memory";
  return undefined;
}

async function callResponsesApi(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_output_tokens?: number;
  timeoutMs?: number;
  prompt_cache_key?: string;
  prompt_cache_retention?: "in_memory" | "24h";
  verbosity?: "low" | "medium" | "high";
}): Promise<ChatResult> {
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY (or OPENAI_API_KEY) is not set.");
  }

  const timeoutMs = Math.max(10000, params.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
  let body: Record<string, unknown> = {
    model: params.model,
    input: params.messages,
    store: false,
    reasoning: { effort: "none" },
    text: {
      format: { type: "text" },
      ...(params.verbosity ? { verbosity: params.verbosity } : {}),
    },
    ...(params.max_output_tokens ? { max_output_tokens: params.max_output_tokens } : {}),
    ...(params.prompt_cache_key ? { prompt_cache_key: params.prompt_cache_key } : {}),
    ...(toResponsesPromptCacheRetention(params.prompt_cache_retention)
      ? { prompt_cache_retention: toResponsesPromptCacheRetention(params.prompt_cache_retention) }
      : {}),
  };

  const requestOnce = async (requestBody: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const raw = await res.text().catch(() => "");
      return { res, raw };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const { res, raw } = await requestOnce(body);
      if (!res.ok) {
        const retryBody = { ...body };
        let changed = false;
        if (/(prompt_cache_key|prompt_cache_retention)/i.test(raw)) {
          delete retryBody.prompt_cache_key;
          delete retryBody.prompt_cache_retention;
          changed = true;
        }
        if (/verbosity/i.test(raw)) {
          const nextText =
            retryBody.text && typeof retryBody.text === "object" && !Array.isArray(retryBody.text)
              ? { ...(retryBody.text as Record<string, unknown>) }
              : {};
          delete nextText.verbosity;
          retryBody.text = nextText;
          changed = true;
        }
        if (changed) {
          body = retryBody;
          continue;
        }
        if (attempt < 3 && isRetryableLlmStatus(res.status, raw)) {
          await waitForLlmRetry(attempt);
          continue;
        }
        throw new Error(`Responses API failed (${res.status}): ${raw}`);
      }

      const data = tryParseJson<ResponsesApiResponse>(raw);
      if (!data) return { raw, contentText: null };
      return { raw, ...extractResponsesContent(data) };
    } catch (error) {
      if (attempt < 3 && isRetryableLlmError(error)) {
        await waitForLlmRetry(attempt);
        continue;
      }
      throw error;
    }
  }

  throw new Error("Responses API retry budget exceeded.");
}

export async function callTextGeneration(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_output_tokens?: number;
  timeoutMs?: number;
  prompt_cache_key?: string;
  prompt_cache_retention?: "in_memory" | "24h";
  verbosity?: "low" | "medium" | "high";
}) {
  try {
    return await callResponsesApi(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (!/(Responses API failed|Responses API retry budget exceeded|404|400|unsupported|invalid)/i.test(message)) {
      throw error;
    }
    return callChatCompletions({
      model: params.model,
      messages: params.messages,
      timeoutMs: params.timeoutMs,
      max_completion_tokens: params.max_output_tokens,
      prompt_cache_key: params.prompt_cache_key,
      prompt_cache_retention: params.prompt_cache_retention,
    });
  }
}

export async function callJsonGeneration(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_output_tokens?: number;
  timeoutMs?: number;
  prompt_cache_key?: string;
  prompt_cache_retention?: "in_memory" | "24h";
  temperature?: number;
}) {
  const result = await callChatCompletions({
    model: params.model,
    messages: params.messages,
    timeoutMs: params.timeoutMs,
    max_completion_tokens: params.max_output_tokens,
    temperature: typeof params.temperature === "number" ? params.temperature : 0.1,
    response_format: { type: "json_object" },
    prompt_cache_key: params.prompt_cache_key,
    prompt_cache_retention: params.prompt_cache_retention,
  });

  const source = typeof result.contentText === "string" && result.contentText.trim() ? result.contentText : result.raw;
  return {
    ...result,
    json: tryParseJson<unknown>(source),
  };
}
