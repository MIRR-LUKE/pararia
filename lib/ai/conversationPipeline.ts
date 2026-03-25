
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";
import type {
  ChunkAnalysis,
  FinalizeResult,
  NextAction,
  ParentPack,
  ProfileDelta,
  ProfileDeltaItem,
  ReducedAnalysis,
  TimelineCandidate,
  TimelineSection,
  TodoCandidate,
} from "@/lib/types/conversation";
import type {
  LessonReportArtifact,
  ObservationEvent,
  ProfileCategory,
  ProfileSection,
  ProfileSectionStatus,
  QuickQuestion,
  RecommendedTopic,
  StudentStateCard,
  StudentStateLabel,
} from "@/lib/types/session";

const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const PROMPT_VERSION = "v3.0";

const DEFAULT_LLM_TIMEOUT_MS = clampInt(Number(process.env.LLM_CALL_TIMEOUT_MS ?? 120000), 10000, 300000);
const ANALYZE_MAX_TOKENS = clampInt(Number(process.env.ANALYZE_MAX_TOKENS ?? 1400), 500, 4000);
const REDUCE_MAX_TOKENS = clampInt(Number(process.env.REDUCE_MAX_TOKENS ?? 2000), 900, 5000);
const FINALIZE_MAX_TOKENS = clampInt(Number(process.env.FINALIZE_MAX_TOKENS ?? 3000), 1200, 7000);
const SINGLE_PASS_MAX_TOKENS = clampInt(Number(process.env.SINGLE_PASS_MAX_TOKENS ?? 4200), 1200, 16000);
const ENABLE_FINALIZE_REPAIR = process.env.ENABLE_FINALIZE_REPAIR !== "0";

const PROFILE_CATEGORIES: ProfileCategory[] = ["学習", "生活", "学校", "進路"];
const STUDENT_STATE_LABELS: StudentStateLabel[] = [
  "前進",
  "集中",
  "安定",
  "不安",
  "疲れ",
  "詰まり",
  "落ち込み",
  "高揚",
];

type SessionMode = "INTERVIEW" | "LESSON_REPORT";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: unknown; refusal?: string };
    finish_reason?: string;
  }>;
};

type ChatResult = {
  raw: string;
  contentText: string | null;
  finishReason?: string;
  refusal?: string;
};

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractJsonCandidate(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1).trim();
  return candidate.startsWith("{") && candidate.endsWith("}") ? candidate : null;
}

function extractChatCompletionContent(data: ChatCompletionResponse) {
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason;
  const message = choice?.message;
  const refusal = message?.refusal;
  const content = message?.content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    return { contentText: trimmed || null, finishReason, refusal };
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
      } else if (
        part &&
        typeof part === "object" &&
        "text" in (part as any) &&
        typeof (part as any).text === "string"
      ) {
        parts.push((part as any).text);
      }
    }
    const trimmed = parts.join("").trim();
    return { contentText: trimmed || null, finishReason, refusal };
  }
  return { contentText: null, finishReason, refusal };
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
  max_tokens?: number;
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
    ...(params.max_completion_tokens || params.max_tokens
      ? { max_completion_tokens: params.max_completion_tokens ?? params.max_tokens }
      : {}),
    ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
    ...(params.response_format ? { response_format: params.response_format } : {}),
    ...(params.prompt_cache_key ? { prompt_cache_key: params.prompt_cache_key } : {}),
    ...(params.prompt_cache_retention ? { prompt_cache_retention: params.prompt_cache_retention } : {}),
  };

  const requestOnce = async (body: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify(body),
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
        const defaultTempOnly =
          res.status === 400 &&
          typeof body.temperature === "number" &&
          /temperature/i.test(raw) &&
          /default\s*\(1\)/i.test(raw);
        const unsupportedPromptCache =
          res.status === 400 &&
          /(prompt_cache_key|prompt_cache_retention)/i.test(raw);

        if (defaultTempOnly) {
          const retryBody = { ...body };
          delete retryBody.temperature;
          body = retryBody;
          continue;
        }

        if (unsupportedPromptCache) {
          const retryBody = { ...body };
          delete retryBody.prompt_cache_key;
          delete retryBody.prompt_cache_retention;
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

export function estimateTokens(text: string) {
  return Math.ceil(String(text ?? "").length / 2);
}

function forceGpt5Family(model: string) {
  const normalized = String(model ?? "").trim();
  if (!normalized) return "gpt-5.4";
  return normalized.includes("gpt-5") ? normalized : "gpt-5.4";
}

function getFastModel() {
  return forceGpt5Family(process.env.LLM_MODEL_FAST || process.env.LLM_MODEL || "gpt-5.4");
}

function getFinalModel() {
  return forceGpt5Family(process.env.LLM_MODEL_FINAL || process.env.LLM_MODEL || "gpt-5.4");
}

function supportsExtendedPromptCaching(model: string) {
  return /^gpt-5(?:\.|$|-)/i.test(model) || /^gpt-4\.1(?:$|-)/i.test(model);
}

function buildPromptCacheKey(kind: string, sessionType?: SessionMode) {
  return ["conversation-pipeline", PROMPT_VERSION, kind, sessionType ?? "COMMON"].join(":");
}

export function maskSensitiveText(text: string) {
  let out = String(text ?? "");
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "［EMAIL］");
  out = out.replace(/\b\d{2,4}-\d{2,4}-\d{3,4}\b/g, "［TEL］");
  out = out.replace(/\b\d{10,11}\b/g, "［TEL］");
  out = out.replace(/(東京都|北海道|大阪府|京都府|.{2,3}県).{0,20}(市|区|町|村)/g, "［ADDRESS］");
  return out;
}

function formatStudentLabel(name?: string) {
  const cleaned = String(name ?? "").trim();
  return cleaned ? `${cleaned}さん` : "生徒";
}

function formatTeacherLabel(name?: string) {
  const base = String(name ?? DEFAULT_TEACHER_FULL_NAME).replace(/先生$/g, "").trim();
  return `${base || "講師"}先生`;
}

function formatSessionDateLabel(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function normalizeWhitespace(text: unknown) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || typeof value === "undefined") return [];
  return [value as T];
}

function countJapaneseChars(text: string) {
  return (text.match(/[ぁ-んァ-ヶ一-龠]/g) ?? []).length;
}

function countEnglishWords(text: string) {
  return (text.match(/\b[A-Za-z][A-Za-z'/-]{2,}\b/g) ?? []).length;
}

function isJapanesePrimaryText(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return false;
  const jp = countJapaneseChars(normalized);
  const latin = (normalized.match(/[A-Za-z]/g) ?? []).length;
  if (jp === 0) return false;
  if (countEnglishWords(normalized) >= 4) return false;
  if (latin >= Math.max(18, jp)) return false;
  return true;
}

function looksPlaceholder(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return true;
  if (["なし", "未設定", "n/a", "todo", "-", "不明"].includes(normalized.toLowerCase())) return true;
  return (
    /情報が薄い|確認する|整理した|〜を確認した|追加確認|仮置き|placeholder|dummy/i.test(normalized) &&
    normalized.length < 24
  );
}

function sanitizeSentence(text: unknown, opts?: { maxLength?: number; allowShort?: boolean }) {
  const normalized = maskSensitiveText(normalizeWhitespace(text));
  if (!normalized) return "";
  const sliced = opts?.maxLength ? normalized.slice(0, opts.maxLength).trim() : normalized;
  if (!sliced) return "";
  if (looksPlaceholder(sliced)) return "";
  if (!isJapanesePrimaryText(sliced)) return "";
  if (!opts?.allowShort && sliced.length < 6) return "";
  return sliced;
}

function sanitizeQuotes(quotes: unknown) {
  return asArray<unknown>(quotes)
    .map((value) => sanitizeSentence(value, { maxLength: 64, allowShort: true }))
    .filter((value) => value.length >= 8)
    .slice(0, 4);
}

function dedupeStrings(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const value = normalizeWhitespace(item);
    if (!value) continue;
    const key = value.replace(/[。．！？、,\s]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function takeUniqueLines(values: unknown, limit: number, opts?: { maxLength?: number; allowShort?: boolean }) {
  return dedupeStrings(
    asArray<unknown>(values)
      .map((value) => sanitizeSentence(value, opts))
      .filter(Boolean)
  ).slice(0, limit);
}

function parseOwner(value: unknown): NextAction["owner"] {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "COACH" || normalized === "PARENT" || normalized === "STUDENT") {
    return normalized;
  }
  return "STUDENT";
}

function normalizeProfileDeltaItem(item: Partial<ProfileDeltaItem> | null | undefined): ProfileDeltaItem | null {
  const field = sanitizeSentence(item?.field, { maxLength: 40, allowShort: true });
  const value = sanitizeSentence(item?.value, { maxLength: 140 });
  if (!field || !value) return null;
  return {
    field,
    value,
    confidence: Math.max(0, Math.min(100, Number(item?.confidence ?? 60))),
    evidence_quotes: sanitizeQuotes(item?.evidence_quotes ?? []),
  };
}

function normalizeProfileDelta(delta: Partial<ProfileDelta> | null | undefined): ProfileDelta {
  const normalizeList = (items: unknown) =>
    asArray<Partial<ProfileDeltaItem> | null | undefined>(items)
      .map(normalizeProfileDeltaItem)
      .filter((item): item is ProfileDeltaItem => Boolean(item))
      .slice(0, 8);
  return {
    basic: normalizeList(delta?.basic),
    personal: normalizeList(delta?.personal),
  };
}

function normalizeTimeline(items: unknown): TimelineSection[] {
  return asArray<Partial<TimelineSection | TimelineCandidate> | null | undefined>(items)
    .map((item) => {
      const title = sanitizeSentence(item?.title, { maxLength: 50 });
      const what_happened = sanitizeSentence(item?.what_happened, { maxLength: 180 });
      const coach_point = sanitizeSentence(item?.coach_point, { maxLength: 180 });
      const student_state = sanitizeSentence(item?.student_state, { maxLength: 140 });
      if (!title && !what_happened && !coach_point && !student_state) return null;
      return {
        title: title || "今回の論点",
        what_happened: what_happened || "",
        coach_point: coach_point || "",
        student_state: student_state || "",
        evidence_quotes: sanitizeQuotes(item?.evidence_quotes ?? []),
      };
    })
    .filter((item): item is TimelineSection => Boolean(item))
    .slice(0, 6);
}

function normalizeNextActions(items: unknown): NextAction[] {
  return asArray<Partial<NextAction | TodoCandidate> | null | undefined>(items)
    .map((item) => {
      const action = sanitizeSentence(item?.action, { maxLength: 140 });
      const metric = sanitizeSentence(item?.metric, { maxLength: 120 });
      const why = sanitizeSentence(item?.why, { maxLength: 160 });
      if (!action || !metric || !why) return null;
      return {
        owner: parseOwner((item as any)?.owner),
        action,
        due: typeof item?.due === "string" && item.due.trim() ? item.due.trim() : null,
        metric,
        why,
      };
    })
    .filter((item): item is NextAction => Boolean(item))
    .slice(0, 6);
}

function normalizeChunkAnalysis(item: Partial<ChunkAnalysis> | null | undefined, index: number, hash: string): ChunkAnalysis {
  return {
    index,
    hash,
    facts: takeUniqueLines(item?.facts ?? [], 10, { maxLength: 120 }),
    coaching_points: takeUniqueLines(item?.coaching_points ?? [], 8, { maxLength: 140 }),
    decisions: takeUniqueLines(item?.decisions ?? [], 8, { maxLength: 140 }),
    student_state_delta: takeUniqueLines(item?.student_state_delta ?? [], 6, { maxLength: 120 }),
    todo_candidates: normalizeNextActions(item?.todo_candidates ?? []).map((action) => ({
      ...action,
      evidence_quotes: [],
    })),
    timeline_candidates: normalizeTimeline(item?.timeline_candidates ?? []).map((section) => ({
      ...section,
    })),
    profile_delta_candidates: normalizeProfileDelta(item?.profile_delta_candidates),
    quotes: sanitizeQuotes(item?.quotes ?? []),
    safety_flags: takeUniqueLines(item?.safety_flags ?? [], 6, { maxLength: 32, allowShort: true }),
  };
}

function normalizeReducedAnalysis(item: Partial<ReducedAnalysis> | null | undefined): ReducedAnalysis {
  return {
    facts: takeUniqueLines(item?.facts ?? [], 20, { maxLength: 120 }),
    coaching_points: takeUniqueLines(item?.coaching_points ?? [], 16, { maxLength: 140 }),
    decisions: takeUniqueLines(item?.decisions ?? [], 16, { maxLength: 140 }),
    student_state_delta: takeUniqueLines(item?.student_state_delta ?? [], 12, { maxLength: 120 }),
    todo_candidates: normalizeNextActions(item?.todo_candidates ?? []).map((action) => ({ ...action, evidence_quotes: [] })),
    timeline_candidates: normalizeTimeline(item?.timeline_candidates ?? []).map((section) => ({ ...section })),
    profile_delta_candidates: normalizeProfileDelta(item?.profile_delta_candidates),
    quotes: sanitizeQuotes(item?.quotes ?? []),
    safety_flags: takeUniqueLines(item?.safety_flags ?? [], 8, { maxLength: 32, allowShort: true }),
  };
}

function normalizeParentPack(item: Partial<ParentPack> | null | undefined): ParentPack {
  return {
    what_we_did: takeUniqueLines(item?.what_we_did ?? [], 4, { maxLength: 120 }),
    what_improved: takeUniqueLines(item?.what_improved ?? [], 4, { maxLength: 120 }),
    what_to_practice: takeUniqueLines(item?.what_to_practice ?? [], 4, { maxLength: 120 }),
    risks_or_notes: takeUniqueLines(item?.risks_or_notes ?? [], 4, { maxLength: 120 }),
    next_time_plan: takeUniqueLines(item?.next_time_plan ?? [], 4, { maxLength: 120 }),
    evidence_quotes: sanitizeQuotes(item?.evidence_quotes ?? []),
  };
}

function emptyParentPack(): ParentPack {
  return normalizeParentPack(null);
}

function parseProfileCategory(value: unknown): ProfileCategory {
  const normalized = String(value ?? "").trim();
  return PROFILE_CATEGORIES.includes(normalized as ProfileCategory) ? (normalized as ProfileCategory) : "学習";
}

function parseProfileStatus(value: unknown): ProfileSectionStatus {
  const normalized = String(value ?? "").trim();
  return ["改善", "維持", "落ちた", "不明"].includes(normalized) ? (normalized as ProfileSectionStatus) : "不明";
}

function normalizeStudentState(item: Partial<StudentStateCard> | null | undefined): StudentStateCard {
  const label = STUDENT_STATE_LABELS.includes(String(item?.label ?? "").trim() as StudentStateLabel)
    ? (String(item?.label).trim() as StudentStateLabel)
    : "安定";
  return {
    label,
    oneLiner: sanitizeSentence(item?.oneLiner, { maxLength: 84 }) || "大きく崩れず、次に確認すべき点が見えている。",
    rationale: takeUniqueLines(item?.rationale ?? [], 4, { maxLength: 120 }),
    confidence: Math.max(0, Math.min(100, Number(item?.confidence ?? 60))),
  };
}

function normalizeRecommendedTopics(items: Array<Partial<RecommendedTopic> | null | undefined>): RecommendedTopic[] {
  return asArray<Partial<RecommendedTopic> | null | undefined>(items)
    .map((item, index) => {
      const title = sanitizeSentence(item?.title, { maxLength: 56 });
      const reason = sanitizeSentence(item?.reason, { maxLength: 140 });
      const question = sanitizeSentence(item?.question, { maxLength: 100 });
      if (!title || !reason || !question) return null;
      return {
        category: parseProfileCategory(item?.category),
        title,
        reason,
        question,
        priority: Math.max(1, Math.min(7, Number(item?.priority ?? index + 1))),
      };
    })
    .filter((item): item is RecommendedTopic => Boolean(item))
    .slice(0, 7);
}

function normalizeQuickQuestions(items: Array<Partial<QuickQuestion> | null | undefined>): QuickQuestion[] {
  return asArray<Partial<QuickQuestion> | null | undefined>(items)
    .map((item) => {
      const question = sanitizeSentence(item?.question, { maxLength: 100 });
      const reason = sanitizeSentence(item?.reason, { maxLength: 140 });
      if (!question || !reason) return null;
      return {
        category: parseProfileCategory(item?.category),
        question,
        reason,
      };
    })
    .filter((item): item is QuickQuestion => Boolean(item))
    .slice(0, 7);
}

function normalizeProfileSections(items: Array<Partial<ProfileSection> | null | undefined>): ProfileSection[] {
  return asArray<Partial<ProfileSection> | null | undefined>(items)
    .map((item) => {
      const highlights = asArray<Partial<ProfileSection["highlights"][number]> | null | undefined>(item?.highlights)
        .map((highlight) => {
          const label = sanitizeSentence(highlight?.label, { maxLength: 36, allowShort: true });
          const value = sanitizeSentence(highlight?.value, { maxLength: 120 });
          if (!label || !value) return null;
          return {
            label,
            value,
            isNew: Boolean(highlight?.isNew),
            isUpdated: Boolean(highlight?.isUpdated),
          };
        })
        .filter((highlight): highlight is NonNullable<typeof highlight> => Boolean(highlight))
        .slice(0, 5);
      const nextQuestion = sanitizeSentence(item?.nextQuestion, { maxLength: 100 });
      if (highlights.length === 0 && !nextQuestion) return null;
      return {
        category: parseProfileCategory(item?.category),
        status: parseProfileStatus(item?.status),
        highlights,
        nextQuestion: nextQuestion || "次回もう少し具体的に確認したい。",
      };
    })
    .filter(Boolean)
    .slice(0, 4) as ProfileSection[];
}

function normalizeObservationEvents(items: Array<Partial<ObservationEvent> | null | undefined>): ObservationEvent[] {
  return asArray<Partial<ObservationEvent> | null | undefined>(items)
    .map((item) => {
      const insights = takeUniqueLines(item?.insights ?? [], 4, { maxLength: 120 });
      const topics = takeUniqueLines(item?.topics ?? [], 4, { maxLength: 80 });
      if (insights.length === 0 && topics.length === 0) return null;
      return {
        sourceType: item?.sourceType === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW",
        category: parseProfileCategory(item?.category),
        statusDraft: parseProfileStatus(item?.statusDraft),
        insights,
        topics,
        nextActions: takeUniqueLines(item?.nextActions ?? [], 4, { maxLength: 120 }),
        evidence: sanitizeQuotes(item?.evidence ?? []),
        characterSignal: sanitizeSentence(item?.characterSignal, { maxLength: 80 }) || "",
        weight: Math.max(1, Math.min(5, Number(item?.weight ?? 3))),
      };
    })
    .filter((item): item is ObservationEvent => Boolean(item))
    .slice(0, 8);
}

function normalizeLessonReport(item: Partial<LessonReportArtifact> | null | undefined): LessonReportArtifact | null {
  if (!item) return null;
  const todayGoal = sanitizeSentence(item?.todayGoal, { maxLength: 120 });
  const covered = takeUniqueLines(item?.covered ?? [], 5, { maxLength: 120 });
  const blockers = takeUniqueLines(item?.blockers ?? [], 5, { maxLength: 120 });
  const homework = takeUniqueLines(item?.homework ?? [], 5, { maxLength: 120 });
  const nextLessonFocus = takeUniqueLines(item?.nextLessonFocus ?? [], 5, { maxLength: 120 });
  const parentShareDraft = sanitizeSentence(item?.parentShareDraft, { maxLength: 180 });
  if (!todayGoal && covered.length === 0 && blockers.length === 0 && homework.length === 0 && nextLessonFocus.length === 0) {
    return null;
  }
  return {
    todayGoal: todayGoal || "今日の授業で確認した論点を、次回につながる形に整理する。",
    covered,
    blockers,
    homework,
    nextLessonFocus,
    ...(parentShareDraft ? { parentShareDraft } : {}),
  };
}

function normalizeFinalizeResult(item: Partial<FinalizeResult> | null | undefined, sessionType: SessionMode, minSummaryChars: number): FinalizeResult {
  const normalized = {
    summaryMarkdown: sanitizeSummaryMarkdown(item?.summaryMarkdown, minSummaryChars),
    timeline: normalizeTimeline(item?.timeline ?? []),
    nextActions: normalizeNextActions(item?.nextActions ?? []),
    profileDelta: normalizeProfileDelta(item?.profileDelta),
    parentPack: emptyParentPack(),
    studentState: normalizeStudentState(item?.studentState),
    recommendedTopics: normalizeRecommendedTopics(item?.recommendedTopics ?? []),
    quickQuestions: normalizeQuickQuestions(item?.quickQuestions ?? []),
    profileSections: normalizeProfileSections(item?.profileSections ?? []),
    observationEvents: normalizeObservationEvents(item?.observationEvents ?? []),
    lessonReport: sessionType === "LESSON_REPORT" ? normalizeLessonReport(item?.lessonReport) : null,
  };
  return normalized;
}

function sanitizeSummaryMarkdown(markdown: unknown, minChars: number) {
  const text = String(markdown ?? "").replace(/\r/g, "").trim();
  if (!text) return "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith("■ ")) return line;
      if (line.startsWith("## ")) return line;
      if (line.startsWith("- ") || /^\d+\./.test(line)) return line;
      const cleaned = sanitizeSentence(line, { maxLength: 220, allowShort: true });
      return cleaned || "";
    })
    .filter(Boolean);
  const rebuilt = lines.join("\n");
  return rebuilt.length >= Math.min(180, minChars) ? rebuilt : "";
}

function hasLessonReportSummaryStructure(markdown: string) {
  return (
    markdown.includes("■ 基本情報") &&
    markdown.includes("■ 1. 本日の指導サマリー（室長向け要約）") &&
    markdown.includes("■ 2. 課題と指導成果（Before → After）") &&
    markdown.includes("■ 3. 学習方針と次回アクション（自学習の設計）") &&
    markdown.includes("■ 4. 室長・他講師への共有・連携事項")
  );
}

function hasInterviewSummaryStructure(markdown: string) {
  return (
    markdown.includes("■ 基本情報") &&
    markdown.includes("■ 1. サマリー") &&
    markdown.includes("■ 2. ポジティブな話題") &&
    markdown.includes("■ 3. 改善・対策が必要な話題")
  );
}

function isWeakInterviewSummary(markdown: string, minChars: number) {
  const text = String(markdown ?? "").trim();
  if (!text) return true;
  if (text.length < Math.max(180, Math.min(minChars, 900))) return true;
  if (!hasInterviewSummaryStructure(text)) return true;
  if (!/英語|数学|国語|理科|社会|学校|生活|志望校|受験|進路/.test(text)) return true;
  return false;
}

function isWeakLessonReportSummary(markdown: string, minChars: number) {
  const text = String(markdown ?? "").trim();
  if (!text) return true;
  if (text.length < Math.max(500, Math.min(minChars, 900))) return true;
  if (!hasLessonReportSummaryStructure(text)) return true;
  if ((text.match(/現状（Before）:/g) ?? []).length < 2) return true;
  if ((text.match(/成果（After）:/g) ?? []).length < 2) return true;
  if (!text.includes("次回までの宿題:")) return true;
  if (!text.includes("次回の確認（テスト）事項:")) return true;
  if (/[^\n。！？]\n■ 2\./.test(text)) return true;
  if (/[^\n。！？]\n■ 3\./.test(text)) return true;
  if (/[^\n。！？]\n■ 4\./.test(text)) return true;
  if (/[^\n。！？]\n次回までの宿題:/.test(text)) return true;
  if (/[^\n。！？]\n次回の確認（テスト）事項:/.test(text)) return true;
  if (/##\s*授業前チェックイン|##\s*授業後チェックアウト/.test(text)) return true;
  if (/録音始めた|何喋ろうか忘れちゃった|質問ある\?ないです|以上です。お疲れ/.test(text)) return true;
  return false;
}

function repairBrokenLessonReportSections(markdown: string) {
  return String(markdown ?? "")
    .replace(
      /学校の(?:化学|理科|講習|講座)?。\s*今後は、/g,
      "学校講習などで学習時間が圧迫される週には演習量が不足しやすい。今後は、"
    )
    .replace(
      /極限は(?:補|基礎の見|見通しの見)?。\s*次回までは、/g,
      "極限は補助的に扱い、授業内で記述の再現性を確認していく。次回までは、"
    )
    .replace(
      /、極限。\s*次回までは、/g,
      "、極限は補助的に扱い、授業内で記述の再現性を確認していく。次回までは、"
    )
    .replace(
      /関数同士のオ。\s*今後は、/g,
      "関数同士のオーダーを比較し、支配的な項を見抜く視点が整理された。今後は、"
    )
    .replace(
      /挟み撃ちの。\s*次回までは、/g,
      "挟み撃ちの原理を導入し、感覚を論理へ接続する。次回までは、"
    )
    .replace(/持って。\s*今後は、/g, "持っている。今後は、")
    .replace(/自己評価が。\s*今後は、/g, "自己評価が『分かった』で止まりやすい。今後は、")
    .replace(/化学に。\s*今後は、/g, "化学に時間を割いており、数学の演習量は十分ではなかった。今後は、")
    .replace(/数学の演習。\s*今後は、/g, "数学の演習量は十分ではなかった。今後は、")
    .replace(/したがって次回までは、。\s*次回までは、/g, "したがって次回までは、")
    .replace(/、。\s*次回までは、/g, "。次回までは、")
    .replace(
      /([^\n。！？])\n■ 2\. 課題と指導成果（Before → After）/g,
      "$1。今後は、理解の見通しを答案として再現できるかまで確認していく。\n■ 2. 課題と指導成果（Before → After）"
    )
    .replace(
      /([^\n。！？])\n■ 3\. 学習方針と次回アクション（自学習の設計）/g,
      "$1。今後の自学習では、優先順位を絞って再現性を高める必要がある。\n■ 3. 学習方針と次回アクション（自学習の設計）"
    )
    .replace(
      /([^\n。！？])\n次回までの宿題:/g,
      "$1。次回までは、三角関数の反復を優先しつつ、極限は授業内で記述の再現性を確認する。\n次回までの宿題:"
    )
    .replace(
      /([^\n。！？])\n次回の確認（テスト）事項:/g,
      "$1。\n次回の確認（テスト）事項:"
    );
}

function hasBrokenLessonReportPhrasing(markdown: string) {
  const normalized = String(markdown ?? "");
  return /(?:前に分子|前に分母|基礎の見|説明の見|見通しの見|自己評価が|化学に|数学の演習)\。\s*(?:今後は|次回までは|次回の)|次回までは、。\s*次回までは、/.test(normalized);
}

function repairBrokenSummaryLineBreaks(markdown: string) {
  const source = String(markdown ?? "").replace(/\r/g, "");
  if (!source) return "";
  const rawLines = source.split("\n");
  const rebuilt: string[] = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    let current = rawLines[index].trim();
    if (!current) {
      if (rebuilt[rebuilt.length - 1] !== "") rebuilt.push("");
      continue;
    }

    while (index + 1 < rawLines.length) {
      const next = rawLines[index + 1].trim();
      if (!next) break;
      const currentIsBlock = /^(■\s|##\s|- |\d+\.)/.test(current);
      const nextStartsBlock =
        /^(■\s|##\s|- |\d+\.|現状（Before）:|成果（After）:|次回までの宿題:|次回の確認（テスト）事項:|※)/.test(next);
      const endsWithSentence = /[。！？:：）\]」』]$/.test(current);

      if (nextStartsBlock) {
        if (!currentIsBlock && !endsWithSentence) current = `${current}。`;
        break;
      }
      if (currentIsBlock) break;
      if (endsWithSentence) break;

      current = `${current}${next}`;
      index += 1;
    }

    rebuilt.push(current);
  }

  return rebuilt.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function polishLessonReportSummaryMarkdown(input: { markdown: string; transcript: string }) {
  const model = getFinalModel();
  try {
    const { contentText, raw } = await callChatCompletions({
      model,
      messages: [
        {
          role: "system",
          content: [
            "あなたは学習塾の教務責任者です。",
            "与えられた指導報告ログ markdown の言い回しだけを整えてください。",
            "構造・事実・方針は維持し、途中で切れた文、不自然な句点、語尾の崩れだけを自然な日本語へ直してください。",
            "見出し記号 ■ や各セクション構造は絶対に維持してください。",
            "新しい事実の追加は禁止です。",
            "出力は markdown 本文のみです。",
          ].join("\n"),
        },
        {
          role: "user",
          content: ["現在の markdown:", input.markdown, "", "参考文字起こし:", input.transcript].join("\n"),
        },
      ],
      temperature: 0.1,
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS * 2,
      max_completion_tokens: Math.max(FINALIZE_MAX_TOKENS, 5200),
      prompt_cache_key: buildPromptCacheKey("lesson-polish", "LESSON_REPORT"),
      prompt_cache_retention: supportsExtendedPromptCaching(model) ? "24h" : "in_memory",
    });
    return String(contentText ?? raw ?? "").trim();
  } catch {
    return input.markdown;
  }
}

function compactJson(value: unknown) {
  return JSON.stringify(value);
}

function transcriptLines(transcript: string) {
  const seen = new Set<string>();
  return String(transcript ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n+|(?<=[。！？!?])\s*/g)
    .map((line) => maskSensitiveText(line))
    .map((line) =>
      normalizeWhitespace(
        line
          .replace(/^\*\*[^*]+\*\*:\s*/g, "")
          .replace(/^##\s*/, "")
      )
    )
    .filter(Boolean)
    .filter(
      (line) =>
        !/^(授業前チェックイン|授業後チェックアウト|面談・通し録音|補足メモ|セッション構成)$/.test(line)
    )
    .filter(
      (line) =>
        !/^(録音始めたけど。?|ねえ。?|はい。?|で ですね|OK、じゃあすぐいない。?|質問ある\?ないです。?以上です。?お疲れ。?)$/.test(
          line
        )
    )
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .filter((line) => line.length >= 8)
    .slice(0, 120);
}

const STUDY_RE = /(学習|勉強|数学|算数|英語|国語|理科|社会|問題|教材|宿題|演習|模試|過去問|単語|長文|文法|解き直し|得点|点数|授業)/;
const LIFE_RE = /(生活|睡眠|寝|起き|朝|夜|体調|疲|スマホ|習慣|リズム|食事)/;
const SCHOOL_RE = /(学校|先生|クラス|友達|部活|提出|内申|行事|面談|校内)/;
const CAREER_RE = /(進路|志望校|受験|共通テスト|二次|推薦|大学|学部|出願|判定)/;

function inferCategory(text: string): ProfileCategory {
  const source = String(text ?? "");
  if (CAREER_RE.test(source)) return "進路";
  if (LIFE_RE.test(source)) return "生活";
  if (SCHOOL_RE.test(source)) return "学校";
  if (STUDY_RE.test(source)) return "学習";
  return "学習";
}

function inferStateLabel(text: string): StudentStateLabel {
  const source = String(text ?? "");
  if (/(前進|伸び|できた|上が|進ん|手応え)/.test(source)) return "前進";
  if (/(集中|粘|没頭)/.test(source)) return "集中";
  if (/(不安|心配|焦|迷|しんど)/.test(source)) return "不安";
  if (/(疲|眠|だる|重い)/.test(source)) return "疲れ";
  if (/(詰|止ま|苦手|できない|取れない|頭打ち)/.test(source)) return "詰まり";
  if (/(落ち込|無理|つらい)/.test(source)) return "落ち込み";
  if (/(嬉|楽し|高揚|乗って)/.test(source)) return "高揚";
  return "安定";
}

function stateOneLiner(label: StudentStateLabel, sessionType: SessionMode) {
  const base: Record<StudentStateLabel, string> = {
    前進: "やることが絞れ、前に進む感覚が出ている。",
    集中: "今やるべきことに意識を向けられている。",
    安定: "大きく崩れず、次に確認すべき点が見えている。",
    不安: "進め方は見えつつも、結果への不安が残っている。",
    疲れ: "負荷が高く、立て直し方の確認が必要な状態である。",
    詰まり: "知識はあるが、実際の場面で止まりやすい。",
    落ち込み: "手応えが弱く、気持ちの立て直しが必要である。",
    高揚: "前向きさが高く、勢いを行動に変えやすい。",
  };
  if (sessionType === "LESSON_REPORT" && label === "詰まり") {
    return "授業中のつまずきが明確で、次回の立て直しポイントが見えている。";
  }
  return base[label];
}

function summarizeTranscriptEvidence(transcript: string, limit = 12) {
  return transcriptLines(transcript).slice(0, limit);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMarkdownSectionBody(transcript: string, heading: string) {
  const pattern = new RegExp(`##\\s*${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  const match = transcript.match(pattern);
  return match?.[1]?.trim() ?? "";
}

async function rewriteLessonReportSummaryMarkdown(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
  minSummaryChars: number;
  current?: string;
  lessonReport?: LessonReportArtifact | null;
  nextActions?: NextAction[];
  forceCompleteSentences?: boolean;
}) {
  const model = getFinalModel();
  const system = [
    "あなたは学習塾・個別指導の教務責任者です。",
    "指導報告ログの summaryMarkdown だけを高品質に書き直してください。",
    "出力は markdown 本文のみです。JSON は禁止です。",
    "見出し記号は必ず ■ を使い、# や ## は使わないでください。",
    "授業前チェックインと授業後チェックアウトを混同せず、Before と After を明確に分けてください。",
    "録音開始時の雑談、相槌、発話事故、STT の崩れた断片、意味が取れない文はノイズとして捨ててください。",
    "逐語録の貼り付けは禁止です。塾の管理者が読める完成文に要約してください。",
    "教科・単元は文字起こしから合理的に推定してください。確信が低ければ広めの表現にしてください。",
    "必ず 2 トピック以上の Before → After を書いてください。",
    `本文は ${input.minSummaryChars} 文字以上を目安に、薄くならないように書いてください。`,
    ...(input.forceCompleteSentences
      ? ["各段落・各セクションの本文は、必ず文末を『。』で閉じてください。途中で切れた文は禁止です。"]
      : []),
    "",
    ...buildSummaryMarkdownSpec(true),
  ].join("\n");

  const user = [
    `生徒: ${formatStudentLabel(input.studentName)}`,
    `講師: ${formatTeacherLabel(input.teacherName)}`,
    `指導日: ${formatSessionDateLabel(input.sessionDate) || "不明"}`,
    "",
    "参考 nextActions:",
    compactJson(input.nextActions ?? []),
    "",
    "参考 lessonReport:",
    compactJson(input.lessonReport ?? null),
    "",
    "現在の弱い下書き:",
    input.current?.trim() || "(none)",
    "",
    "文字起こし:",
    input.transcript,
  ].join("\n");

  try {
    const { contentText, raw } = await callChatCompletions({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS * 2,
      max_completion_tokens: Math.max(FINALIZE_MAX_TOKENS, 5200),
      prompt_cache_key: buildPromptCacheKey("lesson-rewrite", "LESSON_REPORT"),
      prompt_cache_retention: supportsExtendedPromptCaching(model) ? "24h" : "in_memory",
    });
    return sanitizeSummaryMarkdown(contentText ?? raw, input.minSummaryChars);
  } catch {
    return "";
  }
}

async function stabilizeLessonReportResult(input: {
  result: FinalizeResult;
  heuristic: FinalizeResult;
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
  minSummaryChars: number;
}) {
  let summaryMarkdown = input.result.summaryMarkdown;
  if (isWeakLessonReportSummary(summaryMarkdown, input.minSummaryChars)) {
    const rewritten = await rewriteLessonReportSummaryMarkdown({
      transcript: input.transcript,
      studentName: input.studentName,
      teacherName: input.teacherName,
      sessionDate: input.sessionDate,
      minSummaryChars: input.minSummaryChars,
      current: summaryMarkdown,
      lessonReport: input.result.lessonReport ?? input.heuristic.lessonReport,
      nextActions:
        input.result.nextActions.length >= 2
          ? input.result.nextActions
          : input.heuristic.nextActions,
    });
    if (rewritten && !isWeakLessonReportSummary(rewritten, input.minSummaryChars)) {
      summaryMarkdown = rewritten;
    } else {
      const preferredWeakCandidate = rewritten || summaryMarkdown;
      const rewrittenStrict = await rewriteLessonReportSummaryMarkdown({
        transcript: input.transcript,
        studentName: input.studentName,
        teacherName: input.teacherName,
        sessionDate: input.sessionDate,
        minSummaryChars: input.minSummaryChars,
        current: rewritten || summaryMarkdown,
        lessonReport: input.result.lessonReport ?? input.heuristic.lessonReport,
        nextActions:
          input.result.nextActions.length >= 2
            ? input.result.nextActions
            : input.heuristic.nextActions,
        forceCompleteSentences: true,
      });
      if (rewrittenStrict && !isWeakLessonReportSummary(rewrittenStrict, input.minSummaryChars)) {
        summaryMarkdown = rewrittenStrict;
      } else if (rewrittenStrict) {
        summaryMarkdown = rewrittenStrict;
      } else if (preferredWeakCandidate && preferredWeakCandidate !== input.heuristic.summaryMarkdown) {
        summaryMarkdown = preferredWeakCandidate;
      } else if (isWeakLessonReportSummary(summaryMarkdown, input.minSummaryChars)) {
        summaryMarkdown = input.heuristic.summaryMarkdown;
      }
    }
  }

  const repairedSummary = repairBrokenLessonReportSections(summaryMarkdown);
  const polishedSummary = await polishLessonReportSummaryMarkdown({
    markdown: repairedSummary,
    transcript: input.transcript,
  });

  return {
    ...input.result,
    summaryMarkdown: polishedSummary || repairedSummary,
    timeline:
      input.result.timeline.length >= 3 ? input.result.timeline : input.heuristic.timeline,
    nextActions:
      input.result.nextActions.length >= 2 ? input.result.nextActions : input.heuristic.nextActions,
    parentPack: emptyParentPack(),
    recommendedTopics:
      input.result.recommendedTopics.length > 0
        ? input.result.recommendedTopics
        : input.heuristic.recommendedTopics,
    quickQuestions:
      input.result.quickQuestions.length > 0 ? input.result.quickQuestions : input.heuristic.quickQuestions,
    profileSections:
      input.result.profileSections.length > 0 ? input.result.profileSections : input.heuristic.profileSections,
    observationEvents:
      input.result.observationEvents.length > 0
        ? input.result.observationEvents
        : input.heuristic.observationEvents,
    lessonReport: input.result.lessonReport ?? input.heuristic.lessonReport,
  };
}

function buildSummaryMarkdownSpec(isLessonReport: boolean): string[] {
  if (isLessonReport) {
    return [
      "=== summaryMarkdown のフォーマット仕様（指導報告ログ）===",
      "summaryMarkdown は以下の構造に「厳密に」従ってください。見出し記号は ■ を使用し、■ 以外の markdown 見出し（# や ## ）は使わないでください。",
      "",
      "■ 基本情報",
      "対象生徒: {生徒名} 様",
      "指導日: {YYYY年M月D日}",
      "教科・単元: {教科名} / {単元名}  ← 文字起こしから判断して埋める",
      "担当チューター: {講師名}",
      "",
      "■ 1. 本日の指導サマリー（室長向け要約）",
      "室長が3分で授業内容を把握できる密度の段落を書く。以下を必ず含む：",
      "- 今日扱った教科・単元の具体名",
      "- 指導を通じて見えた改善傾向と残課題",
      "- 生徒の学習傾向・癖（例：「学習量」で安心する傾向がある等）",
      "- 今後の方針転換や設計の方向性",
      "",
      "■ 2. 課題と指導成果（Before → After）",
      "トピックごとに以下の構造で書く。トピックは2つ以上。",
      "【トピック名】一行で変化を要約する説明",
      "現状（Before）: 授業前の生徒の状態を具体的に記述。「できていなかった」ではなく何がどうできなかったのか。",
      "成果（After）: 授業を通じてどう変わったか。改善点と残課題の両方を書く。",
      "※特記事項: 演習量への影響、注意点、次回への申し送りなど（該当する場合のみ）",
      "",
      "■ 3. 学習方針と次回アクション（自学習の設計）",
      "まず生徒の学習傾向や判断根拠を1段落で述べる。その後：",
      "次回までの宿題:",
      "  具体的な宿題を箇条書き（教材名・範囲を含む）",
      "次回の確認（テスト）事項:",
      "  次回授業で測定・確認する項目を箇条書き",
      "",
      "■ 4. 室長・他講師への共有・連携事項",
      "他教科への共有: 他の講師に伝えるべき学習傾向や指導方針",
      "エスカレーション（管理者対応）について: 室長の介入が必要かどうかと理由",
      "",
      "=== 品質基準 ===",
      "- 「確認した」「整理した」で終わる文は禁止。何を確認し何が分かったか書く",
      "- Before は「できなかった」ではなく、何がどうできなかったかを教材名・行動レベルで書く",
      "- After は改善点と残課題の両方を必ず書く",
      "- 一般論・抽象論は禁止。生徒固有の具体的事実のみ",
      "- 教科名・テキスト名・単元名・問題種別を可能な限り入れる",
    ];
  }

  return [
    "=== summaryMarkdown のフォーマット仕様（面談ログ）===",
    "summaryMarkdown は以下の構造に「厳密に」従ってください。見出し記号は ■ を使用し、■ 以外の markdown 見出し（# や ## ）は使わないでください。",
    "",
    "■ 基本情報",
    "対象生徒: {生徒名} 様",
    "面談日: {YYYY年M月D日}",
    "面談時間: {N分 または 未記録}",
    "担当チューター: {講師名}",
    "面談目的: {目的。判断できない場合は『学習状況の確認と次回方針の整理』}",
    "",
    "■ 1. サマリー",
    "面談の全体像が伝わる長めの本文を書く。以下を必ず含める：",
    "- 各教科の学習状況（教科名・テキスト名・具体的な進捗を含む）",
    "- 生活面の状況（睡眠・部活・スマホ・勉強時間の実態）",
    "- 進路に関する話題（志望校・模試・検定の具体名を含む）",
    "- 生徒自身の発言から読み取れる本音や自己認識",
    "- 講師の判断・方針・具体的なアドバイス",
    "- 面談の結論と次回までの方針",
    "",
    "■ 2. ポジティブな話題",
    "良い点を5項目前後で列挙する。各項目は『何が良いか』だけでなく、なぜそう言えるかまで具体的に書く。",
    "",
    "■ 3. 改善・対策が必要な話題",
    "課題を4〜6項目前後で列挙する。各項目は『現状の課題 -> 背景や原因 -> 今後の対策』まで一続きの文章で書く。",
    "",
    "=== 品質基準 ===",
    "- 「確認した」「話し合った」で終わる文は禁止。何を確認し何が分かったか書く",
    "- 教科ごとの現状と方針を具体的に書く（「英語は順調」ではなく具体的な進捗を書く）",
    "- 生徒の発言や自己認識を自然に織り込む（「〜と話していた」「〜という認識を持っている」等）",
    "- 一般論・抽象論は禁止。面談で実際に出た固有の事実のみ",
    "- 数ヶ月後に読み返しても文脈が完全に分かる具体性にする",
  ];
}

function buildSessionPromptSpec(sessionType: SessionMode) {
  if (sessionType === "LESSON_REPORT") {
    return {
      analyzeFocus: [
        "授業前の生徒状態・宿題実施状況・本日の狙い",
        "実際に扱った教科・単元・問題の具体名",
        "生徒が止まった箇所と止まった理由",
        "講師が入れた指導とその結果（Before → After）",
        "授業後の理解度・次回までの宿題・次回フォーカス",
      ],
      analyzeRules: [
        "面談のような長期背景を勝手に補わない",
        "授業内で実際に起きた事実を優先し、推測は最小限にする",
        "「英語」「読解」のような抽象語ではなく、単元名・問題番号・行動レベルで書く",
        "各トピックで Before（授業前の状態） と After（授業後の結果）を明確に分ける",
        "授業前と授業後の情報を混同しない",
      ],
      finalizeStyle: [
        "summaryMarkdown は室長が3分で授業内容を把握できる具体性で書く",
        "各トピックを【】で見出し化し、Before→After の構造で成果を明示する",
        "「確認した」「整理した」で終わらせず、何を確認し何が分かったか具体的に書く",
        "保護者・室長・他講師が読んでも理解できる日本語にする",
        "※特記事項があれば補足として明記する",
      ],
    };
  }

  return {
    analyzeFocus: [
      "現在の学習状況（教科別の具体的な進捗・課題）",
      "生活面の状況（睡眠・部活・スマホ・勉強時間の実態）",
      "前回からの変化と、変化の原因",
      "生徒自身の発言から読み取れる本音・感情・自己認識",
      "講師が伝えた判断・方針・アドバイスの具体内容",
      "次回までの具体行動とその理由",
    ],
    analyzeRules: [
      "生徒の状態・背景・次の打ち手のつながりを捉える",
      "雑な感想ではなく、会話中に確認できた具体的事実に限定する",
      "面談の数ヶ月後に読み返しても文脈が分かる具体性で書く",
      "ポジティブな話題と改善が必要な話題を明確に分けて記録する",
      "保護者共有・次回面談・プロフィール更新に使える粒度にする",
    ],
    finalizeStyle: [
      "summaryMarkdown は、サンプルのように『基本情報 / サマリー / ポジティブな話題 / 改善・対策が必要な話題』で構成する",
      "サマリーは、面談の流れが後から読んでも追える長めの本文にする",
      "一般論・抽象論は禁止。教科名・テキスト名・具体行動・生徒の発言を入れる",
      "ポジティブな話題（生徒の成長・意欲・良い変化）を明確に列挙する",
      "改善・対策が必要な話題は、現状と対策案をセットで書く",
      "基本情報の『面談目的』は、会話の主軸が分かる自然な日本語でまとめる",
    ],
  };
}

function buildAnalyzePrompt(sessionType: SessionMode, studentName?: string, teacherName?: string) {
  const spec = buildSessionPromptSpec(sessionType);
  const system = [
    "あなたは学習塾・個別指導の教務責任者です。",
    "与えられた文字起こしチャンクから、後続の会話ログ生成に必要な evidence だけを抽出してください。",
    "出力は厳密な JSON object のみ。",
    "推測は禁止。会話から確認できることだけを書くこと。",
    "ユーザー向け文はすべて自然な日本語にすること。",
    `今回のセッション種別は ${sessionType === "LESSON_REPORT" ? "指導報告ログ" : "面談ログ"} です。`,
    "重視する論点:",
    ...spec.analyzeFocus.map((line) => `- ${line}`),
    "禁止事項:",
    ...spec.analyzeRules.map((line) => `- ${line}`),
  ].join("\n");

  const user = [
    `生徒: ${formatStudentLabel(studentName)}`,
    `講師: ${formatTeacherLabel(teacherName)}`,
    "",
    "出力 JSON 形式:",
    "{",
    '  "facts": ["..."],',
    '  "coaching_points": ["..."],',
    '  "decisions": ["..."],',
    '  "student_state_delta": ["..."],',
    '  "todo_candidates": [',
    '    { "owner": "COACH|STUDENT|PARENT", "action": "...", "due": "YYYY-MM-DD or null", "metric": "...", "why": "...", "evidence_quotes": ["..."] }',
    "  ],",
    '  "timeline_candidates": [',
    '    { "title": "...", "what_happened": "...", "coach_point": "...", "student_state": "...", "evidence_quotes": ["..."] }',
    "  ],",
    '  "profile_delta_candidates": {',
    '    "basic": [{ "field": "...", "value": "...", "confidence": 0, "evidence_quotes": ["..."] }],',
    '    "personal": [{ "field": "...", "value": "...", "confidence": 0, "evidence_quotes": ["..."] }]',
    "  },",
    '  "quotes": ["..."],',
    '  "safety_flags": ["..."]',
    "}",
    "",
    "チャンクごとの厳守ルール:",
    "- 文字起こしに『授業前チェックイン』『授業後チェックアウト』がある場合は、それぞれ授業前 / 授業後の情報として扱う",
    "- facts は抽象語で逃げず、単元・行動・状況が分かる文にする",
    "- coaching_points は講師が伝えた考え方・判断基準・指導の核を書く",
    "- decisions は『何をどう進めるか』『何を次回確認するか』などの決め事を書く",
    "- student_state_delta は気分ではなく、学習上の状態変化が分かる文にする",
    "- timeline_candidates.title は generic な『確認』ではなく論点名にする",
    "- profile_delta_candidates は長く残す価値がある情報だけ。ノイズは入れない",
    "- quotes は短く、意味があるものだけ",
    "- 文字起こしの長文コピペは禁止",
  ].join("\n");

  return { system, user };
}

function buildReducePrompt(sessionType: SessionMode, analyses: ChunkAnalysis[], studentName?: string, teacherName?: string) {
  const spec = buildSessionPromptSpec(sessionType);
  const system = [
    "あなたは学習塾・個別指導の教務責任者です。",
    "複数チャンクの evidence を統合し、重複を除きつつ、後続の最終ログ生成に最適な reduced analysis を作ってください。",
    "出力は厳密な JSON object のみ。",
    "ユーザー向け文はすべて自然な日本語にしてください。",
    `セッション種別: ${sessionType}`,
    "最終ログの狙い:",
    ...spec.finalizeStyle.map((line) => `- ${line}`),
    "統合ルール:",
    "- 同じ意味の項目は統合する",
    "- 具体性が高いものを優先する",
    "- 行動・根拠・論点名を落とさない",
  ].join("\n");

  const user = [
    `生徒: ${formatStudentLabel(studentName)}`,
    `講師: ${formatTeacherLabel(teacherName)}`,
    "",
    "入力 evidence JSON:",
    compactJson(
      analyses.map((item) => ({
        index: item.index,
        facts: item.facts,
        coaching_points: item.coaching_points,
        decisions: item.decisions,
        student_state_delta: item.student_state_delta,
        todo_candidates: item.todo_candidates,
        timeline_candidates: item.timeline_candidates,
        profile_delta_candidates: item.profile_delta_candidates,
        quotes: item.quotes,
        safety_flags: item.safety_flags,
      }))
    ),
    "",
    "出力 JSON 形式:",
    "{",
    '  "facts": ["..."],',
    '  "coaching_points": ["..."],',
    '  "decisions": ["..."],',
    '  "student_state_delta": ["..."],',
    '  "todo_candidates": [...],',
    '  "timeline_candidates": [...],',
    '  "profile_delta_candidates": { "basic": [...], "personal": [...] },',
    '  "quotes": ["..."],',
    '  "safety_flags": ["..."]',
    "}",
  ].join("\n");

  return { system, user };
}

function buildFinalizePrompt(input: {
  sessionType: SessionMode;
  reduced: ReducedAnalysis;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
  minSummaryChars: number;
  minTimelineSections: number;
}) {
  const spec = buildSessionPromptSpec(input.sessionType);
  const isLesson = input.sessionType === "LESSON_REPORT";
  const system = [
    "あなたは学習塾・個別指導の教務責任者です。",
    "reduced evidence だけを使って、最終的なログ本文を生成してください。",
    "出力は厳密な JSON object のみ。",
    "出力するキーは summaryMarkdown のみです。",
    "summaryMarkdown 以外で markdown は使わないでください。",
    `summaryMarkdown は ${input.minSummaryChars} 文字以上にしてください。`,
    "",
    ...buildSummaryMarkdownSpec(isLesson),
    "",
    "品質要件:",
    ...spec.finalizeStyle.map((line) => `- ${line}`),
    "- 『整理した』『確認した』だけで終わらせず、何を整理・確認したか書く",
    "- 英語や placeholder は禁止",
    "- 録音開始時の雑談・相槌・意味が壊れた STT 断片はノイズとして捨てる",
    "- 『授業前チェックイン』『授業後チェックアウト』というラベル自体を本文にコピペしない",
  ].join("\n");

  const user = [
    `生徒: ${formatStudentLabel(input.studentName)}`,
    `講師: ${formatTeacherLabel(input.teacherName)}`,
    `セッション日: ${formatSessionDateLabel(input.sessionDate) || "不明"}`,
    `セッション種別: ${input.sessionType}`,
    "",
    "入力 reduced evidence JSON:",
    compactJson(input.reduced),
    "",
    "出力 JSON 形式:",
    "{",
    '  "summaryMarkdown": "..."',
    "}",
    "",
    "重要ルール:",
    "- 面談ログでは、背景・原因・方針のつながりを出す",
    "- 指導報告ログでは、今日の授業で何が起きたかを最優先で具体化する",
    "- 指導報告ログで『授業前チェックイン』『授業後チェックアウト』がある場合は、開始時点の状態と授業後の結果を混同しない",
    "- 基本情報に書けない項目は捏造せず『未記録』と書く",
  ].join("\n");

  return { system, user };
}

function buildSinglePassPrompt(input: {
  sessionType: SessionMode;
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
  minSummaryChars: number;
  minTimelineSections: number;
}) {
  const spec = buildSessionPromptSpec(input.sessionType);
  const isLesson = input.sessionType === "LESSON_REPORT";
  const system = [
    "あなたは学習塾・個別指導の教務責任者です。",
    "文字起こしから、最終的なログ本文を直接生成してください。",
    "出力は厳密な JSON object のみ。",
    "出力するキーは summaryMarkdown のみです。",
    "summaryMarkdown 以外で markdown は使わないでください。",
    `summaryMarkdown は ${input.minSummaryChars} 文字以上にしてください。`,
    "",
    ...buildSummaryMarkdownSpec(isLesson),
    "",
    "品質要件:",
    ...spec.finalizeStyle.map((line) => `- ${line}`),
    "- 文字起こしの逐語ダンプは禁止",
    "- 雑な一般論・抽象論は禁止",
    "- 何をどう改善するか、後から読んでも分かる具体性にする",
    "- 録音開始時の雑談・相槌・意味が壊れた STT 断片はノイズとして捨てる",
    "- 『授業前チェックイン』『授業後チェックアウト』というラベル自体を本文にコピペしない",
    "- 基本情報に書けない項目は捏造せず『未記録』と書く",
  ].join("\n");

  const user = [
    `生徒: ${formatStudentLabel(input.studentName)}`,
    `講師: ${formatTeacherLabel(input.teacherName)}`,
    `セッション日: ${formatSessionDateLabel(input.sessionDate) || "不明"}`,
    `セッション種別: ${input.sessionType}`,
    "",
    "文字起こし:",
    input.transcript,
    "",
    "出力 JSON 形式:",
    "{",
    '  "summaryMarkdown": "..."',
    "}",
  ].join("\n");

  return { system, user };
}

function buildSummaryMarkdown(
  facts: string[],
  points: string[],
  actions: NextAction[],
  minChars: number,
  sessionType?: SessionMode,
  meta?: { studentName?: string; teacherName?: string; sessionDate?: string | Date | null }
) {
  const isLesson = sessionType === "LESSON_REPORT";
  const lines = isLesson
    ? [
        "■ 基本情報",
        `対象生徒: ${formatStudentLabel(meta?.studentName)} 様`,
        `指導日: ${formatSessionDateLabel(meta?.sessionDate) || "未記録"}`,
        "教科・単元: 文字起こしから確認した内容を整理",
        `担当チューター: ${formatTeacherLabel(meta?.teacherName)}`,
        "",
        "■ 1. 本日の指導サマリー（室長向け要約）",
        ...(facts.length > 0 ? [facts.join(" ")] : ["本日の授業内容を整理した。"]),
        "",
        "■ 2. 課題と指導成果（Before → After）",
        ...(points.length > 0 ? points.map((line) => `- ${line}`) : ["- 授業内での成果を次回確認する。"]),
        "",
        "■ 3. 学習方針と次回アクション（自学習の設計）",
        ...(actions.length > 0
          ? actions.slice(0, 4).map((action) => `- ${ownerLabel(action.owner)}: ${action.action}（指標: ${action.metric}）`)
          : ["- 次回までに回す行動を一つに絞り、実行結果を確認する。"]),
        "",
        "■ 4. 室長・他講師への共有・連携事項",
        "- 現時点で特別な連携事項はなし。",
      ]
    : [
        "■ 基本情報",
        `対象生徒: ${formatStudentLabel(meta?.studentName)} 様`,
        `面談日: ${formatSessionDateLabel(meta?.sessionDate) || "未記録"}`,
        "面談時間: 未記録",
        `担当チューター: ${formatTeacherLabel(meta?.teacherName)}`,
        "面談目的: 学習状況の確認と次回方針の整理",
        "",
        "■ 1. サマリー",
        ...(facts.length > 0 ? [facts.join(" ")] : ["今回の面談で確認した事実を整理した。"]),
        ...(points.length > 0 ? [points.slice(0, 2).join(" ")] : []),
        "",
        "■ 2. ポジティブな話題",
        ...(points.length > 0 ? points.map((line) => `- ${line}`) : ["- 次回確認の中で具体化する。"]),
        "",
        "■ 3. 改善・対策が必要な話題",
        ...(actions.length > 0
          ? actions
              .slice(0, 4)
              .map((action) => `- ${ownerLabel(action.owner)}: ${action.action}。確認指標は ${action.metric}。`)
          : ["- 次回までに回す行動を一つに絞り、実行結果を確認する。"]),
      ];
  let built = lines.join("\n").trim();
  const filler = dedupeStrings([...facts, ...points, ...actions.map((action) => `${action.action} ${action.metric}`)]).slice(0, 6);
  while (built.length < minChars && filler.length > 0) {
    built += `\n- ${filler[built.length % filler.length]}`;
  }
  return built;
}

function ownerLabel(owner: NextAction["owner"]) {
  if (owner === "COACH") return "講師";
  if (owner === "PARENT") return "保護者";
  return "生徒";
}

function buildFallbackNextActions(
  sessionType: SessionMode,
  transcript: string,
  reduced?: ReducedAnalysis
): NextAction[] {
  const evidence = [transcript, ...(reduced?.facts ?? []), ...(reduced?.coaching_points ?? [])].join(" ");
  if (sessionType === "LESSON_REPORT") {
    return normalizeNextActions([
      {
        owner: "STUDENT",
        action: sanitizeSentence(/宿題/.test(evidence) ? "今日決めた宿題を実行し、分からなかった箇所を1つメモする。" : "授業で扱った内容を復習し、止まった箇所を1つメモする。"),
        due: null,
        metric: "実行内容と、止まった箇所が1件以上残っている。",
        why: "次回授業で、どこから立て直すかを具体的に確認するため。",
      },
      {
        owner: "COACH",
        action: "次回授業の冒頭で、実行結果とつまずいた原因を確認する。",
        due: null,
        metric: "できたこと1点と、止まった点1点を確認する。",
        why: "授業の続きを感覚ではなく、実行結果ベースで始めるため。",
      },
    ]);
  }

  return normalizeNextActions([
    {
      owner: "STUDENT",
      action: "次回までに決めた学習を一つ実行し、やった内容と止まった理由を記録する。",
      due: null,
      metric: "実行内容が1件以上あり、止まった理由も書かれている。",
      why: "次回面談を感覚ではなく事実ベースで進めるため。",
    },
    {
      owner: "COACH",
      action: "次回の会話で、実行結果と止まった理由を一緒に言語化する。",
      due: null,
      metric: "進んだ点1つと詰まった点1つを確認する。",
      why: "次の打ち手を具体化するため。",
    },
  ]);
}

function buildFallbackTimeline(
  sessionType: SessionMode,
  transcript: string,
  reduced?: ReducedAnalysis,
  minSections = 2
): TimelineSection[] {
  const sections = normalizeTimeline(reduced?.timeline_candidates ?? []);
  if (sections.length >= minSections) return sections.slice(0, minSections + 1);

  const lines = summarizeTranscriptEvidence(transcript, 9);
  const fallback: TimelineSection[] = [];

  if (sessionType === "LESSON_REPORT") {
    fallback.push(
      {
        title: "今日の授業で扱ったこと",
        what_happened: sanitizeSentence(lines[0] || reduced?.facts?.[0], { maxLength: 180 }) || "今日の授業で扱った論点を確認した。",
        coach_point: sanitizeSentence(reduced?.coaching_points?.[0], { maxLength: 180 }) || "授業中にどこで止まったかを具体化して、次の一手を揃える。",
        student_state: sanitizeSentence(reduced?.student_state_delta?.[0], { maxLength: 140 }) || "授業内での反応から、次回の立て直しポイントが見えている。",
        evidence_quotes: sanitizeQuotes(lines.slice(0, 2)),
      },
      {
        title: "次回までの宿題と確認事項",
        what_happened: sanitizeSentence(reduced?.decisions?.[0] || lines[1], { maxLength: 180 }) || "次回までに回す宿題と確認事項を整理した。",
        coach_point: sanitizeSentence(reduced?.coaching_points?.[1], { maxLength: 180 }) || "宿題は量よりも、止まったポイントが分かる形で残す。",
        student_state: sanitizeSentence(reduced?.student_state_delta?.[1], { maxLength: 140 }) || "授業後の復習で理解を固める必要がある。",
        evidence_quotes: sanitizeQuotes(lines.slice(2, 4)),
      }
    );
  } else {
    fallback.push(
      {
        title: "今回見えていた現状",
        what_happened: sanitizeSentence(reduced?.facts?.[0] || lines[0], { maxLength: 180 }) || "現在の学習状況と気になっている点を確認した。",
        coach_point: sanitizeSentence(reduced?.coaching_points?.[0], { maxLength: 180 }) || "何を優先して立て直すかを先に決める必要がある。",
        student_state: sanitizeSentence(reduced?.student_state_delta?.[0], { maxLength: 140 }) || "大きく崩れてはいないが、詰まりの原因整理が必要である。",
        evidence_quotes: sanitizeQuotes(lines.slice(0, 2)),
      },
      {
        title: "次回までの進め方",
        what_happened: sanitizeSentence(reduced?.decisions?.[0] || lines[1], { maxLength: 180 }) || "次回までに回す行動と、確認したい観点を整理した。",
        coach_point: sanitizeSentence(reduced?.coaching_points?.[1], { maxLength: 180 }) || "やることを一つに絞り、結果が確認できる形で残す。",
        student_state: sanitizeSentence(reduced?.student_state_delta?.[1], { maxLength: 140 }) || "次に何を試せばよいかは見え始めている。",
        evidence_quotes: sanitizeQuotes(lines.slice(2, 4)),
      }
    );
  }

  return normalizeTimeline([...sections, ...fallback]).slice(0, Math.max(minSections, 2));
}

function buildFallbackStudentState(sessionType: SessionMode, reduced: ReducedAnalysis, transcript: string): StudentStateCard {
  const evidence = [transcript, ...reduced.student_state_delta, ...reduced.facts, ...reduced.coaching_points].join(" ");
  const label = inferStateLabel(evidence);
  const rationale = takeUniqueLines([...reduced.student_state_delta, ...reduced.facts, ...reduced.quotes], 3, { maxLength: 120 });
  return normalizeStudentState({
    label,
    oneLiner: stateOneLiner(label, sessionType),
    rationale,
    confidence: rationale.length > 0 ? 78 : 60,
  });
}

function buildFallbackProfileSections(reduced: ReducedAnalysis, transcript: string): ProfileSection[] {
  const delta = normalizeProfileDelta(reduced.profile_delta_candidates);
  const grouped = new Map<ProfileCategory, ProfileSection>();

  for (const item of [...delta.basic, ...delta.personal]) {
    const category = inferCategory(`${item.field} ${item.value}`);
    const current = grouped.get(category) ?? {
      category,
      status: "維持" as ProfileSectionStatus,
      highlights: [],
      nextQuestion: "",
    };
    current.highlights.push({
      label: item.field,
      value: item.value,
      isNew: true,
      isUpdated: false,
    });
    if (!current.nextQuestion) {
      current.nextQuestion = `「${item.value.slice(0, 24)}」について、次回もう少し詳しく確認したい。`;
    }
    grouped.set(category, current);
  }

  if (grouped.size === 0) {
    for (const line of summarizeTranscriptEvidence(transcript, 4)) {
      const category = inferCategory(line);
      const current = grouped.get(category) ?? {
        category,
        status: "不明" as ProfileSectionStatus,
        highlights: [],
        nextQuestion: "",
      };
      current.highlights.push({
        label: category === "学習" ? "今回の論点" : `${category}の論点`,
        value: line,
        isNew: true,
        isUpdated: false,
      });
      if (!current.nextQuestion) current.nextQuestion = "次回、背景と具体例をもう一段確認したい。";
      grouped.set(category, current);
      if (grouped.size >= 3) break;
    }
  }

  return normalizeProfileSections(Array.from(grouped.values()));
}

function buildFallbackRecommendedTopics(profileSections: ProfileSection[], actions: NextAction[]): RecommendedTopic[] {
  const topics: RecommendedTopic[] = [];
  for (const section of profileSections) {
    const highlight = section.highlights[0];
    topics.push({
      category: section.category,
      title: highlight ? highlight.label : `${section.category}の確認`,
      reason: highlight ? `${highlight.value}という論点があり、次の判断材料になるため。` : `${section.category}で追加確認が必要なため。`,
      question: section.nextQuestion || "次回、もう少し具体的に確認したい。",
      priority: topics.length + 1,
    });
  }
  for (const action of actions) {
    topics.push({
      category: inferCategory(`${action.action} ${action.metric}`),
      title: "実行状況の確認",
      reason: action.why,
      question: `「${action.action.slice(0, 28)}」はどこまで進んだ？`,
      priority: topics.length + 1,
    });
    if (topics.length >= 6) break;
  }
  return normalizeRecommendedTopics(topics);
}

function buildFallbackObservationEvents(
  sessionType: SessionMode,
  profileSections: ProfileSection[],
  actions: NextAction[],
  transcript: string
): ObservationEvent[] {
  const evidence = summarizeTranscriptEvidence(transcript, 4);
  return normalizeObservationEvents(
    profileSections.map((section) => ({
      sourceType: sessionType,
      category: section.category,
      statusDraft: section.status,
      insights: section.highlights.map((item) => `${item.label}: ${item.value}`),
      topics: section.highlights.map((item) => item.label),
      nextActions: actions.map((item) => item.action).slice(0, 3),
      evidence,
      characterSignal: section.highlights[0]?.value ?? "",
      weight: sessionType === "LESSON_REPORT" ? 2 : 4,
    }))
  );
}

function buildFallbackLessonReport(
  sessionType: SessionMode,
  timeline: TimelineSection[],
  actions: NextAction[],
  transcript: string
): LessonReportArtifact | null {
  if (sessionType !== "LESSON_REPORT") return null;
  const lines = summarizeTranscriptEvidence(transcript, 8);
  const checkInLines = summarizeTranscriptEvidence(extractMarkdownSectionBody(transcript, "授業前チェックイン"), 4);
  const checkOutLines = summarizeTranscriptEvidence(extractMarkdownSectionBody(transcript, "授業後チェックアウト"), 6);
  return normalizeLessonReport({
    todayGoal: checkInLines[0] || timeline[0]?.title || lines[0] || "今日の授業で扱う論点を明確にする。",
    covered: dedupeStrings([
      ...timeline.map((item) => item.what_happened).filter(Boolean),
      ...checkOutLines.slice(0, 2),
    ]).slice(0, 3),
    blockers: dedupeStrings([
      ...timeline.map((item) => item.student_state).filter(Boolean),
      ...checkOutLines.filter((line) => /止ま|詰|苦手|できな|わから|迷/.test(line)),
    ]).slice(0, 3),
    homework: actions.filter((action) => action.owner === "STUDENT").map((action) => action.action).slice(0, 3),
    nextLessonFocus: dedupeStrings([
      ...actions.map((action) => action.metric),
      ...checkOutLines.slice(0, 2),
    ]).slice(0, 3),
    parentShareDraft: checkOutLines[0] || lines[1],
  });
}

function buildHeuristicFinalize(
  sessionType: SessionMode,
  transcript: string,
  reduced: ReducedAnalysis,
  minSummaryChars: number,
  minTimelineSections: number,
  meta?: { studentName?: string; teacherName?: string; sessionDate?: string | Date | null }
): FinalizeResult {
  const nextActions =
    normalizeNextActions(reduced.todo_candidates ?? []).length > 0
      ? normalizeNextActions(reduced.todo_candidates ?? [])
      : buildFallbackNextActions(sessionType, transcript, reduced);

  const timeline = buildFallbackTimeline(sessionType, transcript, reduced, minTimelineSections);
  const profileDelta = normalizeProfileDelta(reduced.profile_delta_candidates);
  const profileSections = buildFallbackProfileSections(reduced, transcript);
  const recommendedTopics = buildFallbackRecommendedTopics(profileSections, nextActions);
  const quickQuestions = normalizeQuickQuestions(
    recommendedTopics.map((item) => ({
      category: item.category,
      question: item.question,
      reason: item.reason,
    }))
  );
  const studentState = buildFallbackStudentState(sessionType, reduced, transcript);
  const observationEvents = buildFallbackObservationEvents(sessionType, profileSections, nextActions, transcript);
  const lessonReport = buildFallbackLessonReport(sessionType, timeline, nextActions, transcript);
  const facts = dedupeStrings([...reduced.facts, ...timeline.map((item) => item.what_happened)]).slice(0, 6);
  const points = dedupeStrings([...reduced.coaching_points, ...timeline.map((item) => item.coach_point)]).slice(0, 6);

  return {
    summaryMarkdown: buildSummaryMarkdown(facts, points, nextActions, minSummaryChars, sessionType, meta),
    timeline,
    nextActions,
    profileDelta,
    parentPack: emptyParentPack(),
    studentState,
    recommendedTopics,
    quickQuestions,
    profileSections,
    observationEvents,
    lessonReport,
  };
}

function hasProfileDeltaContent(delta: ProfileDelta) {
  return delta.basic.length > 0 || delta.personal.length > 0;
}

function hasStudentStateContent(studentState: StudentStateCard) {
  return Boolean(studentState.oneLiner?.trim()) || studentState.rationale.length > 0;
}

function fillMissingFinalizeResult(primary: FinalizeResult, fallback: FinalizeResult): FinalizeResult {
  return {
    summaryMarkdown: primary.summaryMarkdown || fallback.summaryMarkdown,
    timeline: primary.timeline.length > 0 ? primary.timeline : fallback.timeline,
    nextActions: primary.nextActions.length > 0 ? primary.nextActions : fallback.nextActions,
    profileDelta: hasProfileDeltaContent(primary.profileDelta) ? primary.profileDelta : fallback.profileDelta,
    parentPack: primary.parentPack,
    studentState: hasStudentStateContent(primary.studentState) ? primary.studentState : fallback.studentState,
    recommendedTopics:
      primary.recommendedTopics.length > 0 ? primary.recommendedTopics : fallback.recommendedTopics,
    quickQuestions: primary.quickQuestions.length > 0 ? primary.quickQuestions : fallback.quickQuestions,
    profileSections: primary.profileSections.length > 0 ? primary.profileSections : fallback.profileSections,
    observationEvents:
      primary.observationEvents.length > 0 ? primary.observationEvents : fallback.observationEvents,
    lessonReport: primary.lessonReport ?? fallback.lessonReport,
  };
}

function isWeakFinalize(
  result: FinalizeResult,
  minSummaryChars: number,
  minTimelineSections: number,
  sessionType: SessionMode = "INTERVIEW"
) {
  if (sessionType === "LESSON_REPORT") {
    if (!result.summaryMarkdown) return true;
    if (isWeakLessonReportSummary(result.summaryMarkdown, Math.min(minSummaryChars, 700))) return true;
    return false;
  }
  if (!result.summaryMarkdown) return true;
  return isWeakInterviewSummary(result.summaryMarkdown, minSummaryChars);
}

async function repairFinalizeResult(input: {
  sessionType: SessionMode;
  transcriptOrEvidence: string;
  current: FinalizeResult;
  studentName?: string;
  teacherName?: string;
  minSummaryChars: number;
  minTimelineSections: number;
}): Promise<FinalizeResult | null> {
  const system = [
    "あなたは学習塾・個別指導の教務責任者です。",
    "現在の JSON を改善し、抜けている具体性を補ってください。",
    "出力は厳密な JSON object のみ。",
    "英語・placeholder・一般論は禁止です。",
    `セッション種別: ${input.sessionType}`,
  ].join("\n");

  const user = [
    `生徒: ${formatStudentLabel(input.studentName)}`,
    `講師: ${formatTeacherLabel(input.teacherName)}`,
    "",
    "不足している点:",
    "- summaryMarkdown が弱い場合は、何が事実で、何が講師の判断で、次回何をするかまで補う",
    "- 面談なら『基本情報 / サマリー / ポジティブな話題 / 改善・対策が必要な話題』を崩さない",
    "- 指導報告なら『基本情報 / 本日の指導サマリー / 課題と指導成果 / 学習方針と次回アクション / 共有事項』を崩さない",
    "- 面談なら背景と方針、指導報告なら今日の授業内容と宿題を明確にする",
    "",
    "現在の JSON:",
    compactJson(input.current),
    "",
    "参考 evidence:",
    input.transcriptOrEvidence,
  ].join("\n");

  try {
    const { contentText, raw } = await callChatCompletions({
      model: getFinalModel(),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS * 2,
      max_completion_tokens: FINALIZE_MAX_TOKENS,
    });
    const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
    return tryParseJson<FinalizeResult>(jsonText);
  } catch {
    return null;
  }
}

export async function analyzeChunkBlocks(
  blocks: Array<{ index: number; text: string; hash: string }>,
  opts: { studentName?: string; teacherName?: string; sessionType?: SessionMode }
): Promise<{ analyses: ChunkAnalysis[]; model: string; apiCalls: number }> {
  if (blocks.length === 0) {
    return { analyses: [], model: getFastModel(), apiCalls: 0 };
  }

  const model = getFastModel();
  const sessionType = opts.sessionType ?? "INTERVIEW";
  const { system, user } = buildAnalyzePrompt(sessionType, opts.studentName, opts.teacherName);

  const analyzeOne = async (block: { index: number; text: string; hash: string }): Promise<ChunkAnalysis> => {
    const prompt = [
      user,
      "",
      `対象チャンク #${block.index + 1}:`,
      block.text,
    ].join("\n");

    let parsed: Partial<ChunkAnalysis> | null = null;
    try {
      const { contentText, raw } = await callChatCompletions({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_completion_tokens: ANALYZE_MAX_TOKENS,
      });
      const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
      parsed = tryParseJson<Partial<ChunkAnalysis>>(jsonText);
    } catch {
      parsed = null;
    }

    if (!parsed) {
      const lines = summarizeTranscriptEvidence(block.text, 6);
      const category = inferCategory(lines.join(" "));
      parsed = {
        facts: lines.slice(0, 4),
        coaching_points: lines.slice(0, 2).map((line) =>
          sessionType === "LESSON_REPORT"
            ? `授業内で扱った論点を具体化すると「${line}」である。`
            : `会話の核を具体化すると「${line}」である。`
        ),
        decisions: lines.slice(2, 4),
        student_state_delta: [stateOneLiner(inferStateLabel(lines.join(" ")), sessionType)],
        todo_candidates: buildFallbackNextActions(sessionType, block.text).map((action) => ({
          ...action,
          evidence_quotes: [],
        })),
        timeline_candidates: buildFallbackTimeline(sessionType, block.text, undefined, 2),
        profile_delta_candidates: {
          basic: [
            {
              field: category,
              value: lines[0] || (sessionType === "LESSON_REPORT" ? "授業で扱った論点" : "今回の会話で出た論点"),
              confidence: 40,
              evidence_quotes: sanitizeQuotes(lines.slice(0, 1)),
            },
          ],
          personal: [],
        },
        quotes: sanitizeQuotes(lines.slice(0, 2)),
        safety_flags: [],
      };
    }

    return normalizeChunkAnalysis(parsed, block.index, block.hash);
  };

  const results = await Promise.all(blocks.map(analyzeOne));
  return { analyses: results, model, apiCalls: blocks.length };
}

export async function reduceChunkAnalyses(input: {
  analyses: ChunkAnalysis[];
  studentName?: string;
  teacherName?: string;
  sessionType?: SessionMode;
}): Promise<{ reduced: ReducedAnalysis; model: string; apiCalls: number }> {
  if (input.analyses.length === 0) {
    return {
      reduced: normalizeReducedAnalysis({
        facts: [],
        coaching_points: [],
        decisions: [],
        student_state_delta: [],
        todo_candidates: [],
        timeline_candidates: [],
        profile_delta_candidates: { basic: [], personal: [] },
        quotes: [],
        safety_flags: [],
      }),
      model: getFastModel(),
      apiCalls: 0,
    };
  }

  if (input.analyses.length === 1) {
    return {
      reduced: normalizeReducedAnalysis(input.analyses[0]),
      model: "reuse-single",
      apiCalls: 0,
    };
  }

  const model = getFastModel();
  const sessionType = input.sessionType ?? "INTERVIEW";
  const { system, user } = buildReducePrompt(sessionType, input.analyses, input.studentName, input.teacherName);
  let parsed: Partial<ReducedAnalysis> | null = null;
  let apiCalls = 0;

  try {
    apiCalls += 1;
    const { contentText, raw } = await callChatCompletions({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_completion_tokens: REDUCE_MAX_TOKENS,
      prompt_cache_key: buildPromptCacheKey("reduce", sessionType),
      prompt_cache_retention: supportsExtendedPromptCaching(model) ? "24h" : "in_memory",
    });
    const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
    parsed = tryParseJson<Partial<ReducedAnalysis>>(jsonText);
  } catch {
    parsed = null;
  }

  if (!parsed) {
    parsed = {
      facts: input.analyses.flatMap((item) => item.facts),
      coaching_points: input.analyses.flatMap((item) => item.coaching_points),
      decisions: input.analyses.flatMap((item) => item.decisions),
      student_state_delta: input.analyses.flatMap((item) => item.student_state_delta),
      todo_candidates: input.analyses.flatMap((item) => item.todo_candidates),
      timeline_candidates: input.analyses.flatMap((item) => item.timeline_candidates),
      profile_delta_candidates: {
        basic: input.analyses.flatMap((item) => item.profile_delta_candidates.basic),
        personal: input.analyses.flatMap((item) => item.profile_delta_candidates.personal),
      },
      quotes: input.analyses.flatMap((item) => item.quotes),
      safety_flags: input.analyses.flatMap((item) => item.safety_flags),
    };
  }

  return { reduced: normalizeReducedAnalysis(parsed), model, apiCalls };
}

export async function finalizeConversationArtifacts(input: {
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
  reduced: ReducedAnalysis;
  minSummaryChars: number;
  minTimelineSections?: number;
  sessionType?: SessionMode;
}): Promise<{ result: FinalizeResult; model: string; apiCalls: number; repaired: boolean }> {
  const sessionType = input.sessionType ?? "INTERVIEW";
  const minTimelineSections = input.minTimelineSections ?? 2;
  const model = getFinalModel();
  const { system, user } = buildFinalizePrompt({
    sessionType,
    reduced: input.reduced,
    studentName: input.studentName,
    teacherName: input.teacherName,
    sessionDate: input.sessionDate,
    minSummaryChars: input.minSummaryChars,
    minTimelineSections,
  });

  let parsed: Partial<FinalizeResult> | null = null;
  let apiCalls = 0;
  let repaired = false;

  try {
    apiCalls += 1;
    const { contentText, raw } = await callChatCompletions({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS * 2,
      max_completion_tokens: FINALIZE_MAX_TOKENS,
      prompt_cache_key: buildPromptCacheKey("finalize", sessionType),
      prompt_cache_retention: supportsExtendedPromptCaching(model) ? "24h" : "in_memory",
    });
    const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
    parsed = tryParseJson<Partial<FinalizeResult>>(jsonText);
  } catch {
    parsed = null;
  }

  const evidenceText = JSON.stringify(input.reduced);
  const heuristic = buildHeuristicFinalize(
    sessionType,
    evidenceText,
    input.reduced,
    input.minSummaryChars,
    minTimelineSections,
    {
      studentName: input.studentName,
      teacherName: input.teacherName,
      sessionDate: input.sessionDate,
    }
  );
  let result = parsed
    ? normalizeFinalizeResult(parsed, sessionType, input.minSummaryChars)
    : heuristic;

  if (ENABLE_FINALIZE_REPAIR && isWeakFinalize(result, input.minSummaryChars, minTimelineSections, sessionType)) {
    const repairedResult = await repairFinalizeResult({
      sessionType,
      transcriptOrEvidence: evidenceText,
      current: result,
      studentName: input.studentName,
      teacherName: input.teacherName,
      minSummaryChars: input.minSummaryChars,
      minTimelineSections,
    });
    if (repairedResult) {
      apiCalls += 1;
      repaired = true;
      const normalized = normalizeFinalizeResult(repairedResult, sessionType, input.minSummaryChars);
      if (!isWeakFinalize(normalized, input.minSummaryChars, minTimelineSections, sessionType)) {
        result = normalized;
      }
    }
  }

  if (sessionType === "LESSON_REPORT") {
    result = await stabilizeLessonReportResult({
      result,
      heuristic,
      transcript: evidenceText,
      studentName: input.studentName,
      teacherName: input.teacherName,
      sessionDate: input.sessionDate,
      minSummaryChars: input.minSummaryChars,
    });
  } else if (isWeakFinalize(result, input.minSummaryChars, minTimelineSections, sessionType)) {
    result = heuristic;
    repaired = false;
  }

  return { result, model, apiCalls, repaired };
}

export async function generateConversationArtifactsSinglePass(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
  minSummaryChars: number;
  minTimelineSections?: number;
  sessionType?: SessionMode;
}): Promise<{ result: FinalizeResult; model: string; apiCalls: number; repaired: boolean }> {
  const sessionType = input.sessionType ?? "INTERVIEW";
  const minTimelineSections = input.minTimelineSections ?? 2;
  const model = getFinalModel();
  const singlePassMaxTokens =
    sessionType === "LESSON_REPORT"
      ? Math.max(SINGLE_PASS_MAX_TOKENS, 5200)
      : SINGLE_PASS_MAX_TOKENS;
  const { system, user } = buildSinglePassPrompt({
    sessionType,
    transcript: input.transcript,
    studentName: input.studentName,
    teacherName: input.teacherName,
    sessionDate: input.sessionDate,
    minSummaryChars: input.minSummaryChars,
    minTimelineSections,
  });

  let parsed: Partial<FinalizeResult> | null = null;
  let apiCalls = 0;
  let repaired = false;

  const requestSinglePass = async (strictRetry = false) => {
    const { contentText, raw } = await callChatCompletions({
      model,
      messages: strictRetry
        ? [
            { role: "system", content: `${system}\n前回の出力で JSON 以外が混ざったため、今回は厳密な JSON object のみを返してください。` },
            { role: "user", content: `${user}\n\n注意: 余計な前置き・説明・markdown を一切出さず、JSON object だけを返してください。` },
          ]
        : [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS * 2,
      max_completion_tokens: singlePassMaxTokens,
      prompt_cache_key: buildPromptCacheKey(strictRetry ? "single-pass-retry" : "single-pass", sessionType),
      prompt_cache_retention: supportsExtendedPromptCaching(model) ? "24h" : "in_memory",
    });
    const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
    return tryParseJson<Partial<FinalizeResult>>(jsonText);
  };

  try {
    apiCalls += 1;
    parsed = await requestSinglePass(false);
    if (!parsed) {
      apiCalls += 1;
      repaired = true;
      parsed = await requestSinglePass(true);
    }
  } catch {
    parsed = null;
  }

  if (!parsed) {
    throw new Error("single-pass generation returned invalid JSON");
  }

  const reducedFallback = normalizeReducedAnalysis({
    facts: summarizeTranscriptEvidence(input.transcript, 8),
    coaching_points: summarizeTranscriptEvidence(input.transcript, 6),
    decisions: summarizeTranscriptEvidence(input.transcript, 4),
    student_state_delta: [stateOneLiner(inferStateLabel(input.transcript), sessionType)],
    todo_candidates: buildFallbackNextActions(sessionType, input.transcript).map((action) => ({
      ...action,
      evidence_quotes: [],
    })),
    timeline_candidates: buildFallbackTimeline(sessionType, input.transcript, undefined, minTimelineSections),
    profile_delta_candidates: { basic: [], personal: [] },
    quotes: summarizeTranscriptEvidence(input.transcript, 2),
    safety_flags: [],
  });
  const structuralFallback = buildHeuristicFinalize(
    sessionType,
    input.transcript,
    reducedFallback,
    input.minSummaryChars,
    minTimelineSections,
    {
      studentName: input.studentName,
      teacherName: input.teacherName,
      sessionDate: input.sessionDate,
    }
  );
  let result = normalizeFinalizeResult(parsed, sessionType, input.minSummaryChars);
  result = fillMissingFinalizeResult(result, structuralFallback);

  if (sessionType === "LESSON_REPORT") {
    const normalizedTimeline =
      result.timeline.length >= minTimelineSections
        ? result.timeline
        : buildFallbackTimeline(sessionType, input.transcript, undefined, minTimelineSections);
    const normalizedNextActions =
      result.nextActions.length > 0
        ? result.nextActions
        : buildFallbackNextActions(sessionType, input.transcript).slice(0, 3);
    result = {
      ...result,
      timeline: normalizedTimeline,
      nextActions: normalizedNextActions,
      lessonReport:
        result.lessonReport ?? buildFallbackLessonReport(sessionType, normalizedTimeline, normalizedNextActions, input.transcript),
    };
  }

  if (sessionType === "LESSON_REPORT" && isWeakFinalize(result, input.minSummaryChars, minTimelineSections, sessionType)) {
    const rewrittenSummary = await rewriteLessonReportSummaryMarkdown({
      transcript: input.transcript,
      studentName: input.studentName,
      teacherName: input.teacherName,
      sessionDate: input.sessionDate,
      minSummaryChars: input.minSummaryChars,
      current: result.summaryMarkdown,
      lessonReport: result.lessonReport,
      nextActions: result.nextActions,
      forceCompleteSentences: true,
    });
    if (rewrittenSummary) {
      apiCalls += 1;
      repaired = true;
      result = {
        ...result,
        summaryMarkdown: repairBrokenLessonReportSections(rewrittenSummary),
      };
    }
  } else if (ENABLE_FINALIZE_REPAIR && isWeakFinalize(result, input.minSummaryChars, minTimelineSections, sessionType)) {
    const repairedResult = await repairFinalizeResult({
      sessionType,
      transcriptOrEvidence: input.transcript,
      current: result,
      studentName: input.studentName,
      teacherName: input.teacherName,
      minSummaryChars: input.minSummaryChars,
      minTimelineSections,
    });
    if (repairedResult) {
      apiCalls += 1;
      repaired = true;
      result = normalizeFinalizeResult(repairedResult, sessionType, input.minSummaryChars);
    }
  }

  if (sessionType === "LESSON_REPORT" && result.summaryMarkdown) {
    let summaryMarkdown = repairBrokenSummaryLineBreaks(repairBrokenLessonReportSections(result.summaryMarkdown));
    if (hasBrokenLessonReportPhrasing(summaryMarkdown)) {
      summaryMarkdown = repairBrokenSummaryLineBreaks(
        repairBrokenLessonReportSections(
          await polishLessonReportSummaryMarkdown({
            markdown: summaryMarkdown,
            transcript: input.transcript,
          })
        )
      );
      apiCalls += 1;
      repaired = true;
    }
    result = {
      ...result,
      summaryMarkdown,
    };
  } else if (result.summaryMarkdown) {
    result = {
      ...result,
      summaryMarkdown: repairBrokenSummaryLineBreaks(result.summaryMarkdown),
    };
  }

  if (isWeakFinalize(result, input.minSummaryChars, minTimelineSections, sessionType)) {
    throw new Error("single-pass generation quality insufficient");
  }

  return { result, model, apiCalls, repaired };
}

export function getPromptVersion() {
  return PROMPT_VERSION;
}
