import type { DraftGenerationInput, SessionMode } from "../types";
import {
  buildDraftInputBlock,
  estimateTokens,
  formatSessionDateLabel,
  formatStudentLabel,
  formatTeacherLabel,
} from "../shared";
import { formatDurationLabel } from "./normalize";

const PROMPT_VERSION = "v5.3";

type UserPromptBundle = {
  userPrompt: string;
  cacheStablePrefix: string;
};

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

  const namespace = normalizeText(input.promptCacheNamespace, 48) || "conversation-draft";
  const retention =
    input.promptCacheRetention ??
    (supportsExtendedPromptCaching(model) ? "24h" : "in_memory");

  return {
    promptCacheKey: buildPromptCacheKey(namespace, sessionType),
    promptCacheRetention: retention,
  };
}

function buildStructuredStablePrefixLines(sessionType: SessionMode, draftInputLabel: string) {
  return [
    "固定仕様:",
    "- 先にこの固定仕様を読み、そのあとに可変メタデータと transcript を読む。",
    "- 可変メタデータは基本情報の補助にだけ使い、本文の論点は transcript の事実から拾う。",
    "- transcript にない事実、感想、補足設定は足さない。",
    "- `### 抽出済みの重要発話` で論点をつかみ、必要な箇所だけ `### 文字起こし全文` を確認する。",
    `- 入力ブロック名は常に \`${draftInputLabel}\` で、同じ順序の構造を保つ。`,
    "- evidence は短い断片に絞り、長い transcript の丸貼りはしない。",
    "- 同じ論点を summary / claims / nextActions / sharePoints に重複させない。",
    "- 基本情報へ入れる固有値は、生徒名・講師名・日付・面談時間など可変メタデータから拾う。",
    "- ただし基本情報以外の section は、可変メタデータではなく transcript の内容と evidence の組み合わせで構成する。",
    "- `抽出済み重要発話 + 文字起こし全文` のときは、重要発話で章立てを決めてから全文で裏取りする。",
    "- `圧縮済み証拠` のときは、見えている evidence だけで判断し、空欄を想像で埋めない。",
    "- 可変メタデータが違う run 同士でも、先頭の固定仕様と section contract は同一のまま維持する。",
    "- interview では、学習状況、課題分析、今後の対策、進路、次回確認事項を混ぜずに整理する。",
    "- sharePoints には進路や志望校の話を優先し、話題がなければ空配列のままにする。",
    "- 可変メタデータが run ごとに違っても、出力 contract と section 設計はこの固定仕様から崩さない。",
  ];
}

function buildStructuredVariableLines(input: DraftGenerationInput, draftInput: { label: string; content: string }) {
  return [
    "入力メタデータ:",
    `- 生徒: ${formatStudentLabel(input.studentName)}`,
    `- 講師: ${formatTeacherLabel(input.teacherName)}`,
    `- 日付: ${formatSessionDateLabel(input.sessionDate) || "不明"}`,
    `- 面談時間目安: ${formatDurationLabel(input.durationMinutes)}`,
    `- 最低文字数目安: ${input.minSummaryChars}`,
    "",
    "入力:",
    `${draftInput.label}:`,
    draftInput.content,
  ];
}

export function buildStructuredUserPromptBundle(
  input: DraftGenerationInput,
  draftInput: { label: string; content: string }
): UserPromptBundle {
  const cacheStablePrefix = buildStructuredStablePrefixLines(input.sessionType ?? "INTERVIEW", draftInput.label).join("\n");
  const variableLines = buildStructuredVariableLines(input, draftInput).join("\n");
  return {
    cacheStablePrefix,
    userPrompt: [cacheStablePrefix, "", variableLines].join("\n"),
  };
}

export function buildStructuredUserPrompt(input: DraftGenerationInput, draftInput: { label: string; content: string }) {
  return buildStructuredUserPromptBundle(input, draftInput).userPrompt;
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
  return buildInterviewMarkdownUserPromptBundle(input, draftInput).userPrompt;
}

function buildInterviewMarkdownStablePrefixLines(draftInputLabel: string) {
  return [
    "固定仕様:",
    "- 先にこの固定仕様を読み、そのあとに可変メタデータと transcript を読む。",
    "- 見出しは `■ 基本情報` から `■ 5. 次回のお勧め話題` まで、この順番で固定する。",
    "- `■ 基本情報` は `対象生徒 / 面談日 / 面談時間 / 担当チューター / テーマ` の 5 行だけにする。",
    "- `■ 1. サマリー` は 2 段落まで、管理者がそのまま読める自然な日本語にする。",
    "- `■ 2` から `■ 5` は各 section 2-4 個の箇条書きを基本にし、1行ずつ短く具体的にする。",
    "- `■ 5. 次回のお勧め話題` は、次回面談でそのまま使える確認項目や声かけにする。",
    "- 話題がない section は `今回の面談では...話していませんでした。` の 1 行だけを置く。",
    "- `根拠:` 行、JSON、補足説明、長い transcript の丸貼りは出さない。",
    "- 相づち、導入、質問文の連打、締めの定型句、同じ論点の重複は残さない。",
    "- `### 抽出済みの重要発話` で論点を先に取り、足りない事実だけ `### 文字起こし全文` で補う。",
    `- 入力ブロック名は常に \`${draftInputLabel}\` で、上に重要発話、下に全文が来る。`,
    "- 可変メタデータは `■ 基本情報` を埋めるための参照として使い、`■ 1` 以降の本文は transcript の内容だけで組み立てる。",
    "- 先に重要発話で章立てを決め、そのあと全文で根拠不足の論点だけ確認する。",
    "- transcript に進路の話があれば `■ 4. 志望校に関する検討事項` へ寄せ、なければその section を短く閉じる。",
    "- transcript に次回確認事項があれば `■ 5. 次回のお勧め話題` にまとめ、なければ無理に増やさない。",
    "- 可変メタデータが違う run 同士でも、先頭の固定仕様と見出し contract は同一のまま維持する。",
    "- 可変メタデータが run ごとに違っても、section の設計や書き方はこの固定仕様から変えない。",
    "- transcript にない事実や推測は足さない。",
  ];
}

function buildInterviewMarkdownVariableLines(
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
    "入力:",
    `${draftInput.label}:`,
    draftInput.content,
  ];
}

export function buildInterviewMarkdownUserPromptBundle(
  input: DraftGenerationInput,
  draftInput: { label: string; content: string }
): UserPromptBundle {
  const cacheStablePrefix = buildInterviewMarkdownStablePrefixLines(draftInput.label).join("\n");
  const variableLines = buildInterviewMarkdownVariableLines(input, draftInput).join("\n");
  return {
    cacheStablePrefix,
    userPrompt: [cacheStablePrefix, "", variableLines].join("\n"),
  };
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
  const headings = [
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
