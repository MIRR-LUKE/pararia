import type { DraftGenerationInput, SessionMode } from "../types";
import {
  buildDraftInputBlock,
  estimateTokens,
  formatSessionDateLabel,
  formatStudentLabel,
  formatTeacherLabel,
} from "../shared";
import { formatDurationLabel } from "./normalize";

const PROMPT_VERSION = "v5.2";

function forceGpt5Family(model: string) {
  const normalized = String(model ?? "").trim();
  if (!normalized) return "gpt-5.4";
  return normalized.includes("gpt-5") ? normalized : "gpt-5.4";
}

export function getFastModel() {
  const requested = forceGpt5Family(process.env.LLM_MODEL_FAST || process.env.LLM_MODEL || "gpt-5.4");
  if (/gpt-5(?:\.4)?-(mini|nano)/i.test(requested)) {
    return "gpt-5.4";
  }
  return requested;
}

function supportsExtendedPromptCaching(model: string) {
  return /^gpt-5(?:\.|$|-)/i.test(model) || /^gpt-4\.1(?:$|-)/i.test(model);
}

function buildPromptCacheKey(namespace: string, sessionType?: SessionMode) {
  return ["conversation-pipeline", PROMPT_VERSION, namespace, sessionType ?? "COMMON"].join(":");
}

function normalizeText(value: unknown, maxChars = 180) {
  const text = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}…` : text;
}

export function resolvePromptCacheSettings(model: string, input: DraftGenerationInput, sessionType: SessionMode) {
  if (input.promptCacheRetention === null) {
    return {
      promptCacheKey: undefined,
      promptCacheRetention: undefined,
    };
  }

  const namespace = normalizeText(input.promptCacheNamespace, 48) || "artifact";
  const retention =
    input.promptCacheRetention ??
    (supportsExtendedPromptCaching(model) ? "24h" : "in_memory");

  return {
    promptCacheKey: buildPromptCacheKey(namespace, sessionType),
    promptCacheRetention: retention,
  };
}

export function buildStructuredUserPrompt(input: DraftGenerationInput, draftInput: { label: string; content: string }) {
  return [
    "入力メタデータ:",
    `- 生徒: ${formatStudentLabel(input.studentName)}`,
    `- 講師: ${formatTeacherLabel(input.teacherName)}`,
    `- 日付: ${formatSessionDateLabel(input.sessionDate) || "不明"}`,
    ...(input.sessionType === "INTERVIEW" ? [`- 面談時間目安: ${formatDurationLabel(input.durationMinutes)}`] : []),
    `- 最低文字数目安: ${input.minSummaryChars}`,
    "",
    "入力:",
    `${draftInput.label}:`,
    draftInput.content,
  ].join("\n");
}

export function buildRepairUserPrompt(errors: string[], previousRaw?: string | null) {
  return [
    "再生成で直すこと:",
    ...errors.map((error) => `- ${error}`),
    ...(previousRaw ? ["", "前回の出力:", previousRaw.slice(0, 4000)] : []),
  ].join("\n");
}

export function buildInterviewMarkdownUserPrompt(
  input: DraftGenerationInput,
  draftInput: { label: string; content: string }
) {
  return [
    "入力メタデータ:",
    `- 生徒: ${formatStudentLabel(input.studentName)}`,
    `- 講師: ${formatTeacherLabel(input.teacherName)}`,
    `- 面談日: ${formatSessionDateLabel(input.sessionDate) || "不明"}`,
    `- 面談時間: ${formatDurationLabel(input.durationMinutes)}`,
    `- 最低文字数目安: ${input.minSummaryChars}`,
    "",
    "出力上の必須条件:",
    "- `■ 基本情報` から `■ 5. 次回のお勧め話題` まで、見出しをこの順番で固定する。",
    "- `■ 1. サマリー` は 2 段落まで。",
    "- `■ 2` から `■ 5` は箇条書き中心で、1行を短く具体的にする。",
    "- `■ 5. 次回のお勧め話題` は、次回面談で確認したいことや声かけ材料にする。",
    "- `根拠:` 行は出さない。",
    "- 同じ内容を複数 section に繰り返さない。",
    "",
    "入力:",
    `${draftInput.label}:`,
    draftInput.content,
  ].join("\n");
}

export function buildInterviewMarkdownRepairPrompt(errors: string[], previousRaw?: string | null) {
  return [
    "markdown を作り直してください。",
    "- 面談ログ本文だけを返し、JSON は返さない。",
    "- 逐語転写や質問文の連打が残っている場合は要点だけに圧縮する。",
    "- `■ 5. 次回のお勧め話題` は次回確認事項として独立させる。",
    ...(errors.length > 0 ? ["", "前回失敗した点:", ...errors.map((error) => `- ${error}`)] : []),
    ...(previousRaw ? ["", "前回の出力:", previousRaw.slice(0, 4000)] : []),
  ].join("\n");
}

export function buildMarkdownRecoveryUserPrompt(sessionType: SessionMode, errors: string[]) {
  const headings =
    sessionType === "LESSON_REPORT"
      ? [
          "■ 基本情報",
          "■ 1. 本日の指導サマリー（室長向け要約）",
          "■ 2. 課題と指導成果（Before → After）",
          "■ 3. 学習方針と次回アクション（自学習の設計）",
          "■ 4. 室長・他講師への共有・連携事項",
        ]
      : [
          "■ 基本情報",
          "■ 1. サマリー",
          "■ 2. 学習状況と課題分析",
          "■ 3. 今後の対策・指導内容",
          "■ 4. 志望校に関する検討事項",
          "■ 5. 次回のお勧め話題",
        ];

  return [
    "JSON ではなく、そのままユーザーに見せる markdown を返してください。",
    "次の見出しをこの順番で必ず使ってください:",
    ...headings.map((heading) => `- ${heading}`),
    "会話の逐語転写を貼らず、自然な日本語の要約にしてください。",
    "同じ文や同じエピソードを別セクションへ繰り返さないでください。",
    "根拠のない推測は避け、事実が薄い section は『今回の面談では話していませんでした。』を使ってください。",
    "箇条書き section は 2-5 個まで、短く具体的に書いてください。",
    ...(errors.length > 0 ? ["", "前回失敗した点:", ...errors.map((error) => `- ${error}`)] : []),
  ].join("\n");
}

export function getPromptVersion() {
  return PROMPT_VERSION;
}

export function buildDraftPromptInput(input: DraftGenerationInput, transcript: string) {
  return buildDraftInputBlock(input.sessionType ?? "INTERVIEW", transcript);
}

export function estimatePromptTokens(system: string, user: string) {
  return estimateTokens(system) + estimateTokens(user);
}
