
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
const PROMPT_VERSION = "v2.0";

const DEFAULT_LLM_TIMEOUT_MS = clampInt(Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000), 10000, 240000);
const ANALYZE_MAX_TOKENS = clampInt(Number(process.env.ANALYZE_MAX_TOKENS ?? 1600), 500, 4000);
const REDUCE_MAX_TOKENS = clampInt(Number(process.env.REDUCE_MAX_TOKENS ?? 2200), 900, 5000);
const FINALIZE_MAX_TOKENS = clampInt(Number(process.env.FINALIZE_MAX_TOKENS ?? 3200), 1200, 7000);
const SINGLE_PASS_MAX_TOKENS = clampInt(Number(process.env.SINGLE_PASS_MAX_TOKENS ?? 3600), 1200, 8000);
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

async function callChatCompletions(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
  timeoutMs?: number;
}): Promise<ChatResult> {
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY (or OPENAI_API_KEY) is not set.");
  }

  const timeoutMs = Math.max(10000, params.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
  const bodyBase: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    ...(params.max_completion_tokens || params.max_tokens
      ? { max_completion_tokens: params.max_completion_tokens ?? params.max_tokens }
      : {}),
    ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
    ...(params.response_format ? { response_format: params.response_format } : {}),
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

  let { res, raw } = await requestOnce(bodyBase);
  if (!res.ok) {
    const defaultTempOnly =
      res.status === 400 &&
      typeof bodyBase.temperature === "number" &&
      /temperature/i.test(raw) &&
      /default\s*\(1\)/i.test(raw);

    if (defaultTempOnly) {
      const retryBody = { ...bodyBase };
      delete retryBody.temperature;
      const retried = await requestOnce(retryBody);
      res = retried.res;
      raw = retried.raw;
    }
  }

  if (!res.ok) {
    throw new Error(`LLM API failed (${res.status}): ${raw}`);
  }

  const data = tryParseJson<ChatCompletionResponse>(raw);
  if (!data) return { raw, contentText: null };
  return { raw, ...extractChatCompletionContent(data) };
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
  return forceGpt5Family(process.env.LLM_MODEL_FAST || process.env.LLM_MODEL || "gpt-5-mini");
}

function getFinalModel() {
  return forceGpt5Family(process.env.LLM_MODEL_FINAL || process.env.LLM_MODEL || "gpt-5.4");
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

function normalizeWhitespace(text: unknown) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
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

function sanitizeQuotes(quotes: unknown[]) {
  return (quotes ?? [])
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

function takeUniqueLines(values: unknown[], limit: number, opts?: { maxLength?: number; allowShort?: boolean }) {
  return dedupeStrings(
    (values ?? [])
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
  const normalizeList = (items: Array<Partial<ProfileDeltaItem> | null | undefined>) =>
    items.map(normalizeProfileDeltaItem).filter((item): item is ProfileDeltaItem => Boolean(item)).slice(0, 8);
  return {
    basic: normalizeList(delta?.basic ?? []),
    personal: normalizeList(delta?.personal ?? []),
  };
}

function normalizeTimeline(items: Array<Partial<TimelineSection | TimelineCandidate> | null | undefined>): TimelineSection[] {
  return items
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

function normalizeNextActions(items: Array<Partial<NextAction | TodoCandidate> | null | undefined>): NextAction[] {
  return items
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
  return items
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
  return items
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
  return items
    .map((item) => {
      const highlights = (item?.highlights ?? [])
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
  return items
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
    parentPack: normalizeParentPack(item?.parentPack),
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
      if (line.startsWith("## ")) return line;
      if (line.startsWith("- ") || /^\d+\./.test(line)) return line;
      const cleaned = sanitizeSentence(line, { maxLength: 220, allowShort: true });
      return cleaned || "";
    })
    .filter(Boolean);
  const rebuilt = lines.join("\n");
  return rebuilt.length >= Math.min(180, minChars) ? rebuilt : "";
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
    .map((line) => normalizeWhitespace(line.replace(/^\*\*[^*]+\*\*:\s*/g, "")))
    .filter(Boolean)
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

function buildSessionPromptSpec(sessionType: SessionMode) {
  if (sessionType === "LESSON_REPORT") {
    return {
      analyzeFocus: [
        "授業前チェックインで出た状態・宿題実施状況・今日の狙い",
        "実際に扱った内容",
        "生徒が止まった具体ポイント",
        "講師が入れた指導",
        "授業後チェックアウトで出た理解・宿題・次回フォーカス",
      ],
      analyzeRules: [
        "面談のような長期背景を勝手に補わない",
        "授業内で起きた事実を優先する",
        "抽象語ではなく、単元・問題・行動で書く",
        "lesson report に直結する情報を優先する",
        "『授業前チェックイン』と『授業後チェックアウト』を混同しない",
      ],
      finalizeStyle: [
        "summaryMarkdown は授業の記録として読める具体性にする",
        "timeline は『今日の目標』『授業中の詰まり』『次回までの宿題』のような具体タイトルを優先する",
        "nextActions は宿題・講師確認事項・必要なら保護者共有の3系統で整理する",
        "lessonReport は todayGoal / covered / blockers / homework / nextLessonFocus を必ず具体化する",
        "授業前チェックインは開始時点の状態、授業後チェックアウトは授業後の結果・宿題・次回確認として扱う",
      ],
    };
  }

  return {
    analyzeFocus: [
      "現在の学習状況・生活状況",
      "前回からの変化",
      "詰まりの原因",
      "講師が伝えた判断や方針",
      "次回までの具体行動",
    ],
    analyzeRules: [
      "生徒の状態・背景・次の打ち手をつなげて捉える",
      "雑な感想ではなく、会話で確認できた事実に限定する",
      "面談ログとして後から読んでも文脈が分かる具体性で書く",
      "保護者共有・次回面談・プロフィール更新に使える粒度にする",
    ],
    finalizeStyle: [
      "summaryMarkdown は単なる要約ではなく、現状・原因・方針が分かる記録にする",
      "timeline は『何が起きたか』『講師が何を見立てたか』『生徒がどういう状態か』を1節ごとに分ける",
      "nextActions は生徒と講師の行動を分け、確認指標を明記する",
      "recommendedTopics と quickQuestions は次回面談でそのまま使える具体質問にする",
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
  minSummaryChars: number;
  minTimelineSections: number;
}) {
  const spec = buildSessionPromptSpec(input.sessionType);
  const system = [
    "あなたは学習塾・個別指導の教務責任者です。",
    "reduced evidence だけを使って、最終的な会話ログ成果物を生成してください。",
    "出力は厳密な JSON object のみ。",
    "summaryMarkdown 以外で markdown は使わないでください。",
    `summaryMarkdown は ${input.minSummaryChars} 文字以上にしてください。`,
    `timeline は evidence がある限り ${input.minTimelineSections} セクション以上にしてください。`,
    "見出しは必ず次の3つを使うこと:",
    "- ## 会話で確認できた事実",
    "- ## 指導の要点（講師が伝えた核）",
    "- ## 次回までの方針",
    "品質要件:",
    ...spec.finalizeStyle.map((line) => `- ${line}`),
    "- 『整理した』『確認した』だけで終わらせず、何を整理・確認したか書く",
    "- nextActions は owner / action / metric / why を必ず埋める",
    "- parentPack は保護者が読んで理解できる自然な日本語にする",
    "- 英語や placeholder は禁止",
  ].join("\n");

  const user = [
    `生徒: ${formatStudentLabel(input.studentName)}`,
    `講師: ${formatTeacherLabel(input.teacherName)}`,
    `セッション種別: ${input.sessionType}`,
    "",
    "入力 reduced evidence JSON:",
    compactJson(input.reduced),
    "",
    "出力 JSON 形式:",
    "{",
    '  "summaryMarkdown": "...",',
    '  "timeline": [',
    '    { "title": "...", "what_happened": "...", "coach_point": "...", "student_state": "...", "evidence_quotes": ["..."] }',
    "  ],",
    '  "nextActions": [',
    '    { "owner": "COACH|STUDENT|PARENT", "action": "...", "due": "YYYY-MM-DD or null", "metric": "...", "why": "..." }',
    "  ],",
    '  "profileDelta": { "basic": [...], "personal": [...] },',
    '  "parentPack": {',
    '    "what_we_did": ["..."],',
    '    "what_improved": ["..."],',
    '    "what_to_practice": ["..."],',
    '    "risks_or_notes": ["..."],',
    '    "next_time_plan": ["..."],',
    '    "evidence_quotes": ["..."]',
    "  },",
    '  "studentState": { "label": "前進|集中|安定|不安|疲れ|詰まり|落ち込み|高揚", "oneLiner": "...", "rationale": ["..."], "confidence": 0 },',
    '  "recommendedTopics": [{ "category": "学習|生活|学校|進路", "title": "...", "reason": "...", "question": "...", "priority": 1 }],',
    '  "quickQuestions": [{ "category": "学習|生活|学校|進路", "question": "...", "reason": "..." }],',
    '  "profileSections": [{ "category": "学習|生活|学校|進路", "status": "改善|維持|落ちた|不明", "highlights": [{ "label": "...", "value": "...", "isNew": true, "isUpdated": false }], "nextQuestion": "..." }],',
    '  "observationEvents": [{ "sourceType": "INTERVIEW|LESSON_REPORT", "category": "学習|生活|学校|進路", "statusDraft": "改善|維持|落ちた|不明", "insights": ["..."], "topics": ["..."], "nextActions": ["..."], "evidence": ["..."], "characterSignal": "...", "weight": 1 }],',
    '  "lessonReport": { "todayGoal": "...", "covered": ["..."], "blockers": ["..."], "homework": ["..."], "nextLessonFocus": ["..."], "parentShareDraft": "..." }',
    "}",
    "",
    "重要ルール:",
    "- 面談ログでは、背景・原因・方針のつながりを出す",
    "- 指導報告ログでは、今日の授業で何が起きたかを最優先で具体化する",
    "- 指導報告ログで『授業前チェックイン』『授業後チェックアウト』がある場合は、開始時点の状態と授業後の結果を混同しない",
    "- recommendedTopics と quickQuestions は、次回会話でそのまま使える内容にする",
    "- profileDelta は durable な情報だけに絞る",
  ].join("\n");

  return { system, user };
}

function buildSinglePassPrompt(input: {
  sessionType: SessionMode;
  transcript: string;
  studentName?: string;
  teacherName?: string;
  minSummaryChars: number;
  minTimelineSections: number;
}) {
  const spec = buildSessionPromptSpec(input.sessionType);
  const system = [
    "あなたは学習塾・個別指導の教務責任者です。",
    "文字起こしから、最終的な会話ログ成果物を直接生成してください。",
    "出力は厳密な JSON object のみ。",
    "summaryMarkdown 以外で markdown は使わないでください。",
    `summaryMarkdown は ${input.minSummaryChars} 文字以上にしてください。`,
    `timeline は evidence がある限り ${input.minTimelineSections} セクション以上にしてください。`,
    "見出しは必ず次の3つを使うこと:",
    "- ## 会話で確認できた事実",
    "- ## 指導の要点（講師が伝えた核）",
    "- ## 次回までの方針",
    "品質要件:",
    ...spec.finalizeStyle.map((line) => `- ${line}`),
    "- 文字起こしの逐語ダンプは禁止",
    "- 雑な一般論・抽象論は禁止",
    "- 何をどう改善するか、後から読んでも分かる具体性にする",
  ].join("\n");

  const user = [
    `生徒: ${formatStudentLabel(input.studentName)}`,
    `講師: ${formatTeacherLabel(input.teacherName)}`,
    `セッション種別: ${input.sessionType}`,
    "",
    "文字起こし:",
    input.transcript,
    "",
    "出力 JSON 形式は finalize prompt と同じ。",
  ].join("\n");

  return { system, user };
}

function buildSummaryMarkdown(facts: string[], points: string[], actions: NextAction[], minChars: number) {
  const lines = [
    "## 会話で確認できた事実",
    ...(facts.length > 0 ? facts.map((line) => `- ${line}`) : ["- 今回の会話で確認した事実を、次回に引き継げる形で整理した。"]),
    "",
    "## 指導の要点（講師が伝えた核）",
    ...(points.length > 0 ? points.map((line) => `- ${line}`) : ["- 次に何を優先すべきかを具体化した。"]),
    "",
    "## 次回までの方針",
    ...(actions.length > 0
      ? actions.slice(0, 4).map((action) => `- ${ownerLabel(action.owner)}: ${action.action}（指標: ${action.metric}）`)
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

function buildFallbackParentPack(
  sessionType: SessionMode,
  reduced: ReducedAnalysis,
  actions: NextAction[],
  transcript: string
): ParentPack {
  const lines = summarizeTranscriptEvidence(transcript, 8);
  return normalizeParentPack({
    what_we_did: reduced.facts.slice(0, 3).length > 0 ? reduced.facts.slice(0, 3) : lines.slice(0, 3),
    what_improved:
      reduced.student_state_delta.slice(0, 3).length > 0
        ? reduced.student_state_delta.slice(0, 3)
        : [sessionType === "LESSON_REPORT" ? "授業内での反応から、次回の確認点が見えた。" : "今回の会話で、次の打ち手が前より具体化した。"],
    what_to_practice: actions.filter((action) => action.owner === "STUDENT").map((action) => action.action).slice(0, 3),
    risks_or_notes: reduced.coaching_points.slice(0, 2).length > 0 ? reduced.coaching_points.slice(0, 2) : [sessionType === "LESSON_REPORT" ? "宿題の進み方によって、次回の授業配分を調整する。" : "実行はできても、止まった理由まで振り返れるかが次の鍵になる。"],
    next_time_plan: actions.map((action) => action.metric).slice(0, 3),
    evidence_quotes: sanitizeQuotes([...reduced.quotes, ...lines.slice(0, 2)]),
  });
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
  minTimelineSections: number
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
  const parentPack = buildFallbackParentPack(sessionType, reduced, nextActions, transcript);
  const observationEvents = buildFallbackObservationEvents(sessionType, profileSections, nextActions, transcript);
  const lessonReport = buildFallbackLessonReport(sessionType, timeline, nextActions, transcript);
  const facts = dedupeStrings([...reduced.facts, ...timeline.map((item) => item.what_happened)]).slice(0, 6);
  const points = dedupeStrings([...reduced.coaching_points, ...timeline.map((item) => item.coach_point)]).slice(0, 6);

  return {
    summaryMarkdown: buildSummaryMarkdown(facts, points, nextActions, minSummaryChars),
    timeline,
    nextActions,
    profileDelta,
    parentPack,
    studentState,
    recommendedTopics,
    quickQuestions,
    profileSections,
    observationEvents,
    lessonReport,
  };
}

function isWeakFinalize(result: FinalizeResult, minSummaryChars: number, minTimelineSections: number) {
  if (!result.summaryMarkdown || result.summaryMarkdown.length < minSummaryChars) return true;
  if (result.timeline.length < minTimelineSections) return true;
  if (result.nextActions.length < 2) return true;
  if (result.recommendedTopics.length === 0) return true;
  if (result.profileSections.length === 0) return true;
  return false;
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
    "- timeline は具体タイトルにする",
    "- nextActions は action / metric / why を具体化する",
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
  const analyses: ChunkAnalysis[] = [];
  let apiCalls = 0;

  for (const block of blocks) {
    const prompt = [
      user,
      "",
      `対象チャンク #${block.index + 1}:`,
      block.text,
    ].join("\n");

    let parsed: Partial<ChunkAnalysis> | null = null;
    try {
      apiCalls += 1;
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

    analyses.push(normalizeChunkAnalysis(parsed, block.index, block.hash));
  }

  return { analyses, model, apiCalls };
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
    });
    const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
    parsed = tryParseJson<Partial<FinalizeResult>>(jsonText);
  } catch {
    parsed = null;
  }

  const evidenceText = JSON.stringify(input.reduced);
  let result = parsed
    ? normalizeFinalizeResult(parsed, sessionType, input.minSummaryChars)
    : buildHeuristicFinalize(sessionType, evidenceText, input.reduced, input.minSummaryChars, minTimelineSections);

  if (isWeakFinalize(result, input.minSummaryChars, minTimelineSections)) {
    result = buildHeuristicFinalize(sessionType, evidenceText, input.reduced, input.minSummaryChars, minTimelineSections);
  }

  if (ENABLE_FINALIZE_REPAIR && isWeakFinalize(result, input.minSummaryChars, minTimelineSections)) {
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
      if (!isWeakFinalize(normalized, input.minSummaryChars, minTimelineSections)) {
        result = normalized;
      }
    }
  }

  if (isWeakFinalize(result, input.minSummaryChars, minTimelineSections)) {
    result = buildHeuristicFinalize(sessionType, evidenceText, input.reduced, input.minSummaryChars, minTimelineSections);
    repaired = false;
  }

  return { result, model, apiCalls, repaired };
}

export async function generateConversationArtifactsSinglePass(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  minSummaryChars: number;
  minTimelineSections?: number;
  sessionType?: SessionMode;
}): Promise<{ result: FinalizeResult; model: string; apiCalls: number; repaired: boolean }> {
  const sessionType = input.sessionType ?? "INTERVIEW";
  const minTimelineSections = input.minTimelineSections ?? 2;
  const model = getFinalModel();
  const { system, user } = buildSinglePassPrompt({
    sessionType,
    transcript: input.transcript,
    studentName: input.studentName,
    teacherName: input.teacherName,
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
      max_completion_tokens: SINGLE_PASS_MAX_TOKENS,
    });
    const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
    parsed = tryParseJson<Partial<FinalizeResult>>(jsonText);
  } catch {
    parsed = null;
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

  let result = parsed
    ? normalizeFinalizeResult(parsed, sessionType, input.minSummaryChars)
    : buildHeuristicFinalize(sessionType, input.transcript, reducedFallback, input.minSummaryChars, minTimelineSections);

  if (isWeakFinalize(result, input.minSummaryChars, minTimelineSections)) {
    result = buildHeuristicFinalize(sessionType, input.transcript, reducedFallback, input.minSummaryChars, minTimelineSections);
  }

  if (ENABLE_FINALIZE_REPAIR && isWeakFinalize(result, input.minSummaryChars, minTimelineSections)) {
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
      const normalized = normalizeFinalizeResult(repairedResult, sessionType, input.minSummaryChars);
      if (!isWeakFinalize(normalized, input.minSummaryChars, minTimelineSections)) {
        result = normalized;
      }
    }
  }

  if (isWeakFinalize(result, input.minSummaryChars, minTimelineSections)) {
    result = buildHeuristicFinalize(sessionType, input.transcript, reducedFallback, input.minSummaryChars, minTimelineSections);
    repaired = false;
  }

  return { result, model, apiCalls, repaired };
}

export function getPromptVersion() {
  return PROMPT_VERSION;
}
