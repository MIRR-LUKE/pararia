import { calculateOpenAiTextCostUsd } from "@/lib/ai/openai-pricing";
import {
  buildConversationArtifactFromMarkdown,
  renderConversationArtifactMarkdown,
  type ConversationArtifact,
  type ConversationArtifactEntry,
} from "@/lib/conversation-artifact";
import { buildInterviewDraftFallbackMarkdown, buildLessonDraftFallbackMarkdown } from "../fallback";
import { isWeakDraftMarkdown, repairSummaryMarkdownFormatting } from "../normalize";
import type { DraftGenerationInput, DraftGenerationResult, LlmTokenUsage, SessionMode } from "../types";

type StructuredDraftEntry = {
  label?: unknown;
  text?: unknown;
  evidence?: unknown;
  claimType?: unknown;
  actionType?: unknown;
  confidence?: unknown;
  humanCheckNeeded?: unknown;
  basis?: unknown;
};

export type StructuredDraftPayload = {
  basicInfo?: Record<string, unknown> | null;
  summary?: unknown;
  claims?: unknown;
  nextActions?: unknown;
  sharePoints?: unknown;
};

export function normalizeText(value: unknown, maxChars = 180) {
  const text = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}…` : text;
}

export function emptyTokenUsage(): LlmTokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
  };
}

export function mergeTokenUsage(current: LlmTokenUsage, next?: Partial<LlmTokenUsage> | null) {
  if (!next) return current;
  return {
    inputTokens: current.inputTokens + Math.max(0, Math.floor(Number(next.inputTokens ?? 0))),
    cachedInputTokens: current.cachedInputTokens + Math.max(0, Math.floor(Number(next.cachedInputTokens ?? 0))),
    outputTokens: current.outputTokens + Math.max(0, Math.floor(Number(next.outputTokens ?? 0))),
    totalTokens: current.totalTokens + Math.max(0, Math.floor(Number(next.totalTokens ?? 0))),
    reasoningTokens: current.reasoningTokens + Math.max(0, Math.floor(Number(next.reasoningTokens ?? 0))),
  };
}

export function normalizeSectionText(value: unknown, maxChars = 120) {
  const text = normalizeText(value, maxChars);
  return text
    .replace(/^(では録音を始|録音を始|質問もありますか|お疲れさま|以上です)/, "")
    .replace(/^(はい|えっと|えーと|ええと|うん|まあ|なんか|あの|その)\s*/g, "")
    .trim();
}

export function formatInterviewDateLabel(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatDurationLabel(minutes?: number | null) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return "未記録";
  return `${Math.max(1, Math.round(minutes))}分`;
}

export function stripEntryLabelPrefix(text: string) {
  return text.replace(/^【[^】]+】\s*/, "").trim();
}

export function ensureSentenceEnding(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (/[。！？]$/.test(trimmed)) return trimmed;
  return `${trimmed}。`;
}

export function wrapJapaneseParagraph(text: string, maxChars = 120) {
  const cleaned = ensureSentenceEnding(text);
  if (!cleaned) return [];
  const sentences = cleaned.split(/(?<=。|！|？)/).map((part) => part.trim()).filter(Boolean);
  if (sentences.length === 0) return [cleaned];

  const lines: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current}${sentence}` : sentence;
    if (current && next.length > maxChars) {
      lines.push(current);
      current = sentence;
      continue;
    }
    current = next;
  }
  if (current) lines.push(current);
  return lines;
}

export function normalizeEvidenceList(value: unknown, maxItems = 2) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = normalizeSectionText(item, 100);
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function normalizeClaimType(value: unknown): ConversationArtifactEntry["claimType"] | undefined {
  if (value === "observed" || value === "inferred" || value === "missing") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "観察") return "observed";
  if (text === "推測") return "inferred";
  if (text === "不足") return "missing";
  return undefined;
}

export function normalizeActionType(value: unknown): ConversationArtifactEntry["actionType"] | undefined {
  if (value === "assessment" || value === "nextCheck") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "判断") return "assessment";
  if (text === "次回確認") return "nextCheck";
  return undefined;
}

export function normalizeConfidence(value: unknown): ConversationArtifactEntry["confidence"] | undefined {
  if (value === "low" || value === "medium" || value === "high") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "低") return "low";
  if (text === "中") return "medium";
  if (text === "高") return "high";
  return undefined;
}

export function buildEntry(
  input: StructuredDraftEntry,
  defaults: {
    defaultLabel?: string;
    defaultClaimType?: ConversationArtifactEntry["claimType"];
    defaultActionType?: ConversationArtifactEntry["actionType"];
    maxTextChars?: number;
    includeLabelInText?: boolean;
  }
) {
  const label = normalizeText(input.label ?? defaults.defaultLabel ?? "", 32);
  const textBody = normalizeSectionText(input.text, defaults.maxTextChars ?? 120);
  if (!textBody) return null;
  const includeLabelInText = defaults.includeLabelInText !== false;
  const text = includeLabelInText && label && !textBody.startsWith("【") ? `【${label}】 ${textBody}` : textBody;
  const evidence = normalizeEvidenceList(input.evidence);
  const claimType = normalizeClaimType(input.claimType) ?? defaults.defaultClaimType;
  const actionType = normalizeActionType(input.actionType) ?? defaults.defaultActionType;
  return {
    text,
    evidence,
    claimType,
    actionType,
    confidence: normalizeConfidence(input.confidence),
    humanCheckNeeded: input.humanCheckNeeded === true,
    basis: normalizeText(input.basis, 100) || undefined,
  } satisfies ConversationArtifactEntry;
}

export function normalizeEntryList(
  value: unknown,
  defaults: {
    defaultClaimType?: ConversationArtifactEntry["claimType"];
    defaultActionType?: ConversationArtifactEntry["actionType"];
    maxTextChars?: number;
    includeLabelInText?: boolean;
  },
  limit: number
) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: ConversationArtifactEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = buildEntry(item as StructuredDraftEntry, defaults);
    if (!entry) continue;
    const key = `${entry.text}::${entry.evidence.join("|")}::${entry.claimType ?? ""}::${entry.actionType ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (entries.length >= limit) break;
  }
  return entries;
}

export function ensureMinimum<T>(list: T[], fallback: T[], minCount: number) {
  if (list.length >= minCount) return list;
  return [...list, ...fallback.slice(0, Math.max(0, minCount - list.length))];
}

export function isUnsafeStructuredSummary(markdown: string) {
  const trimmed = String(markdown ?? "").trim();
  if (!trimmed) return true;
  if (!trimmed.includes("■ 基本情報")) return true;
  if (/録音始めた|何喋ろうか忘れ|質問もありますか|以上です。お疲れ/.test(trimmed)) return true;
  const longLines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^根拠[:：]/.test(line))
    .filter((line) => line.length >= 150);
  return longLines.length >= 2;
}

export function isFatalGenerationErrorMessage(message: string) {
  return /(invalid_api_key|incorrect api key|authentication|unauthorized|401|403|api key .* not set|llm api failed)/i.test(
    message
  );
}

export function buildMarkdownDraftResult(params: {
  sessionType: SessionMode;
  input: DraftGenerationInput;
  model: string;
  apiCalls: number;
  evidenceChars: number;
  promptInputTokensEstimate: number;
  tokenUsage: LlmTokenUsage;
  markdown: string;
}) {
  const normalizedMarkdown = repairSummaryMarkdownFormatting(params.markdown);
  if (
    isWeakDraftMarkdown(
      normalizedMarkdown,
      params.sessionType,
      params.input.minSummaryChars,
      params.input.transcript
    )
  ) {
    return null;
  }

  const artifact = buildConversationArtifactFromMarkdown({
    sessionType: params.sessionType,
    summaryMarkdown: normalizedMarkdown,
    generatedAt: new Date(),
  });
  const rendered = renderConversationArtifactMarkdown(artifact);
  if (isWeakDraftMarkdown(rendered, params.sessionType, params.input.minSummaryChars, params.input.transcript)) {
    return null;
  }

  return {
    summaryMarkdown: rendered,
    artifact,
    model: params.model,
    apiCalls: params.apiCalls,
    evidenceChars: params.evidenceChars,
    usedFallback: false,
    inputTokensEstimate: params.promptInputTokensEstimate,
    tokenUsage: params.tokenUsage,
    llmCostUsd: calculateOpenAiTextCostUsd(params.model, params.tokenUsage),
  } satisfies DraftGenerationResult;
}

export function buildDeterministicRecovery(input: DraftGenerationInput) {
  const markdown =
    input.sessionType === "LESSON_REPORT"
      ? buildLessonDraftFallbackMarkdown(input)
      : buildInterviewDraftFallbackMarkdown(input);
  const artifact = buildConversationArtifactFromMarkdown({
    sessionType: input.sessionType ?? "INTERVIEW",
    summaryMarkdown: markdown,
    generatedAt: new Date(),
  });
  return {
    artifact,
    summaryMarkdown: renderConversationArtifactMarkdown(artifact),
  };
}
