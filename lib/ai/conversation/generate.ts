import { buildDraftInputBlock, estimateTokens, formatSessionDateLabel, formatStudentLabel, formatTeacherLabel } from "./shared";
import { buildDraftRetrySystemPrompt, buildDraftSystemPrompt } from "./spec";
import { isWeakDraftMarkdown, repairSummaryMarkdownFormatting } from "./normalize";
import { buildInterviewDraftFallbackMarkdown, buildLessonDraftFallbackMarkdown } from "./fallback";
import { callTextGeneration } from "./transport";
import type { DraftGenerationInput, DraftGenerationResult, SessionMode } from "./types";

const PROMPT_VERSION = "v4.2";

function forceGpt5Family(model: string) {
  const normalized = String(model ?? "").trim();
  if (!normalized) return "gpt-5.4";
  return normalized.includes("gpt-5") ? normalized : "gpt-5.4";
}

function getFastModel() {
  return forceGpt5Family(process.env.LLM_MODEL_FAST || process.env.LLM_MODEL || "gpt-5.4");
}

function supportsExtendedPromptCaching(model: string) {
  return /^gpt-5(?:\.|$|-)/i.test(model) || /^gpt-4\.1(?:$|-)/i.test(model);
}

function buildPromptCacheKey(kind: string, sessionType?: SessionMode) {
  return ["conversation-pipeline", PROMPT_VERSION, kind, sessionType ?? "COMMON"].join(":");
}

export async function generateConversationDraftFast(input: DraftGenerationInput): Promise<DraftGenerationResult> {
  const sessionType = input.sessionType ?? "INTERVIEW";
  const draftInput = buildDraftInputBlock(sessionType, input.transcript);
  const model = getFastModel();
  const system = buildDraftSystemPrompt(sessionType);
  const user = [
    "文脈:",
    `- 生徒: ${formatStudentLabel(input.studentName)}`,
    `- 講師: ${formatTeacherLabel(input.teacherName)}`,
    `- 日付: ${formatSessionDateLabel(input.sessionDate) || "不明"}`,
    `- 最低文字数目安: ${input.minSummaryChars}`,
    "",
    "入力:",
    `${draftInput.label}:`,
    draftInput.content,
  ].join("\n");
  const promptInputTokensEstimate = estimateTokens(system) + estimateTokens(user);

  let apiCalls = 0;
  try {
    apiCalls += 1;
    const { contentText, raw } = await callTextGeneration({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      timeoutMs: Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000),
      max_output_tokens: sessionType === "LESSON_REPORT" ? 2200 : 2400,
      prompt_cache_key: buildPromptCacheKey("draft-fast", sessionType),
      prompt_cache_retention: supportsExtendedPromptCaching(model) ? "24h" : "in_memory",
      verbosity: "medium",
    });
    const cleaned = repairSummaryMarkdownFormatting(contentText ?? raw);
    if (!isWeakDraftMarkdown(cleaned, sessionType, input.minSummaryChars)) {
      return {
        summaryMarkdown: cleaned,
        model,
        apiCalls,
        evidenceChars: draftInput.content.length,
        usedFallback: false,
        inputTokensEstimate: promptInputTokensEstimate,
      };
    }
  } catch {
    // retry below
  }

  try {
    apiCalls += 1;
    const { contentText, raw } = await callTextGeneration({
      model,
      messages: [
        {
          role: "system",
          content: buildDraftRetrySystemPrompt(sessionType),
        },
        { role: "user", content: user },
      ],
      timeoutMs: Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000),
      max_output_tokens: sessionType === "LESSON_REPORT" ? 2400 : 2600,
      prompt_cache_key: buildPromptCacheKey("draft-fast-retry", sessionType),
      prompt_cache_retention: supportsExtendedPromptCaching(model) ? "24h" : "in_memory",
      verbosity: "high",
    });
    const cleaned = repairSummaryMarkdownFormatting(contentText ?? raw);
    if (!isWeakDraftMarkdown(cleaned, sessionType, input.minSummaryChars)) {
      return {
        summaryMarkdown: cleaned,
        model,
        apiCalls,
        evidenceChars: draftInput.content.length,
        usedFallback: false,
        inputTokensEstimate: promptInputTokensEstimate,
      };
    }
  } catch {
    // deterministic fallback below
  }

  const fallback =
    sessionType === "LESSON_REPORT"
      ? buildLessonDraftFallbackMarkdown(input)
      : buildInterviewDraftFallbackMarkdown(input);
  return {
    summaryMarkdown: fallback,
    model,
    apiCalls: Math.max(apiCalls, 1),
    evidenceChars: draftInput.content.length,
    usedFallback: true,
    inputTokensEstimate: promptInputTokensEstimate,
  };
}

export function getPromptVersion() {
  return PROMPT_VERSION;
}
