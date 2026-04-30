import { callJsonGeneration } from "@/lib/ai/conversation/transport";
import type { ChatResult, LlmTokenUsage as ConversationLlmTokenUsage } from "@/lib/ai/conversation/types";

export type LlmTokenUsage = ConversationLlmTokenUsage;

type JsonGenerationResult = ChatResult & {
  json?: unknown;
};

export function emptyLlmTokenUsage(): LlmTokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
  };
}

export function addLlmTokenUsage(left: LlmTokenUsage, right?: Partial<LlmTokenUsage> | null): LlmTokenUsage {
  if (!right) return left;
  return {
    inputTokens: left.inputTokens + Math.max(0, Math.floor(Number(right.inputTokens ?? 0))),
    cachedInputTokens: left.cachedInputTokens + Math.max(0, Math.floor(Number(right.cachedInputTokens ?? 0))),
    outputTokens: left.outputTokens + Math.max(0, Math.floor(Number(right.outputTokens ?? 0))),
    totalTokens: left.totalTokens + Math.max(0, Math.floor(Number(right.totalTokens ?? 0))),
    reasoningTokens: left.reasoningTokens + Math.max(0, Math.floor(Number(right.reasoningTokens ?? 0))),
  };
}

export function normalizeGeneratedText(value: unknown, maxChars = 220) {
  const text = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[•●■・]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars).trim()}…` : normalized;
}

export function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function extractJsonCandidate(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function extractTextFromContent(content: unknown) {
  if (typeof content === "string") return content.trim() || null;
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "";
        }
        return "";
      })
      .join("")
      .trim();
    return joined || null;
  }
  return null;
}

function extractWrappedGenerationText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as {
    choices?: Array<{ message?: { content?: unknown } }>;
    output_text?: unknown;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };

  const choiceContent = payload.choices?.[0]?.message?.content;
  const choiceText = extractTextFromContent(choiceContent);
  if (choiceText) return choiceText;

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputMessage = Array.isArray(payload.output)
    ? payload.output.find((item) => item?.type === "message" && Array.isArray(item.content))
    : null;
  if (!outputMessage) return null;

  const outputText = outputMessage.content
    ?.filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text?.trim() || "")
    .filter(Boolean)
    .join("\n")
    .trim();
  return outputText || null;
}

export function readGeneratedJson<T>(result: JsonGenerationResult): T | null {
  const directJson = result.json;
  const wrappedText = extractWrappedGenerationText(directJson);
  if (wrappedText) {
    const candidate = extractJsonCandidate(wrappedText) ?? wrappedText;
    return tryParseJson<T>(candidate);
  }

  if (directJson && typeof directJson === "object" && !Array.isArray(directJson)) {
    return directJson as T;
  }

  const sourceText = typeof result.contentText === "string" && result.contentText.trim()
    ? result.contentText
    : result.raw;
  const candidate = typeof sourceText === "string" ? extractJsonCandidate(sourceText) ?? sourceText : "";
  return candidate ? tryParseJson<T>(candidate) : null;
}

export function renderMarkdownDocument(lines: string[]) {
  return lines.join("\n").trim();
}

export async function generateJsonObject(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_output_tokens?: number;
  timeoutMs?: number;
  prompt_cache_key?: string;
  prompt_cache_retention?: "in_memory" | "24h";
  reasoning_effort?: "none" | "low" | "medium" | "high" | "xhigh";
  temperature?: number;
  json_schema?: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
}) {
  const result = await callJsonGeneration({
    model: params.model,
    messages: params.messages,
    max_output_tokens: params.max_output_tokens,
    timeoutMs: params.timeoutMs,
    prompt_cache_key: params.prompt_cache_key,
    prompt_cache_retention: params.prompt_cache_retention,
    reasoning_effort: params.reasoning_effort,
    temperature: params.temperature,
    json_schema: params.json_schema,
  });

  return {
    ...result,
    json: readGeneratedJson(result),
  };
}
