import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";
import type {
  ChunkAnalysis,
  ReducedAnalysis,
  FinalizeResult,
  ParentPack,
  TimelineCandidate,
  TodoCandidate,
  ProfileDelta,
  TimelineSection,
  NextAction,
  ProfileDeltaItem,
} from "@/lib/types/conversation";
import type {
  EntityCandidate,
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
const PROMPT_VERSION = "v1.0";

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

const DEFAULT_LLM_TIMEOUT_MS = Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000);
const ANALYZE_BATCH_SIZE = clampInt(Number(process.env.ANALYZE_BATCH_SIZE ?? 2), 1, 6);
const ANALYZE_BATCH_CONCURRENCY = clampInt(Number(process.env.ANALYZE_BATCH_CONCURRENCY ?? 3), 1, 8);
const ANALYZE_MAX_TOKENS = clampInt(Number(process.env.ANALYZE_MAX_TOKENS ?? 900), 300, 2600);
const ANALYZE_BATCH_MAX_TOKENS = clampInt(Number(process.env.ANALYZE_BATCH_MAX_TOKENS ?? 1800), 700, 5000);
const REDUCE_MAX_TOKENS = clampInt(Number(process.env.REDUCE_MAX_TOKENS ?? 1300), 500, 3200);
const FINALIZE_MAX_TOKENS = clampInt(Number(process.env.FINALIZE_MAX_TOKENS ?? 2100), 900, 5000);
const SINGLE_PASS_MAX_TOKENS = clampInt(Number(process.env.SINGLE_PASS_MAX_TOKENS ?? 2400), 900, 6000);
const USE_STRUCTURED_SINGLE_PASS_SUMMARY = process.env.SINGLE_PASS_STRUCTURED_SUMMARY !== "0";
const ENABLE_FINALIZE_REPAIR = process.env.ENABLE_FINALIZE_REPAIR !== "0";

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
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  return candidate;
}

function extractChatCompletionContent(data: ChatCompletionResponse): {
  contentText: string | null;
  finishReason?: string;
  refusal?: string;
} {
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason;
  const message = choice?.message;
  const refusal = message?.refusal;
  const c = message?.content;
  if (typeof c === "string") {
    const t = c.trim();
    return { contentText: t || null, finishReason, refusal };
  }
  if (Array.isArray(c)) {
    const parts: string[] = [];
    for (const p of c) {
      if (typeof p === "string") parts.push(p);
      else if (p && typeof p === "object" && "text" in (p as any) && typeof (p as any).text === "string") {
        parts.push((p as any).text);
      }
    }
    const joined = parts.join("").trim();
    return { contentText: joined || null, finishReason, refusal };
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
    throw new Error("LLM_API_KEY (or OPENAI_API_KEY) is not set. LLM is required.");
  }

  const timeoutMs = Math.max(10000, params.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
  const bodyBase: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    ...(
      params.max_completion_tokens || params.max_tokens
        ? { max_completion_tokens: params.max_completion_tokens ?? params.max_tokens }
        : {}
    ),
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
    const supportsDefaultTempOnly =
      res.status === 400 &&
      typeof bodyBase.temperature === "number" &&
      /temperature/i.test(raw) &&
      /default \(1\)/i.test(raw);

    if (supportsDefaultTempOnly) {
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
  const extracted = extractChatCompletionContent(data);
  return { raw, ...extracted };
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 2);
}

function forceGpt5Family(model: string) {
  const normalized = model.trim();
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
  let out = text;
  // email
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "［EMAIL］");
  // phone (with hyphens)
  out = out.replace(/\b\d{2,4}-\d{2,4}-\d{3,4}\b/g, "［TEL］");
  // phone (continuous 10-11 digits)
  out = out.replace(/\b\d{10,11}\b/g, "［TEL］");
  // address (rough)
  out = out.replace(/(東京都|北海道|大阪府|京都府|.{2,3}県).{0,20}(市|区|町|村)/g, "［ADDRESS］");
  // full name (rough)
  out = out.replace(/\b[一-龥]{2,4}\s*[一-龥]{2,4}\b/g, "［NAME］");
  return out;
}

function sanitizeQuotes(quotes: string[]) {
  const cleaned = quotes
    .map((q) => maskSensitiveText(q.trim()))
    .map((q) => (q.length > 60 ? q.slice(0, 60) : q))
    .filter((q) => q.length >= 12);
  return cleaned.slice(0, 4);
}

function normalizeProfileDelta(delta: ProfileDelta): ProfileDelta {
  const normalizeItems = (items: ProfileDeltaItem[]) =>
    items
      .filter((i) => i.field && i.value)
      .map((i) => ({
        field: i.field.trim(),
        value: i.value.trim(),
        confidence: Math.max(0, Math.min(100, i.confidence ?? 50)),
        evidence_quotes: sanitizeQuotes(i.evidence_quotes ?? []),
      }))
      .filter((i) => !hasBadUserFacingText(`${i.field} ${i.value}`));
  return {
    basic: normalizeItems(delta.basic ?? []),
    personal: normalizeItems(delta.personal ?? []),
  };
}

function normalizeTimeline(sections: TimelineSection[]) {
  return sections.map((s) => ({
    title: s.title?.trim() ?? "",
    what_happened: s.what_happened?.trim() ?? "",
    coach_point: s.coach_point?.trim() ?? "",
    student_state: s.student_state?.trim() ?? "",
    evidence_quotes: sanitizeQuotes(s.evidence_quotes ?? []),
  }));
}

function normalizeNextActions(actions: NextAction[]) {
  return actions
    .filter((a) => a.action && a.metric)
    .map((a) => ({
      owner: a.owner,
      action: a.action.trim(),
      due: a.due ?? null,
      metric: a.metric.trim(),
      why: maskSensitiveText(a.why?.trim() ?? ""),
    }));
}

function normalizeReducedAnalysis(input: ReducedAnalysis): ReducedAnalysis {
  return {
    facts: (input.facts ?? []).map((v) => String(v).trim()).filter(Boolean),
    coaching_points: (input.coaching_points ?? []).map((v) => String(v).trim()).filter(Boolean),
    decisions: (input.decisions ?? []).map((v) => String(v).trim()).filter(Boolean),
    student_state_delta: (input.student_state_delta ?? []).map((v) => String(v).trim()).filter(Boolean),
    todo_candidates: (input.todo_candidates ?? []).map((t) => ({
      owner: t.owner ?? "STUDENT",
      action: String(t.action ?? "").trim(),
      due: t.due ?? null,
      metric: String(t.metric ?? "").trim(),
      why: String(t.why ?? "").trim(),
      evidence_quotes: sanitizeQuotes(t.evidence_quotes ?? []),
    })),
    timeline_candidates: (input.timeline_candidates ?? []).map((t) => ({
      title: String(t.title ?? "").trim(),
      what_happened: String(t.what_happened ?? "").trim(),
      coach_point: String(t.coach_point ?? "").trim(),
      student_state: String(t.student_state ?? "").trim(),
      evidence_quotes: sanitizeQuotes(t.evidence_quotes ?? []),
    })),
    profile_delta_candidates: normalizeProfileDelta(input.profile_delta_candidates ?? { basic: [], personal: [] }),
    quotes: sanitizeQuotes(input.quotes ?? []),
    safety_flags: (input.safety_flags ?? []).map((v) => String(v).trim()).filter(Boolean),
  };
}

function normalizeParentPack(pack: ParentPack): ParentPack {
  const normalizeList = (items?: string[]) =>
    (items ?? [])
      .map((v) => maskSensitiveText(String(v).trim()))
      .filter((v) => v && !hasBadUserFacingText(v));
  return {
    what_we_did: normalizeList(pack.what_we_did),
    what_improved: normalizeList(pack.what_improved),
    what_to_practice: normalizeList(pack.what_to_practice),
    risks_or_notes: normalizeList(pack.risks_or_notes),
    next_time_plan: normalizeList(pack.next_time_plan),
    evidence_quotes: sanitizeQuotes(pack.evidence_quotes ?? []),
  };
}

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

function toProfileCategory(value: unknown): ProfileCategory {
  const text = String(value ?? "").trim();
  return PROFILE_CATEGORIES.includes(text as ProfileCategory) ? (text as ProfileCategory) : "学習";
}

function toProfileSectionStatus(value: unknown): ProfileSectionStatus {
  const text = String(value ?? "").trim();
  return ["改善", "維持", "落ちた", "不明"].includes(text) ? (text as ProfileSectionStatus) : "不明";
}

function normalizeStudentState(value: StudentStateCard | null | undefined): StudentStateCard {
  const label = STUDENT_STATE_LABELS.includes(String(value?.label ?? "").trim() as StudentStateLabel)
    ? (String(value?.label).trim() as StudentStateLabel)
    : "安定";
  const oneLinerRaw = maskSensitiveText(String(value?.oneLiner ?? "").trim()).slice(0, 80);
  const rationale = (value?.rationale ?? [])
    .map((v) => maskSensitiveText(String(v).trim()))
    .filter((v) => v && !hasBadUserFacingText(v))
    .slice(0, 4);
  return {
    label,
    oneLiner: oneLinerRaw && !hasBadUserFacingText(oneLinerRaw) ? oneLinerRaw : "",
    rationale,
    confidence: Math.max(0, Math.min(100, Number(value?.confidence ?? 60))),
  };
}

function normalizeRecommendedTopics(items: RecommendedTopic[] | null | undefined): RecommendedTopic[] {
  return (items ?? [])
    .map((item, index) => ({
      category: toProfileCategory(item?.category),
      title: maskSensitiveText(String(item?.title ?? "").trim()),
      reason: maskSensitiveText(String(item?.reason ?? "").trim()),
      question: maskSensitiveText(String(item?.question ?? "").trim()),
      priority: Math.max(1, Math.min(7, Number(item?.priority ?? index + 1))),
    }))
    .filter((item) => item.title && item.question)
    .filter((item) => !hasBadUserFacingText([item.title, item.reason, item.question].join(" ")))
    .slice(0, 7);
}

function normalizeQuickQuestions(items: QuickQuestion[] | null | undefined): QuickQuestion[] {
  return (items ?? [])
    .map((item) => ({
      category: toProfileCategory(item?.category),
      question: maskSensitiveText(String(item?.question ?? "").trim()),
      reason: maskSensitiveText(String(item?.reason ?? "").trim()),
    }))
    .filter((item) => item.question)
    .filter((item) => !hasBadUserFacingText([item.question, item.reason].join(" ")))
    .slice(0, 7);
}

function normalizeProfileSections(items: ProfileSection[] | null | undefined): ProfileSection[] {
  return (items ?? [])
    .map((item) => ({
      category: toProfileCategory(item?.category),
      status: toProfileSectionStatus(item?.status),
      highlights: (item?.highlights ?? [])
        .map((highlight) => ({
          label: maskSensitiveText(String(highlight?.label ?? "").trim()),
          value: maskSensitiveText(String(highlight?.value ?? "").trim()),
          isNew: Boolean(highlight?.isNew),
          isUpdated: Boolean(highlight?.isUpdated),
        }))
        .filter((highlight) => highlight.label && highlight.value)
        .filter((highlight) => !hasBadUserFacingText(`${highlight.label} ${highlight.value}`))
        .slice(0, 5),
      nextQuestion: maskSensitiveText(String(item?.nextQuestion ?? "").trim()),
    }))
    .filter((item) => item.highlights.length > 0 || (item.nextQuestion && !hasBadUserFacingText(item.nextQuestion)))
    .slice(0, 4);
}

function normalizeEntityKind(value: unknown): EntityCandidate["kind"] {
  const text = String(value ?? "").trim().toUpperCase();
  return [
    "SCHOOL",
    "TARGET_SCHOOL",
    "MATERIAL",
    "EXAM",
    "CRAM_SCHOOL",
    "TEACHER",
    "METRIC",
    "OTHER",
  ].includes(text)
    ? (text as EntityCandidate["kind"])
    : "OTHER";
}

function normalizeEntityStatus(value: unknown): EntityCandidate["status"] {
  const text = String(value ?? "").trim().toUpperCase();
  return ["PENDING", "CONFIRMED", "IGNORED"].includes(text)
    ? (text as EntityCandidate["status"])
    : "PENDING";
}

function normalizeEntityCandidates(items: EntityCandidate[] | null | undefined): EntityCandidate[] {
  const seen = new Set<string>();
  const normalized: EntityCandidate[] = [];
  for (const item of items ?? []) {
    const rawValue = maskSensitiveText(String(item?.rawValue ?? "").trim());
    if (!rawValue) continue;
    if (hasBadUserFacingText(rawValue)) continue;
    const key = `${normalizeEntityKind(item?.kind)}::${rawValue.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const canonicalValue = item?.canonicalValue ? maskSensitiveText(String(item.canonicalValue).trim()) : null;
    const context = item?.context ? maskSensitiveText(String(item.context).trim()) : undefined;
    normalized.push({
      id: item?.id,
      kind: normalizeEntityKind(item?.kind),
      rawValue,
      canonicalValue: canonicalValue && !hasBadUserFacingText(canonicalValue) ? canonicalValue : null,
      confidence: Math.max(0, Math.min(100, Number(item?.confidence ?? 60))),
      status: normalizeEntityStatus(item?.status),
      context: context && !hasBadUserFacingText(context) ? context : undefined,
    });
    if (normalized.length >= 8) break;
  }
  return normalized;
}

function normalizeObservationEvents(items: ObservationEvent[] | null | undefined): ObservationEvent[] {
  return (items ?? [])
    .map((item) => {
      const sourceType: ObservationEvent["sourceType"] =
        item?.sourceType === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW";
      return {
        sourceType,
        category: toProfileCategory(item?.category),
        statusDraft: toProfileSectionStatus(item?.statusDraft),
        insights: (item?.insights ?? [])
          .map((v) => maskSensitiveText(String(v).trim()))
          .filter((v) => v && !hasBadUserFacingText(v))
          .slice(0, 4),
        topics: (item?.topics ?? [])
          .map((v) => maskSensitiveText(String(v).trim()))
          .filter((v) => v && !hasBadUserFacingText(v))
          .slice(0, 4),
        nextActions: (item?.nextActions ?? [])
          .map((v) => maskSensitiveText(String(v).trim()))
          .filter((v) => v && !hasBadUserFacingText(v))
          .slice(0, 4),
        evidence: sanitizeQuotes((item?.evidence ?? []).map((v) => String(v))),
        characterSignal: (() => {
          const signal = maskSensitiveText(String(item?.characterSignal ?? "").trim());
          return signal && !hasBadUserFacingText(signal) ? signal : "";
        })(),
        weight: Math.max(1, Math.min(5, Number(item?.weight ?? 3))),
      };
    })
    .filter((item) => item.insights.length > 0 || item.topics.length > 0)
    .slice(0, 8);
}

function normalizeLessonReport(value: LessonReportArtifact | null | undefined): LessonReportArtifact | null {
  if (!value) return null;
  const normalizeList = (items?: string[]) =>
    (items ?? [])
      .map((v) => maskSensitiveText(String(v).trim()))
      .filter((v) => v && !hasBadUserFacingText(v))
      .slice(0, 5);
  const todayGoal = maskSensitiveText(String(value.todayGoal ?? "").trim());
  const parentShareDraft = value.parentShareDraft ? maskSensitiveText(String(value.parentShareDraft).trim()) : undefined;
  return {
    todayGoal: todayGoal && !hasBadUserFacingText(todayGoal) ? todayGoal : "",
    covered: normalizeList(value.covered),
    blockers: normalizeList(value.blockers),
    homework: normalizeList(value.homework),
    nextLessonFocus: normalizeList(value.nextLessonFocus),
    parentShareDraft: parentShareDraft && !hasBadUserFacingText(parentShareDraft) ? parentShareDraft : undefined,
  };
}

function formatStudentLabel(name?: string) {
  if (!name) return "生徒";
  return `${name}さん`;
}

function formatTeacherLabel(name?: string) {
  const base = name || DEFAULT_TEACHER_FULL_NAME;
  const cleaned = base.replace(/先生$/g, "").trim();
  return `${cleaned}先生`;
}

type ChunkBlockInput = { index: number; text: string; hash: string };

function parseChunkAnalysisLike(parsed: any, block: ChunkBlockInput): ChunkAnalysis {
  return {
    index: block.index,
    hash: block.hash,
    facts: (parsed?.facts ?? []).map((v: any) => String(v)),
    coaching_points: (parsed?.coaching_points ?? []).map((v: any) => String(v)),
    decisions: (parsed?.decisions ?? []).map((v: any) => String(v)),
    student_state_delta: (parsed?.student_state_delta ?? []).map((v: any) => String(v)),
    todo_candidates: (parsed?.todo_candidates ?? []).map((item: any) => ({
      owner: item?.owner ?? "STUDENT",
      action: String(item?.action ?? ""),
      due: item?.due ?? null,
      metric: String(item?.metric ?? ""),
      why: String(item?.why ?? ""),
      evidence_quotes: sanitizeQuotes((item?.evidence_quotes ?? []).map((v: any) => String(v))),
    })),
    timeline_candidates: (parsed?.timeline_candidates ?? []).map((item: any) => ({
      title: String(item?.title ?? ""),
      what_happened: String(item?.what_happened ?? ""),
      coach_point: String(item?.coach_point ?? ""),
      student_state: String(item?.student_state ?? ""),
      evidence_quotes: sanitizeQuotes((item?.evidence_quotes ?? []).map((v: any) => String(v))),
    })),
    profile_delta_candidates: normalizeProfileDelta(parsed?.profile_delta_candidates ?? { basic: [], personal: [] }),
    quotes: sanitizeQuotes((parsed?.quotes ?? []).map((v: any) => String(v))),
    safety_flags: (parsed?.safety_flags ?? []).map((v: any) => String(v)),
  };
}

function splitIntoBatches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function limitArray<T>(items: T[] | null | undefined, max: number): T[] {
  if (!Array.isArray(items) || max <= 0) return [];
  return items.slice(0, max);
}

function compactJson(value: unknown) {
  return JSON.stringify(value);
}

function ensureMinChars(text: string, minChars: number, fillerLines: string[]) {
  if (text.length >= minChars) return text;
  const uniqueFillers = dedupePreserveOrder(
    fillerLines
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
  );
  const out: string[] = [text.trim()];
  let cursor = 0;
  while (out.join("\n").length < minChars && uniqueFillers.length > 0) {
    out.push(`- ${uniqueFillers[cursor % uniqueFillers.length]}`);
    cursor += 1;
    if (cursor > uniqueFillers.length * 2) break;
  }
  const built = out.join("\n").trim();
  if (built.length >= minChars) return built;
  const lastResort = uniqueFillers[0] ?? "次回は実行した結果と止まった理由を一緒に確認する。";
  return `${built}\n\n- ${lastResort}`;
}

function splitLongTextUnit(text: string, maxLen = 120) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return [] as string[];
  if (compact.length <= maxLen) return [compact];

  const out: string[] = [];
  let rest = compact;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf(" ", maxLen);
    if (cut < Math.floor(maxLen * 0.4)) {
      const nextSpace = rest.indexOf(" ", maxLen);
      cut = nextSpace > 0 ? nextSpace : maxLen;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

function stripMarkdownForSimilarity(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function maxLineLength(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().length)
    .reduce((a, b) => Math.max(a, b), 0);
}

function isTranscriptDumpSummary(summary: string, transcript: string) {
  const s = stripMarkdownForSimilarity(summary);
  const t = stripMarkdownForSimilarity(transcript);
  if (!s || !t) return false;

  const summaryToRawRatio = s.length / Math.max(1, t.length);
  const overlongLine = maxLineLength(summary) >= 420;
  const headWindow = Math.min(220, s.length);
  const head = s.slice(0, headWindow);
  const transcriptHeadCopied = head.length >= 120 && t.includes(head);
  const summaryUnits = summary
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^\s*[-*]\s+/, "").trim())
    .flatMap((line) => line.split(/[。！？.!?]/g))
    .map((v) => v.replace(/\s+/g, " ").trim())
    .filter((v) => v.length >= 40);
  const copiedUnits =
    summaryUnits.length > 0
      ? summaryUnits.filter((unit) => {
          const probe = unit.slice(0, Math.min(120, unit.length));
          return probe.length >= 40 && t.includes(probe);
        }).length / summaryUnits.length
      : 0;

  if (overlongLine) return true;
  if (summaryToRawRatio >= 0.85 && s.length >= 900) return true;
  if (transcriptHeadCopied && s.length >= 700) return true;
  if (summaryUnits.length >= 3 && copiedUnits >= 0.65) return true;
  return false;
}

const OUTPUT_PLACEHOLDER_PATTERNS = [
  /情報が薄く、会話で埋めたい/,
  /次に確認したい変化を一つ聞く/,
  /現状確認/,
  /変化確認/,
  /次回までの進め方/,
  /確認すべきポイントを具体化した/,
  /今回の会話を、次回までの具体行動につなげる/,
  /実行した結果と止まった理由/,
  /根拠が薄い箇所は次回の会話で確認/,
  /学習の論点/,
  /背景確認/,
  /Session Summary/i,
  /Next Focus/i,
  /Confirmed From Conversation/i,
  /Coaching Focus/i,
  /Direction Until Next Session/i,
  /Review this session/i,
  /Validate progress/i,
  /focused practice cycle/i,
  /measurable outcomes/i,
  /recorded outcome/i,
  /Track consistency/i,
  /Continue monitoring/i,
  /Continue validating/i,
  /Transcript mention/i,
  /Section \d+/i,
];

const STUDY_KEYWORD_RE =
  /(学習|勉強|数学|算数|英語|国語|理科|社会|日本史|世界史|地理|古文|漢文|文法|長文|単語|問題集|参考書|教材|模試|過去問|復習|演習|得点|点数|通し|解き直し|宿題|授業)/;
const LIFE_KEYWORD_RE = /(生活|睡眠|寝|起き|朝|夜|体調|疲|だる|スマホ|習慣|リズム)/;
const SCHOOL_KEYWORD_RE = /(学校|先生|クラス|友達|部活|提出|内申|行事)/;
const CAREER_KEYWORD_RE = /(進路|志望校|受験|共通テスト|二次|推薦|出願|判定|大学|学部)/;

function formatActionOwnerLabel(owner?: NextAction["owner"]) {
  if (owner === "COACH") return "講師";
  if (owner === "PARENT") return "保護者";
  return "生徒";
}

function containsSentenceLikeEnglish(text: string) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/(?:\b[A-Za-z]{3,}\b[\s,.;:!?'"()/-]*){3,}/.test(normalized)) return true;
  const latinChars = (normalized.match(/[A-Za-z]/g) ?? []).length;
  return latinChars >= 18;
}

function isLowSignalPlaceholder(text: string) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return true;
  return OUTPUT_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasBadUserFacingText(text: string) {
  return containsSentenceLikeEnglish(text) || isLowSignalPlaceholder(text);
}

function dedupePreserveOrder(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function inferCategoryFromText(text: string): ProfileCategory {
  const normalized = String(text ?? "");
  if (CAREER_KEYWORD_RE.test(normalized)) return "進路";
  if (LIFE_KEYWORD_RE.test(normalized)) return "生活";
  if (SCHOOL_KEYWORD_RE.test(normalized)) return "学校";
  if (STUDY_KEYWORD_RE.test(normalized)) return "学習";
  return "学習";
}

function inferStudentStateLabel(text: string): StudentStateLabel {
  const lower = String(text ?? "").toLowerCase();
  let label: StudentStateLabel = "安定";
  if (/(疲|眠|遅|だる|heavy|tired)/i.test(lower)) label = "疲れ";
  if (/(不安|心配|焦|迷|しんど)/i.test(lower)) label = "不安";
  if (/(詰|止ま|苦手|できな|頭打ち|取れない)/i.test(lower)) label = "詰まり";
  if (/(伸び|できた|上が|前進|手応え|進ん)/i.test(lower)) label = "前進";
  if (/(集中|没頭|粘)/i.test(lower)) label = "集中";
  if (/(嬉|楽し|高揚|乗って)/i.test(lower)) label = "高揚";
  if (/(落ち込|しんど|無理)/i.test(lower)) label = "落ち込み";
  return label;
}

function buildStateOneLiner(text: string, label: StudentStateLabel) {
  const normalized = String(text ?? "");
  if (/頭打ち|通し|点が取れない|総計/.test(normalized)) {
    return "知識はあるが、通しで点にし切れていない。";
  }
  if (/睡眠|寝る|起き/.test(normalized)) {
    return "生活リズムが学習の安定感に影響しやすい。";
  }
  if (/志望校|受験|共通テスト|二次/.test(normalized)) {
    return "受験の優先順位を言葉にして固めたい段階。";
  }
  if (/毎日|継続|続け/.test(normalized) && label === "前進") {
    return "やることが絞れ、継続の形が見え始めている。";
  }

  const byLabel: Record<StudentStateLabel, string> = {
    前進: "やることが絞れ、前に進む感覚が出ている。",
    集中: "やるべきことに意識を向けられている。",
    安定: "大きく崩れず、次の確認点が見えている。",
    不安: "進め方は見えつつも、結果への不安が残る。",
    疲れ: "負荷が高く、立て直し方の確認が必要。",
    詰まり: "知識はあるが、使いどころで止まりやすい。",
    落ち込み: "手応えが弱く、気持ちの立て直しが必要。",
    高揚: "前向きさが高く、勢いを行動に変えたい。",
  };
  return byLabel[label];
}

function scoreTranscriptLine(line: string) {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (!normalized) return -100;
  let score = Math.min(24, normalized.length / 5);
  if (/[0-9一二三四五六七八九十]/.test(normalized)) score += 2;
  if (STUDY_KEYWORD_RE.test(normalized)) score += 5;
  if (LIFE_KEYWORD_RE.test(normalized)) score += 4;
  if (SCHOOL_KEYWORD_RE.test(normalized)) score += 4;
  if (CAREER_KEYWORD_RE.test(normalized)) score += 4;
  if (/^(あー|えー|うーん|んー|その|なんか|まあ|そうですね|はい|えっと)/.test(normalized)) score -= 6;
  if (normalized.length < 14) score -= 6;
  if (isLowSignalPlaceholder(normalized)) score -= 12;
  return score;
}

function buildProfileSectionQuestion(category: ProfileCategory, highlight?: { label?: string; value?: string }) {
  if (highlight?.label && highlight?.value) {
    return `${highlight.label}について、${highlight.value}と感じた場面をもう一つ確認したい。`;
  }
  if (category === "生活") return "今週の生活リズムで、勉強に響いたことはある？";
  if (category === "学校") return "学校や先生とのやり取りで、気になったことはある？";
  if (category === "進路") return "志望校や受験方針で、今いちばん迷っている点はどこ？";
  return "今いちばん点につながりにくい場面はどこ？";
}

function shortenForQuestion(text: string, max = 28) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}…`;
}

function buildFallbackNextActions(
  evidenceText: string,
  sessionType?: "INTERVIEW" | "LESSON_REPORT"
): NextAction[] {
  const category = inferCategoryFromText(evidenceText);
  const studentActionByCategory: Record<ProfileCategory, NextAction> = {
    学習: {
      owner: "STUDENT",
      action: /通し|過去問|模試|共通テスト/.test(evidenceText)
        ? "通し演習を1回行い、止まった原因を2つメモする。"
        : "次回までに決めた学習を一つ実行し、やった内容を記録する。",
      due: null,
      metric: /通し|過去問|模試|共通テスト/.test(evidenceText)
        ? "演習1回分の結果と、止まった理由を2点残す。"
        : "実行した日と内容を1件以上残す。",
      why: "次回の振り返りを、感覚ではなく事実でできるようにするため。",
    },
    生活: {
      owner: "STUDENT",
      action: "就寝と学習開始の時間を一つ決めて、3日分記録する。",
      due: null,
      metric: "3日分の記録が残っている。",
      why: "生活の揺れが学習にどう影響しているか確認するため。",
    },
    学校: {
      owner: "STUDENT",
      action: "学校で気になった出来事を一つ書き出し、次回共有する。",
      due: null,
      metric: "具体例を1件以上残す。",
      why: "学校での状況が学習や気持ちにどう影響しているか掴むため。",
    },
    進路: {
      owner: "STUDENT",
      action: "志望校や受験方式で迷っている点を一つ言語化する。",
      due: null,
      metric: "迷いの内容を1点書き出す。",
      why: "次回の相談を判断につながる形にするため。",
    },
  };

  const coachAction: NextAction = {
    owner: "COACH",
    action:
      sessionType === "LESSON_REPORT"
        ? "次回授業の冒頭で実行結果を確認し、つまずきの原因を一つに絞る。"
        : "次回の会話で実行結果を確認し、詰まった原因を一緒に言語化する。",
    due: null,
    metric:
      sessionType === "LESSON_REPORT"
        ? "できたこと1点と止まった点1点を確認する。"
        : "達成できた点1つと、次に直す点1つを確認する。",
    why: "次の支援を感覚ではなく、実行結果に基づいて決めるため。",
  };

  return [studentActionByCategory[category], coachAction];
}

function buildTimelineFallbackSummary(text: string, index: number, total: number) {
  const category = inferCategoryFromText(text);
  const stateLabel = inferStudentStateLabel(text);

  if (index === total - 1 || /次回|毎日|やる|進める|確認|記録|宿題/.test(text)) {
    return {
      title: "次回までの進め方",
      what_happened: "次回までに回す学習と、確認すべきポイントを具体化した。",
      coach_point: "やることを一つに絞り、実行したかが分かる形で残す。",
      student_state: buildStateOneLiner(text, stateLabel),
    };
  }

  if (/頭打ち|詰|止ま|苦手|できない|取れない/.test(text)) {
    return {
      title: category === "進路" ? "受験方針の詰まり" : "つまずきの整理",
      what_happened:
        category === "学習"
          ? "知識はあるが、得点化や通しの場面で止まりやすい点を整理した。"
          : "うまく進みにくい要因を整理し、どこから直すかを確認した。",
      coach_point: "原因を一つに絞って、復習の切り口を変える。",
      student_state: buildStateOneLiner(text, stateLabel),
    };
  }

  if (/できた|上がった|進んだ|手応え|余裕/.test(text)) {
    return {
      title: "手応えの確認",
      what_happened: "できている部分と、次に伸ばすべき部分を切り分けた。",
      coach_point: "うまくいったやり方を再現できるように言語化する。",
      student_state: buildStateOneLiner(text, stateLabel),
    };
  }

  const byCategory: Record<ProfileCategory, { title: string; what: string; coach: string }> = {
    学習: {
      title: "学習状況の確認",
      what: "学習の進め方と、点につながりにくい場面を確認した。",
      coach: "理解していることと、解けることの差を埋める見方を持つ。",
    },
    生活: {
      title: "生活面の確認",
      what: "生活リズムや体調が学習に与える影響を確認した。",
      coach: "学習量だけでなく、続けやすい生活条件も整える。",
    },
    学校: {
      title: "学校での状況",
      what: "学校での出来事や周囲との関係が学習にどう響くかを確認した。",
      coach: "学校で起きていることを、学習支援の前提として捉える。",
    },
    進路: {
      title: "進路の整理",
      what: "受験や志望校に向けた優先順位を整理した。",
      coach: "残り時間から逆算し、優先順位を明確にする。",
    },
  };

  const selected = byCategory[category];
  return {
    title: selected.title,
    what_happened: selected.what,
    coach_point: selected.coach,
    student_state: buildStateOneLiner(text, stateLabel),
  };
}

type TranscriptTheme = {
  key: string;
  category: ProfileCategory;
  sectionStatus: ProfileSectionStatus;
  title: string;
  whatHappened: string;
  coachPoint: string;
  studentState: string;
  summaryFact: string;
  summaryCore: string;
  highlightLabel: string;
  highlightValue: string;
  nextQuestion: string;
  topicTitle: string;
  topicReason: string;
  topicQuestion: string;
  evidenceQuotes: string[];
  studentAction?: NextAction;
  coachAction?: NextAction;
  stateLabel?: StudentStateLabel;
  stateOneLiner?: string;
};

type TranscriptThemeSpec = Omit<TranscriptTheme, "evidenceQuotes" | "studentAction" | "coachAction"> & {
  match: RegExp;
  buildStudentAction?: () => NextAction;
  buildCoachAction?: (sessionType?: "INTERVIEW" | "LESSON_REPORT") => NextAction | undefined;
};

const TRANSCRIPT_THEME_SPECS: TranscriptThemeSpec[] = [
  {
    key: "time_allocation",
    match: /(毎日数学|時間ない|模試やった結果過去問|過去問やってない|時間を減らさない|アウトプット減らすとまずい)/,
    category: "学習",
    sectionStatus: "維持",
    title: "日々の学習と時間配分",
    whatHappened: "数学は毎日続ける前提を持ちつつ、限られた時間の中で模試・過去問・復習の優先順位を見直す必要がある。",
    coachPoint: "アウトプットを減らし過ぎず、限られた時間を得点につながる演習と振り返りに寄せる。",
    studentState: "継続の意思はあるが、時間不足で配分に迷いが出やすい。",
    summaryFact: "数学は毎日触る前提を維持しつつ、限られた時間の中で演習の優先順位を上げる必要がある。",
    summaryCore: "時間不足の中では、模試・過去問・復習の配分を『何を得点につなげるか』で決める必要がある。",
    highlightLabel: "学習の時間配分",
    highlightValue: "模試・過去問・復習の優先順位を先に決める必要がある。",
    nextQuestion: "今週の数学は、模試・過去問・復習のどこにいちばん時間を使う？",
    topicTitle: "時間配分の見直し",
    topicReason: "毎日数学を続ける前提はあるため、限られた時間の配分を整えると成果につながりやすい。",
    topicQuestion: "今の1週間で、模試・過去問・復習の優先順位はどう置く？",
    buildStudentAction: () => ({
      owner: "STUDENT",
      action: "1週間の数学で、模試・過去問・復習の優先順位を先に決めてから着手する。",
      due: null,
      metric: "次回までの学習記録に、各日の優先順位が3日分以上残っている。",
      why: "時間不足の中でも、得点につながる演習へ配分を寄せるため。",
    }),
  },
  {
    key: "unseen_problem",
    match: /(初見|立ち回り方|思考回路|何も思いつか|答え見て|本番できてない|点は上がらない)/,
    category: "学習",
    sectionStatus: "落ちた",
    title: "初見問題で止まる原因の整理",
    whatHappened: "課題は把握できても、初見問題で最初の一手が出ず、本番で再現できない場面があると整理された。",
    coachPoint: "知識不足よりも、解いている最中の思考回路と判断の癖を振り返る視点が必要である。",
    studentState: "答えを見れば理解できる一方、本番では最初の一手が出にくい。",
    summaryFact: "課題は見えていても、初見問題で最初の一手が出ず、点数に結びつかない場面がある。",
    summaryCore: "いま不足しているのは単なる知識量よりも、初見問題での立ち回りと振り返りの質である。",
    highlightLabel: "初見問題の詰まり",
    highlightValue: "知識はあるが、本番では最初の一手が出にくい。",
    nextQuestion: "最近の演習で『何も思いつかない』となったのはどの問題だった？",
    topicTitle: "初見問題で止まる瞬間の整理",
    topicReason: "知識量よりも『最初の一手が出ないこと』が主な詰まりとして見えているため。",
    topicQuestion: "最近の演習で『何も思いつかない』となったのはどの問題だった？",
    stateLabel: "詰まり",
    stateOneLiner: "知識はあるが、初見問題で最初の一手が出にくい。",
    buildCoachAction: (sessionType) => ({
      owner: "COACH",
      action:
        sessionType === "LESSON_REPORT"
          ? "次回授業の冒頭で、止まった問題と最初に試した一手を確認する。"
          : "次回は記録した思考メモを見ながら、再現できた一手とまだ出ない一手を整理する。",
      due: null,
      metric:
        sessionType === "LESSON_REPORT"
          ? "止まった問題1題と、試した一手1つを確認する。"
          : "再現できた一手1つ、まだ出ない一手1つを確認する。",
      why: "演習量ではなく、解くときの判断が更新できているかを確認するため。",
    }),
  },
  {
    key: "review_method",
    match: /(復習っていうのも参考書に戻ればいいってわけじゃない|書いてったほうが|言語化してったほうが|直角を探そう|一次独立|1,2,3で代入|微分する前)/,
    category: "学習",
    sectionStatus: "維持",
    title: "復習方法の更新",
    whatHappened: "復習は参考書に戻るだけでなく、解けなかった場面の思考回路と次の一手を言葉にして残す方針が出た。",
    coachPoint: "問題タイプごとに最初の一手や判断基準をメモとして蓄積し、次の初見問題に持ち込む。",
    studentState: "知識は持っているが、使い方を言語化すると伸びやすい段階にある。",
    summaryFact: "復習は参考書に戻るだけではなく、初見問題で自分が何を考え、何が抜けたかを言葉にして残す必要がある。",
    summaryCore: "問題タイプごとに最初の一手を言語化して蓄積すれば、演習が次の得点につながる復習になる。",
    highlightLabel: "思考メモ",
    highlightValue: "問題タイプごとに『次に最初にやること』を言語化して残す。",
    nextQuestion: "ベクトル・数列・微分で、次から最初に見ることを何て書く？",
    topicTitle: "思考メモの書き方確認",
    topicReason: "ベクトル・数列・微分で最初に見るポイントを言語化して残す方針が出ているため。",
    topicQuestion: "ベクトルや数列で、次から最初に確認することを何て書く？",
    buildStudentAction: () => ({
      owner: "STUDENT",
      action: "初見演習を解いた日は、止まった理由と『次に最初にやること』を1件メモする。",
      due: null,
      metric: "次回までに思考メモが3件以上あり、各メモに『止まった理由』『次にやる一手』が入っている。",
      why: "課題が分かるだけで終わらせず、次の初見問題で再現できる形にするため。",
    }),
  },
  {
    key: "weak_unit",
    match: /(確率|毎回確率できねえ|毎回確率合わねえ|問題集で解いたり|できるレベルのやつ探して)/,
    category: "学習",
    sectionStatus: "落ちた",
    title: "崩れやすい単元の補強",
    whatHappened: "確率など毎回崩れやすい単元は、過去問だけでなく解けるレベルの問題集で補強する必要があると確認した。",
    coachPoint: "毎回止まる単元は、できるレベルの演習で共通する詰まりを見つけて立て直す。",
    studentState: "同じ単元で繰り返し止まりやすい。",
    summaryFact: "確率など毎回崩れやすい単元は、過去問だけでなく補強用の問題集で練習する選択肢が出ている。",
    summaryCore: "毎回止まる単元は、解けるレベルから詰まり方を分解して立て直す方が得点化しやすい。",
    highlightLabel: "弱点単元",
    highlightValue: "確率など毎回崩れる単元は、解けるレベルから補強する必要がある。",
    nextQuestion: "今いちばん補強したい単元は、確率以外にどこがある？",
    topicTitle: "崩れやすい単元の補強",
    topicReason: "毎回崩れる単元は、過去問だけでなく補強演習を入れる必要があるため。",
    topicQuestion: "今いちばん補強したい単元は、確率以外にどこがある？",
    buildStudentAction: () => ({
      owner: "STUDENT",
      action: "確率など毎回崩れやすい単元を、解けるレベルの問題集で補強する。",
      due: null,
      metric: "同じ単元を3題以上解き、共通する詰まりを1つ言語化する。",
      why: "過去問だけでは再現しにくい弱点を、解けるレベルから立て直すため。",
    }),
  },
  {
    key: "common_test",
    match: /(共通テスト|センター試験|予想問題集|1月入ってから|各予備校|国立志望)/,
    category: "進路",
    sectionStatus: "維持",
    title: "共通テスト対策の入れ方",
    whatHappened: "共通テスト対策は必要だが、私大対策と並行する中で入れる時期と教材を早めに決める必要があると確認した。",
    coachPoint: "使う教材と開始時期を先に決め、直前期は形式をぶらさずに回す。",
    studentState: "必要性は分かっているが、切り替えの設計を早めに固めたい。",
    summaryFact: "共通テスト対策はまだ十分でなく、予想問題集の活用や、いつから比重を上げるかの設計が必要になっている。",
    summaryCore: "共通テスト対策は科目ごとの過去問の流れに組み込み、使う教材と切り替え時期を早めに決めるべきである。",
    highlightLabel: "共通テスト対策",
    highlightValue: "入れる時期と使う教材を早めに決める必要がある。",
    nextQuestion: "共通テスト型の演習を、今の週のどこに入れるのが現実的？",
    topicTitle: "共通テスト対策を入れる時期",
    topicReason: "私大対策と並行しつつ、共通テスト特有の形式にも早めに慣れる必要があるため。",
    topicQuestion: "共通テスト型の演習を、今の週のどこに入れるのが現実的？",
    buildStudentAction: () => ({
      owner: "STUDENT",
      action: "共通テスト型演習を入れる時期と使う教材を決め、週のどこで回すかを決める。",
      due: null,
      metric: "次回までの学習計画に共通テスト演習の枠と教材名が入っている。",
      why: "私大対策と並行しても、共通テスト特有の形式に慣れる時間を確保するため。",
    }),
  },
];

function extractTranscriptThemes(
  transcript: string,
  sessionType?: "INTERVIEW" | "LESSON_REPORT"
): TranscriptTheme[] {
  const lines = transcriptLinesForFallback(transcript);
  const used = new Set<string>();
  const themes: TranscriptTheme[] = [];

  for (const spec of TRANSCRIPT_THEME_SPECS) {
    const evidence = lines.filter((line) => spec.match.test(line) && !used.has(line)).slice(0, 4);
    if (evidence.length === 0) continue;
    for (const line of evidence) used.add(line);
    themes.push({
      key: spec.key,
      category: spec.category,
      sectionStatus: spec.sectionStatus,
      title: spec.title,
      whatHappened: spec.whatHappened,
      coachPoint: spec.coachPoint,
      studentState: spec.studentState,
      summaryFact: spec.summaryFact,
      summaryCore: spec.summaryCore,
      highlightLabel: spec.highlightLabel,
      highlightValue: spec.highlightValue,
      nextQuestion: spec.nextQuestion,
      topicTitle: spec.topicTitle,
      topicReason: spec.topicReason,
      topicQuestion: spec.topicQuestion,
      evidenceQuotes: sanitizeQuotes(evidence),
      studentAction: spec.buildStudentAction?.(),
      coachAction: spec.buildCoachAction?.(sessionType),
      stateLabel: spec.stateLabel,
      stateOneLiner: spec.stateOneLiner,
    });
  }

  return themes;
}

function buildTimelineFromThemes(themes: TranscriptTheme[], minTimelineSections: number): TimelineSection[] {
  const timeline = themes.slice(0, Math.max(minTimelineSections, Math.min(themes.length, 4))).map((theme) => ({
    title: theme.title,
    what_happened: theme.whatHappened,
    coach_point: theme.coachPoint,
    student_state: theme.studentState,
    evidence_quotes: theme.evidenceQuotes,
  }));
  return normalizeTimeline(timeline);
}

function buildNextActionsFromThemes(
  themes: TranscriptTheme[],
  sessionType?: "INTERVIEW" | "LESSON_REPORT"
): NextAction[] {
  const actionPriority: Record<string, number> = {
    review_method: 0,
    weak_unit: 1,
    common_test: 2,
    time_allocation: 3,
    unseen_problem: 4,
  };
  const studentActions = themes
    .filter((theme) => theme.studentAction)
    .sort((a, b) => (actionPriority[a.key] ?? 99) - (actionPriority[b.key] ?? 99))
    .map((theme) => theme.studentAction!)
    .filter((action) => !hasBadUserFacingText([action.action, action.metric, action.why].join(" ")));

  const coachAction = themes.find((theme) => theme.coachAction)?.coachAction ?? {
    owner: "COACH",
    action:
      sessionType === "LESSON_REPORT"
        ? "次回授業の冒頭で実行結果を確認し、つまずきの原因を一つに絞る。"
        : "次回の会話で実行結果を確認し、詰まった原因を一緒に言語化する。",
    due: null,
    metric:
      sessionType === "LESSON_REPORT"
        ? "できたこと1点と止まった点1点を確認する。"
        : "達成できた点1つと、次に直す点1つを確認する。",
      why: "次の支援を感覚ではなく、実行結果に基づいて決めるため。",
  };

  const dedupedStudents = dedupePreserveOrder(studentActions.map((action) => JSON.stringify(action)))
    .map((item) => JSON.parse(item) as NextAction)
    .slice(0, 3);

  return normalizeNextActions([...dedupedStudents, coachAction]);
}

function buildProfileSectionsFromThemes(themes: TranscriptTheme[]): ProfileSection[] {
  const grouped = new Map<ProfileCategory, ProfileSection>();
  const statusRank: Record<ProfileSectionStatus, number> = {
    落ちた: 3,
    改善: 2,
    維持: 1,
    不明: 0,
  };

  for (const theme of themes) {
    const current = grouped.get(theme.category) ?? {
      category: theme.category,
      status: theme.sectionStatus,
      highlights: [],
      nextQuestion: theme.nextQuestion,
    };
    current.highlights.push({
      label: theme.highlightLabel,
      value: theme.highlightValue,
      isNew: true,
      isUpdated: false,
    });
    if (statusRank[theme.sectionStatus] > statusRank[current.status]) {
      current.status = theme.sectionStatus;
    }
    if (!current.nextQuestion) current.nextQuestion = theme.nextQuestion;
    grouped.set(theme.category, current);
  }

  return normalizeProfileSections(
    Array.from(grouped.values()).map((section) => ({
      ...section,
      highlights: section.highlights.slice(0, 4),
    }))
  );
}

function buildRecommendedTopicsFromThemes(themes: TranscriptTheme[]): RecommendedTopic[] {
  return normalizeRecommendedTopics(
    themes.slice(0, 6).map((theme, index) => ({
      category: theme.category,
      title: theme.topicTitle,
      reason: theme.topicReason,
      question: theme.topicQuestion,
      priority: index + 1,
    }))
  );
}

function buildQuickQuestionsFromThemes(themes: TranscriptTheme[]): QuickQuestion[] {
  return normalizeQuickQuestions(
    themes.slice(0, 5).map((theme) => ({
      category: theme.category,
      question: theme.topicQuestion,
      reason: theme.topicReason,
    }))
  );
}

function buildStudentStateFromThemes(themes: TranscriptTheme[], transcript: string): StudentStateCard | null {
  if (themes.length === 0) return null;
  const severity: Record<StudentStateLabel, number> = {
    落ち込み: 7,
    不安: 6,
    疲れ: 5,
    詰まり: 4,
    集中: 3,
    前進: 2,
    高揚: 1,
    安定: 0,
  };

  const selected =
    themes
      .filter((theme) => theme.stateLabel)
      .sort((a, b) => severity[b.stateLabel ?? "安定"] - severity[a.stateLabel ?? "安定"])[0] ??
    themes[0];

  const rationale = dedupePreserveOrder(
    [selected, ...themes.filter((theme) => theme.key !== selected.key)]
      .flatMap((theme) => theme.evidenceQuotes)
      .filter(Boolean)
  ).slice(0, 3);

  return normalizeStudentState({
    label: selected.stateLabel ?? inferStudentStateLabel(transcript),
    oneLiner: selected.stateOneLiner ?? buildStateOneLiner(transcript, selected.stateLabel ?? inferStudentStateLabel(transcript)),
    rationale,
    confidence: 84,
  });
}

function buildSummaryFromThemes(
  themes: TranscriptTheme[],
  nextActions: NextAction[],
  transcript: string,
  minSummaryChars: number
) {
  const factLines = dedupePreserveOrder(themes.map((theme) => theme.summaryFact)).slice(0, 5);
  const coreLines = dedupePreserveOrder(themes.map((theme) => theme.summaryCore)).slice(0, 5);
  const actionLines = nextActions.map((action) => `${formatActionOwnerLabel(action.owner)}: ${action.action}（指標: ${action.metric}）`);
  const lines = [
    "## 面談で確認した事実",
    ...factLines.map((line) => `- ${line}`),
    "",
    "## 指導の核",
    ...coreLines.map((line) => `- ${line}`),
    "",
    "## 次回方針",
    ...actionLines.map((line) => `- ${line}`),
  ];

  return ensureMinChars(
    lines.join("\n").trim(),
    minSummaryChars,
    [...factLines, ...coreLines, ...actionLines, ...transcriptLinesForFallback(transcript).slice(0, 6)]
  );
}

function buildParentPackFromThemes(
  themes: TranscriptTheme[],
  nextActions: NextAction[],
  transcript: string
): ParentPack {
  return normalizeParentPack({
    what_we_did: dedupePreserveOrder(themes.map((theme) => theme.summaryFact)).slice(0, 3),
    what_improved: dedupePreserveOrder(themes.map((theme) => theme.studentState)).slice(0, 3),
    what_to_practice: nextActions
      .filter((action) => action.owner === "STUDENT")
      .map((action) => action.action)
      .slice(0, 3),
    risks_or_notes: themes
      .filter((theme) => theme.sectionStatus === "落ちた")
      .map((theme) => theme.highlightValue)
      .slice(0, 3),
    next_time_plan: nextActions.map((action) => action.metric).slice(0, 3),
    evidence_quotes: sanitizeQuotes(
      themes.flatMap((theme) => theme.evidenceQuotes).concat(transcriptLinesForFallback(transcript).slice(0, 2))
    ),
  });
}

function normalizeQualityKey(text: string) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/[「」『』（）()［］\[\]、。・\s]/g, "")
    .trim();
}

function hasDuplicateNormalizedText(items: string[]) {
  const normalized = items.map((item) => normalizeQualityKey(item)).filter((item) => item.length >= 6);
  return normalized.length >= 2 && new Set(normalized).size < normalized.length;
}

function isWeakSummaryMarkdown(summary: string) {
  const lines = summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("## "));
  if (lines.length < 4) return true;
  if (hasDuplicateNormalizedText(lines)) return true;
  if (lines.some((line) => isLowSignalPlaceholder(line))) return true;
  return false;
}

function shouldUseThemeFallback(
  result: {
    summaryMarkdown: string;
    timeline: TimelineSection[];
    nextActions: NextAction[];
    recommendedTopics: RecommendedTopic[];
    quickQuestions: QuickQuestion[];
    profileSections: ProfileSection[];
    studentState: StudentStateCard;
  },
  minTimelineSections: number
) {
  if (isWeakSummaryMarkdown(result.summaryMarkdown)) return true;
  if ((result.timeline ?? []).length < minTimelineSections) return true;
  if ((result.nextActions ?? []).length < 2) return true;
  if ((result.recommendedTopics ?? []).length < 3) return true;
  if ((result.profileSections ?? []).length === 0) return true;
  if (hasDuplicateNormalizedText(result.recommendedTopics.map((topic) => topic.title))) return true;
  if (hasDuplicateNormalizedText(result.quickQuestions.map((item) => item.question))) return true;
  if (hasDuplicateNormalizedText(result.studentState.rationale ?? [])) return true;
  return false;
}

function compactAnalysesForPrompt(analyses: ChunkAnalysis[]) {
  return analyses.map((a) => ({
    index: a.index,
    facts: limitArray(a.facts, 10),
    coaching_points: limitArray(a.coaching_points, 8),
    decisions: limitArray(a.decisions, 6),
    student_state_delta: limitArray(a.student_state_delta, 6),
    todo_candidates: limitArray(a.todo_candidates, 5).map((t) => ({
      owner: t.owner,
      action: t.action,
      due: t.due,
      metric: t.metric,
      why: t.why,
      evidence_quotes: limitArray(t.evidence_quotes, 2),
    })),
    timeline_candidates: limitArray(a.timeline_candidates, 5).map((t) => ({
      title: t.title,
      what_happened: t.what_happened,
      coach_point: t.coach_point,
      student_state: t.student_state,
      evidence_quotes: limitArray(t.evidence_quotes, 2),
    })),
    profile_delta_candidates: {
      basic: limitArray(a.profile_delta_candidates?.basic, 6).map((i) => ({
        field: i.field,
        value: i.value,
        confidence: i.confidence,
        evidence_quotes: limitArray(i.evidence_quotes, 2),
      })),
      personal: limitArray(a.profile_delta_candidates?.personal, 6).map((i) => ({
        field: i.field,
        value: i.value,
        confidence: i.confidence,
        evidence_quotes: limitArray(i.evidence_quotes, 2),
      })),
    },
    quotes: limitArray(a.quotes, 4),
    safety_flags: limitArray(a.safety_flags, 4),
  }));
}

function compactReducedForPrompt(reduced: ReducedAnalysis): ReducedAnalysis {
  const normalized = normalizeReducedAnalysis(reduced);
  return {
    facts: limitArray(normalized.facts, 20),
    coaching_points: limitArray(normalized.coaching_points, 16),
    decisions: limitArray(normalized.decisions, 12),
    student_state_delta: limitArray(normalized.student_state_delta, 12),
    todo_candidates: limitArray(normalized.todo_candidates, 10).map((t) => ({
      owner: t.owner,
      action: t.action,
      due: t.due,
      metric: t.metric,
      why: t.why,
      evidence_quotes: limitArray(t.evidence_quotes, 2),
    })),
    timeline_candidates: limitArray(normalized.timeline_candidates, 10).map((t) => ({
      title: t.title,
      what_happened: t.what_happened,
      coach_point: t.coach_point,
      student_state: t.student_state,
      evidence_quotes: limitArray(t.evidence_quotes, 2),
    })),
    profile_delta_candidates: {
      basic: limitArray(normalized.profile_delta_candidates?.basic, 12).map((i) => ({
        field: i.field,
        value: i.value,
        confidence: i.confidence,
        evidence_quotes: limitArray(i.evidence_quotes, 2),
      })),
      personal: limitArray(normalized.profile_delta_candidates?.personal, 12).map((i) => ({
        field: i.field,
        value: i.value,
        confidence: i.confidence,
        evidence_quotes: limitArray(i.evidence_quotes, 2),
      })),
    },
    quotes: limitArray(normalized.quotes, 12),
    safety_flags: limitArray(normalized.safety_flags, 8),
  };
}

function chunkAnalysisToReduced(analysis: ChunkAnalysis): ReducedAnalysis {
  return normalizeReducedAnalysis({
    facts: analysis.facts ?? [],
    coaching_points: analysis.coaching_points ?? [],
    decisions: analysis.decisions ?? [],
    student_state_delta: analysis.student_state_delta ?? [],
    todo_candidates: analysis.todo_candidates ?? [],
    timeline_candidates: analysis.timeline_candidates ?? [],
    profile_delta_candidates: analysis.profile_delta_candidates ?? { basic: [], personal: [] },
    quotes: analysis.quotes ?? [],
    safety_flags: analysis.safety_flags ?? [],
  });
}

export async function analyzeChunkBlocks(
  blocks: Array<{ index: number; text: string; hash: string }>,
  opts: { studentName?: string; teacherName?: string }
): Promise<{ analyses: ChunkAnalysis[]; model: string; apiCalls: number }> {
  const model = getFastModel();
  const studentLabel = formatStudentLabel(opts.studentName);
  const teacherLabel = formatTeacherLabel(opts.teacherName);
  let apiCalls = 0;

  const singleSystem = `あなたは学習塾・個別指導の教務責任者です。
会話チャンクから、後続の要約・Student Room・保護者共有に使う構造化情報だけを抽出してください。
出力は厳密な JSON object のみ。ユーザー向け文は必ず自然な日本語にしてください。`;

  const analyzeSingle = async (block: ChunkBlockInput): Promise<ChunkAnalysis> => {
    const user = `会話チャンク #${block.index + 1}
${block.text}

出力 JSON:
{
  "facts": ["..."],
  "coaching_points": ["..."],
  "decisions": ["..."],
  "student_state_delta": ["..."],
  "todo_candidates": [
    { "owner": "COACH|STUDENT|PARENT", "action": "...", "due": "YYYY-MM-DD or null", "metric": "...", "why": "...", "evidence_quotes": ["..."] }
  ],
  "timeline_candidates": [
    { "title": "...", "what_happened": "...", "coach_point": "...", "student_state": "...", "evidence_quotes": ["..."] }
  ],
  "profile_delta_candidates": {
    "basic": [
      { "field": "school|grade|targets|subjects|materials|mockResults|guardian|schedule|issues|nextSessionPlan", "value": "...", "confidence": 0-100, "evidence_quotes": ["..."] }
    ],
    "personal": [
      { "field": "...", "value": "...", "confidence": 0-100, "evidence_quotes": ["..."] }
    ]
  },
  "quotes": ["..."],
  "safety_flags": ["PII","SENSITIVE","AMBIGUOUS"]
}

ルール:
- 推測は禁止。会話から確認できることだけ書く
- 出力する文はすべて日本語にする
- facts は事実のみ。感想や抽象論で逃げない
- coaching_points は ${teacherLabel} が伝えた指導の核
- quotes は ${studentLabel} または ${teacherLabel} の短い引用
- 文字起こしのコピペは禁止。要点に言い換える
- facts<=10, coaching_points<=8, decisions<=6, student_state_delta<=6
- todo_candidates<=5, timeline_candidates<=5, profile basic/personal<=6`; 

    apiCalls += 1;
    const { contentText, raw } = await callChatCompletions({
      model,
      messages: [
        { role: "system", content: singleSystem },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
      max_completion_tokens: ANALYZE_MAX_TOKENS,
    });

    const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
    const parsed = tryParseJson<any>(jsonText) ?? {};
    return parseChunkAnalysisLike(parsed, block);
  };

  const uniqueByHash = new Map<string, ChunkBlockInput>();
  for (const block of blocks) {
    if (!uniqueByHash.has(block.hash)) {
      uniqueByHash.set(block.hash, { index: block.index, text: block.text, hash: block.hash });
    }
  }
  const uniqueBlocks = Array.from(uniqueByHash.values());
  const analysisByHash = new Map<string, ChunkAnalysis>();

  if (ANALYZE_BATCH_SIZE > 1 && uniqueBlocks.length > 1) {
    const batchSystem = `複数チャンクを同時分析する。
必ず JSON object のみを返す。形式は {"analyses":[...]}。
analyses は入力チャンク数と同数で、各要素に hash と index を含める。
ユーザー向け文は必ず日本語にする。`;
    const batches = splitIntoBatches(uniqueBlocks, ANALYZE_BATCH_SIZE);

    const runBatch = async (batch: ChunkBlockInput[]) => {
      const batchUser = `生徒: ${studentLabel}\n講師: ${teacherLabel}\n\n入力チャンク:\n${compactJson(batch)}\n\n出力 JSON:\n{\n  "analyses": [\n    {\n      "hash": "input hash",\n      "index": 0,\n      "facts": ["..."],\n      "coaching_points": ["..."],\n      "decisions": ["..."],\n      "student_state_delta": ["..."],\n      "todo_candidates": [{ "owner": "COACH|STUDENT|PARENT", "action": "...", "due": "YYYY-MM-DD or null", "metric": "...", "why": "...", "evidence_quotes": ["..."] }],\n      "timeline_candidates": [{ "title": "...", "what_happened": "...", "coach_point": "...", "student_state": "...", "evidence_quotes": ["..."] }],\n      "profile_delta_candidates": { "basic": [], "personal": [] },\n      "quotes": ["..."],\n      "safety_flags": ["PII","SENSITIVE","AMBIGUOUS"]\n    }\n  ]\n}\nルール:\n- すべて日本語\n- 推測禁止\n- 各分析は簡潔に保つ（facts<=10, coaching_points<=8, decisions<=6, student_state_delta<=6, todo<=5, timeline<=5）`;
      apiCalls += 1;
      const { contentText, raw } = await callChatCompletions({
        model,
        messages: [
          { role: "system", content: batchSystem },
          { role: "user", content: batchUser },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
        max_completion_tokens: Math.min(ANALYZE_BATCH_MAX_TOKENS, ANALYZE_MAX_TOKENS * Math.max(1, batch.length)),
      });
      const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
      const parsed = tryParseJson<any>(jsonText) ?? {};
      const items = Array.isArray(parsed.analyses)
        ? parsed.analyses
        : Array.isArray(parsed)
          ? parsed
          : [];
      const byHash = new Map(batch.map((b) => [b.hash, b]));
      const byIndex = new Map(batch.map((b) => [b.index, b]));
      for (const item of items) {
        const hash = String(item?.hash ?? "");
        const index = Number(item?.index);
        const block = byHash.get(hash) ?? (Number.isFinite(index) ? byIndex.get(index) : undefined);
        if (!block) continue;
        analysisByHash.set(block.hash, parseChunkAnalysisLike(item, block));
      }
    };

    for (let i = 0; i < batches.length; i += ANALYZE_BATCH_CONCURRENCY) {
      const window = batches.slice(i, i + ANALYZE_BATCH_CONCURRENCY);
      await Promise.all(window.map((batch) => runBatch(batch).catch(() => null)));
    }
  }

  const missing = uniqueBlocks.filter((block) => !analysisByHash.has(block.hash));
  if (missing.length > 0) {
    const fallback = await Promise.all(missing.map((block) => analyzeSingle(block)));
    for (const item of fallback) {
      analysisByHash.set(item.hash, item);
    }
  }

  const analyses = blocks.map((block) => {
    const found = analysisByHash.get(block.hash);
    if (found) {
      return { ...found, index: block.index, hash: block.hash };
    }
    return {
      index: block.index,
      hash: block.hash,
      facts: [],
      coaching_points: [],
      decisions: [],
      student_state_delta: [],
      todo_candidates: [],
      timeline_candidates: [],
      profile_delta_candidates: { basic: [], personal: [] },
      quotes: [],
      safety_flags: ["NO_ANALYSIS"],
    } as ChunkAnalysis;
  });

  return { analyses, model, apiCalls };
}

export async function reduceChunkAnalyses(input: {
  analyses: ChunkAnalysis[];
  studentName?: string;
  teacherName?: string;
}): Promise<{ reduced: ReducedAnalysis; model: string; apiCalls: number }> {
  if (input.analyses.length === 1) {
    return {
      reduced: chunkAnalysisToReduced(input.analyses[0]),
      model: "reuse-single",
      apiCalls: 0,
    };
  }

  const model = getFastModel();
  const studentLabel = formatStudentLabel(input.studentName);
  const teacherLabel = formatTeacherLabel(input.teacherName);
  const compactAnalyses = compactAnalysesForPrompt(input.analyses);

  const system = `あなたは学習塾・個別指導の教務責任者です。
複数チャンクの分析結果を一つの reduced analysis に統合してください。
出力は厳密な JSON object のみ。ユーザー向け文は必ず日本語にしてください。`;

  const user = `生徒: ${studentLabel}
講師: ${teacherLabel}

チャンク分析:
${compactJson(compactAnalyses)}

出力 JSON:
{
  "facts": ["..."],
  "coaching_points": ["..."],
  "decisions": ["..."],
  "student_state_delta": ["..."],
  "todo_candidates": [...],
  "timeline_candidates": [...],
  "profile_delta_candidates": { "basic": [...], "personal": [...] },
  "quotes": ["..."],
  "safety_flags": ["..."]
}

ルール:
- 同じ意味の項目は統合する
- 行動と根拠は落とさない
- 抽象語で逃げず、運用に使える粒度で書く
- すべて日本語で返す`;

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
  const parsed = tryParseJson<ReducedAnalysis>(jsonText) ?? {
    facts: [],
    coaching_points: [],
    decisions: [],
    student_state_delta: [],
    todo_candidates: [],
    timeline_candidates: [],
    profile_delta_candidates: { basic: [], personal: [] },
    quotes: [],
    safety_flags: [],
  };

  const reduced = normalizeReducedAnalysis(parsed);
  return { reduced, model, apiCalls: 1 };
}

function buildFinalizePrompt(input: {
  studentName?: string;
  teacherName?: string;
  reduced: ReducedAnalysis;
  minSummaryChars: number;
  minTimelineSections?: number;
  sessionType?: "INTERVIEW" | "LESSON_REPORT";
  entityDictionary?: Array<{ kind: string; canonicalName: string; aliases?: string[] }>;
}): { system: string; user: string } {
  const studentLabel = formatStudentLabel(input.studentName);
  const teacherLabel = formatTeacherLabel(input.teacherName);
  const timelineTarget = input.minTimelineSections ?? 3;
  const reducedCompact = compactReducedForPrompt(input.reduced);
  const sessionType = input.sessionType ?? "INTERVIEW";

  const system = `あなたは学習塾・個別指導の教務責任者です。
与えられた evidence だけを使って、会話ログ詳細・Student Room・保護者共有の材料を最終生成してください。
出力は厳密な JSON object のみ。summaryMarkdown 以外で markdown を使わないでください。

品質要件:
- ユーザー向け文はすべて日本語
- summaryMarkdown は ${input.minSummaryChars} 文字以上
- 見出しは必ず「## 会話で確認できた事実」「## 指導の要点（講師が伝えた核）」「## 次回までの方針」
- timeline は evidence がある限り ${timelineTarget} セクション以上
- nextActions は owner/action/metric/why を必ず含め、確認できる粒度にする
- profileDelta は confidence と evidence_quotes を必ず含める
- parentPack は保護者が読んで分かる日本語にする
- recommendedTopics / quickQuestions は、次の会話でそのまま使える自然な質問にする
- 情報がないカテゴリを無理に埋めない
- 文字起こしの長文コピペは禁止`;

  const user = `生徒: ${studentLabel}
講師: ${teacherLabel}
セッション種別: ${sessionType}
既知の固有名詞辞書: ${compactJson(input.entityDictionary ?? [])}

Reduced evidence JSON:
${compactJson(reducedCompact)}

出力 JSON:
{
  "summaryMarkdown": "...",
  "timeline": [
    {
      "title": "...",
      "what_happened": "...",
      "coach_point": "...",
      "student_state": "...",
      "evidence_quotes": ["..."]
    }
  ],
  "nextActions": [
    {
      "owner": "COACH|STUDENT|PARENT",
      "action": "...",
      "due": "YYYY-MM-DD or null",
      "metric": "...",
      "why": "..."
    }
  ],
  "profileDelta": {
    "basic": [
      { "field": "...", "value": "...", "confidence": 0-100, "evidence_quotes": ["..."] }
    ],
    "personal": [
      { "field": "...", "value": "...", "confidence": 0-100, "evidence_quotes": ["..."] }
    ]
  },
  "parentPack": {
    "what_we_did": ["..."],
    "what_improved": ["..."],
    "what_to_practice": ["..."],
    "risks_or_notes": ["..."],
    "next_time_plan": ["..."],
    "evidence_quotes": ["..."]
  },
  "studentState": {
    "label": "前進|集中|安定|不安|疲れ|詰まり|落ち込み|高揚",
    "oneLiner": "...",
    "rationale": ["..."],
    "confidence": 0-100
  },
  "recommendedTopics": [
    {
      "category": "学習|生活|学校|進路",
      "title": "...",
      "reason": "...",
      "question": "...",
      "priority": 1
    }
  ],
  "quickQuestions": [
    {
      "category": "学習|生活|学校|進路",
      "question": "...",
      "reason": "..."
    }
  ],
  "profileSections": [
    {
      "category": "学習|生活|学校|進路",
      "status": "改善|維持|落ちた|不明",
      "highlights": [
        { "label": "...", "value": "...", "isNew": true, "isUpdated": false }
      ],
      "nextQuestion": "..."
    }
  ],
  "entityCandidates": [
    {
      "kind": "SCHOOL|TARGET_SCHOOL|MATERIAL|EXAM|CRAM_SCHOOL|TEACHER|METRIC|OTHER",
      "rawValue": "...",
      "canonicalValue": "...",
      "confidence": 0-100,
      "status": "PENDING",
      "context": "..."
    }
  ],
  "observationEvents": [
    {
      "sourceType": "${sessionType}",
      "category": "学習|生活|学校|進路",
      "statusDraft": "改善|維持|落ちた|不明",
      "insights": ["..."],
      "topics": ["..."],
      "nextActions": ["..."],
      "evidence": ["..."],
      "characterSignal": "...",
      "weight": 1
    }
  ],
  "lessonReport": {
    "todayGoal": "...",
    "covered": ["..."],
    "blockers": ["..."],
    "homework": ["..."],
    "nextLessonFocus": ["..."],
    "parentShareDraft": "..."
  }
}

追加ルール:
- 英語は使わない
- 「情報が薄いので確認」などの埋め草は禁止
- timeline/title や topic/title は、会話の論点が分かる具体名にする
- quickQuestions は 30 秒で聞ける長さにする`;

  return { system, user };
}

function buildFallbackSummaryMarkdown(
  reduced: ReducedAnalysis,
  current: string,
  minSummaryChars: number
) {
  if (current && current.length >= minSummaryChars && !hasBadUserFacingText(current)) return current;
  const facts = (reduced.facts ?? []).slice(0, 6);
  const points = (reduced.coaching_points ?? []).slice(0, 6);
  const decisions = (reduced.decisions ?? []).slice(0, 4);
  const actions = (reduced.todo_candidates ?? [])
    .filter((item) => item?.action && item?.metric)
    .slice(0, 4)
    .map((item) => `${formatActionOwnerLabel(item.owner)}: ${item.action}（指標: ${item.metric}）`);
  const lines: string[] = [
    "## 面談で確認した事実",
    ...facts.map((v) => `- ${v}`),
    "",
    "## 指導の核",
    ...points.map((v) => `- ${v}`),
  ];
  const nextStepLines = actions.length > 0 ? actions : decisions;
  if (nextStepLines.length > 0) {
    lines.push("", "## 次回方針");
    lines.push(...nextStepLines.map((v) => `- ${v}`));
  }
  const built = lines.join("\n").trim();
  const filler = [...facts, ...points, ...actions, ...decisions, ...(reduced.student_state_delta ?? []), ...(reduced.quotes ?? [])]
    .map((v) => String(v).trim())
    .filter(Boolean);
  return ensureMinChars(
    `${built}\n\n## 補足\n- 次回は実行した結果と止まった理由をセットで確認する。`,
    minSummaryChars,
    filler.length ? filler : ["今回の会話を、次回までの具体行動につなげる。"]
  );
}

function applyFinalizeHeuristicFallbacks(
  result: FinalizeResult,
  reduced: ReducedAnalysis,
  minSummaryChars: number,
  minTimelineSections: number,
  sessionType?: "INTERVIEW" | "LESSON_REPORT"
): FinalizeResult {
  const timeline = [...(result.timeline ?? [])];
  if (timeline.length < minTimelineSections) {
    const candidates = (reduced.timeline_candidates ?? []).map((t) => ({
      title: t.title ?? "",
      what_happened: t.what_happened ?? "",
      coach_point: t.coach_point ?? "",
      student_state: t.student_state ?? "",
      evidence_quotes: sanitizeQuotes(t.evidence_quotes ?? []),
    }));
    for (const cand of candidates) {
      if (timeline.length >= minTimelineSections) break;
      if (!cand.title && !cand.what_happened) continue;
      timeline.push(cand);
    }
  }

  const nextActions = [...(result.nextActions ?? [])];
  if (nextActions.length === 0) {
    for (const todo of reduced.todo_candidates ?? []) {
      if (!todo?.action || !todo?.metric) continue;
      nextActions.push({
        owner: todo.owner ?? "STUDENT",
        action: String(todo.action).trim(),
        due: todo.due ?? null,
        metric: String(todo.metric).trim(),
        why: String(todo.why ?? "").trim(),
      });
      if (nextActions.length >= 3) break;
    }
  }

  const profileDelta = normalizeProfileDelta(result.profileDelta ?? reduced.profile_delta_candidates ?? { basic: [], personal: [] });
  const summaryMarkdown = buildFallbackSummaryMarkdown(reduced, result.summaryMarkdown ?? "", minSummaryChars);
  const parentPack = normalizeParentPack(result.parentPack ?? {
    what_we_did: reduced.facts.slice(0, 3),
    what_improved: reduced.student_state_delta.slice(0, 3),
    what_to_practice: (reduced.todo_candidates ?? []).map((t) => t.action).slice(0, 3),
    risks_or_notes: reduced.safety_flags.slice(0, 3),
    next_time_plan: reduced.decisions.slice(0, 3),
    evidence_quotes: reduced.quotes.slice(0, 4),
  });

  const profileSections = normalizeProfileSections(result.profileSections ?? []);
  const fallbackTranscript = [summaryMarkdown, ...timeline.map((item) => item.what_happened), ...reduced.quotes].join("\n");
  const profileSectionsFallback =
    profileSections.length > 0
      ? profileSections
      : buildProfileSectionsFromEvidence({
          profileDelta,
          timeline,
          transcript: fallbackTranscript,
        });
  const recommendedTopics = normalizeRecommendedTopics(result.recommendedTopics ?? []);
  const recommendedTopicsFallback =
    recommendedTopics.length > 0
      ? recommendedTopics
      : buildRecommendedTopicsFallback({
          profileSections: profileSectionsFallback,
          nextActions,
          timeline,
        });
  const quickQuestions = normalizeQuickQuestions(result.quickQuestions ?? []);
  const quickQuestionsFallback =
    quickQuestions.length > 0 ? quickQuestions : buildQuickQuestionsFallback(recommendedTopicsFallback);
  const studentState = normalizeStudentState(result.studentState);
  const observationEvents = normalizeObservationEvents(result.observationEvents ?? []);
  const observationEventsFallback =
    observationEvents.length > 0
      ? observationEvents
      : buildObservationEventsFallback({
          transcript: fallbackTranscript,
          profileSections: profileSectionsFallback,
          nextActions,
          recommendedTopics: recommendedTopicsFallback,
          sessionType,
        });
  const entityCandidates = normalizeEntityCandidates(result.entityCandidates ?? []);
  const entityCandidatesFallback =
    entityCandidates.length > 0 ? entityCandidates : buildEntityCandidatesFallback([summaryMarkdown, ...parentPack.evidence_quotes].join("\n"));
  const lessonReport =
    normalizeLessonReport(result.lessonReport) ??
    buildLessonReportFallback({
      transcript: fallbackTranscript,
      nextActions,
      timeline,
      sessionType,
    });

  const baseResult: FinalizeResult = {
    summaryMarkdown,
    timeline: normalizeTimeline(timeline),
    nextActions: normalizeNextActions(nextActions),
    profileDelta,
    parentPack,
    studentState:
      studentState.oneLiner && studentState.rationale.length > 0
        ? studentState
        : buildStudentStateFallback({
            transcript: [summaryMarkdown, ...timeline.map((item) => item.what_happened)].join("\n"),
            timeline,
            nextActions,
            profileDelta,
          }),
    recommendedTopics: recommendedTopicsFallback,
    quickQuestions: quickQuestionsFallback,
    profileSections: profileSectionsFallback,
    entityCandidates: entityCandidatesFallback,
    observationEvents: observationEventsFallback,
    lessonReport,
  };

  const themeTranscript = [summaryMarkdown, ...timeline.map((item) => item.what_happened), ...reduced.quotes].join("\n");
  const themes = extractTranscriptThemes(themeTranscript, sessionType);
  if (themes.length >= 2 && shouldUseThemeFallback(baseResult as any, minTimelineSections)) {
    const themeTimeline = buildTimelineFromThemes(themes, minTimelineSections);
    const themeNextActions = buildNextActionsFromThemes(themes, sessionType);
    const themeProfileSections = buildProfileSectionsFromThemes(themes);
    const themeRecommendedTopics = buildRecommendedTopicsFromThemes(themes);
    const themeQuickQuestions = buildQuickQuestionsFromThemes(themes);
    const themeSummaryMarkdown = buildSummaryFromThemes(themes, themeNextActions, themeTranscript, minSummaryChars);
    const themeStudentState =
      buildStudentStateFromThemes(themes, themeTranscript) ??
      buildStudentStateFallback({
        transcript: themeTranscript,
        timeline: themeTimeline,
        nextActions: themeNextActions,
        profileDelta,
      });
    const themeParentPack = buildParentPackFromThemes(themes, themeNextActions, themeTranscript);
    const themeObservationEvents = buildObservationEventsFallback({
      transcript: themeTranscript,
      profileSections: themeProfileSections,
      nextActions: themeNextActions,
      recommendedTopics: themeRecommendedTopics,
      sessionType,
    });
    const themeLessonReport =
      lessonReport ??
      buildLessonReportFallback({
        transcript: themeTranscript,
        nextActions: themeNextActions,
        timeline: themeTimeline,
        sessionType,
      });

    return {
      ...baseResult,
      summaryMarkdown: themeSummaryMarkdown,
      timeline: themeTimeline,
      nextActions: themeNextActions,
      parentPack: themeParentPack,
      studentState: themeStudentState,
      recommendedTopics: themeRecommendedTopics,
      quickQuestions: themeQuickQuestions,
      profileSections: themeProfileSections,
      observationEvents: themeObservationEvents,
      lessonReport: themeLessonReport,
    };
  }

  return baseResult;
}

function validateFinalizeOutput(
  result: FinalizeResult,
  minSummaryChars: number,
  minTimelineSections: number
) {
  const issues: string[] = [];
  if (!result.summaryMarkdown || result.summaryMarkdown.length < minSummaryChars) {
    issues.push("summaryMarkdown_too_short");
  }
  if ((result.timeline ?? []).length < minTimelineSections) {
    issues.push("timeline_too_short");
  }
  if ((result.nextActions ?? []).length === 0) {
    issues.push("next_actions_missing");
  }
  if (!result.profileDelta) {
    issues.push("profile_delta_missing");
  }
  if (!result.parentPack) {
    issues.push("parent_pack_missing");
  }
  if (!result.studentState?.oneLiner) {
    issues.push("student_state_missing");
  }
  if ((result.recommendedTopics ?? []).length === 0) {
    issues.push("recommended_topics_missing");
  }
  if ((result.profileSections ?? []).length === 0) {
    issues.push("profile_sections_missing");
  }
  return issues;
}

async function repairFinalizeOutput(params: {
  result: FinalizeResult;
  issues: string[];
  studentName?: string;
  teacherName?: string;
  reduced: ReducedAnalysis;
  minSummaryChars: number;
  minTimelineSections: number;
  sessionType?: "INTERVIEW" | "LESSON_REPORT";
  entityDictionary?: Array<{ kind: string; canonicalName: string; aliases?: string[] }>;
}): Promise<FinalizeResult> {
  const { system } = buildFinalizePrompt({
    studentName: params.studentName,
    teacherName: params.teacherName,
    reduced: params.reduced,
    minSummaryChars: params.minSummaryChars,
    minTimelineSections: params.minTimelineSections,
    sessionType: params.sessionType,
    entityDictionary: params.entityDictionary,
  });

  const repairSystem = `${system}

以下のJSONは不足があります。指摘事項を解消して再出力してください。
指摘: ${params.issues.join(" / ")}`;

  const repairUser = `現在のJSON:
${compactJson(params.result)}

修正してJSONのみ出力してください。`;

  const { contentText, raw } = await callChatCompletions({
    model: getFinalModel(),
    messages: [
      { role: "system", content: repairSystem },
      { role: "user", content: repairUser },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    timeoutMs: DEFAULT_LLM_TIMEOUT_MS * 2,
    max_completion_tokens: FINALIZE_MAX_TOKENS,
  });

  const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
  const parsed = tryParseJson<FinalizeResult>(jsonText);
  if (!parsed) return params.result;
  return parsed;
}

function transcriptLinesForFallback(transcript: string) {
  const seen = new Set<string>();
  return transcript
    .replace(/\r\n/g, "\n")
    .split(/\n+|(?<=[。！？.!?])\s*/g)
    .map((line) => maskSensitiveText(String(line).replace(/\s+/g, " ").trim()))
    .flatMap((line) => splitLongTextUnit(line, 120))
    .filter((line) => {
      const normalized = line.trim();
      if (!normalized) return false;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return scoreTranscriptLine(normalized) >= 6;
    });
}

function buildTimelineFallbackFromTranscript(transcript: string, minTimelineSections: number): TimelineSection[] {
  const lines = transcriptLinesForFallback(transcript);
  if (lines.length === 0) return [];

  const target = Math.max(1, minTimelineSections);
  const chunkSize = Math.max(1, Math.ceil(lines.length / target));
  const timeline: TimelineSection[] = [];
  for (let i = 0; i < target; i += 1) {
    const slice = lines.slice(i * chunkSize, (i + 1) * chunkSize);
    if (slice.length === 0) break;
    const joined = slice.join(" / ");
    const summarized = buildTimelineFallbackSummary(joined, i, target);
    timeline.push({
      title: summarized.title,
      what_happened: summarized.what_happened,
      coach_point: summarized.coach_point,
      student_state: summarized.student_state,
      evidence_quotes: sanitizeQuotes(slice.slice(0, 2)),
    });
  }
  while (timeline.length < target && timeline.length > 0) {
    const prev = timeline[timeline.length - 1];
    timeline.push({
      ...prev,
      title: `${prev.title}（補足${timeline.length + 1}）`,
    });
  }
  return timeline;
}

function buildSinglePassFallbackSummary(
  current: string | undefined,
  transcript: string,
  minSummaryChars: number
) {
  if (current && current.length >= minSummaryChars && !hasBadUserFacingText(current)) return current;
  const lines = transcriptLinesForFallback(transcript);
  const parts = [
    "## 今回確認したこと",
    ...lines.slice(0, 4).map((line) => `- ${line}`),
    "",
    "## 次回に向けて",
    "- 次回までに回すことを一つ決め、実行したか確認できる形で残す。",
  ];
  let built = parts.join("\n").trim();
  if (built.length < minSummaryChars) {
    const extra = lines.slice(4, 10).map((line) => `- ${line}`).join("\n");
    if (extra) built = `${built}\n${extra}`;
  }
  return ensureMinChars(
    `${built}\n\n## 補足\n- 次回は結果だけでなく、止まった理由まで確認する。`,
    minSummaryChars,
    lines.length ? lines : ["次回は実行したことと止まった理由をセットで確認する。"]
  );
}

function buildSinglePassStructuredSummary(input: {
  timeline: TimelineSection[];
  nextActions: NextAction[];
  profileDelta: ProfileDelta;
  transcript: string;
  minSummaryChars: number;
}) {
  const facts = input.timeline
    .flatMap((t) => [t.what_happened, t.title])
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const coachCore = [
    ...input.timeline.map((t) => String(t.coach_point ?? "").trim()),
    ...input.profileDelta.basic.map((i) => `${i.field}: ${i.value}`),
    ...input.profileDelta.personal.map((i) => `${i.field}: ${i.value}`),
  ]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const actions = input.nextActions
    .filter((a) => !hasBadUserFacingText([a.action, a.metric, a.why].join(" ")))
    .map((a) => `${formatActionOwnerLabel(a.owner)}: ${a.action}（指標: ${a.metric}）`)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 5);

  const fallbackLines = transcriptLinesForFallback(input.transcript);
  const factLines = facts.length > 0 ? facts : fallbackLines.slice(0, 4);
  const coreLines = coachCore.length > 0 ? coachCore : fallbackLines.slice(4, 8);
  const actionLines =
    actions.length > 0
      ? actions
      : [
          "生徒: 次回までに決めた学習を一つ実行し、やった内容を記録する（指標: 実行内容を1件以上残す）",
          "講師: 次回の会話で進捗を確認し、詰まった点を一つ言語化する（指標: 達成1点・課題1点を確認する）",
        ];

  const lines = [
    "## 面談で確認した事実",
    ...factLines.map((v) => `- ${v}`),
    "",
    "## 指導の核",
    ...coreLines.map((v) => `- ${v}`),
    "",
    "## 次回方針",
    ...actionLines.map((v) => `- ${v}`),
  ];

  const built = lines.join("\n").trim();
  return ensureMinChars(
    built,
    input.minSummaryChars,
    [...factLines, ...coreLines, ...actionLines, ...fallbackLines].filter(Boolean)
  );
}

function profileFieldToCategory(field: string): ProfileCategory {
  const normalized = field.toLowerCase();
  if (/(school|club|teacher|friend|class|行事|学校|部活)/i.test(normalized)) return "学校";
  if (/(target|career|dream|進路|志望|受験)/i.test(normalized)) return "進路";
  if (/(sleep|routine|health|schedule|life|生活|睡眠|体調)/i.test(normalized)) return "生活";
  return "学習";
}

function buildProfileSectionsFromDelta(profileDelta: ProfileDelta): ProfileSection[] {
  const grouped = new Map<ProfileCategory, ProfileSection>();
  for (const category of PROFILE_CATEGORIES) {
    grouped.set(category, {
      category,
      status: "不明",
      highlights: [],
      nextQuestion: "",
    });
  }

  for (const item of [...(profileDelta.basic ?? []), ...(profileDelta.personal ?? [])]) {
    const category = profileFieldToCategory(item.field ?? "");
    const section = grouped.get(category)!;
    section.highlights.push({
      label: String(item.field ?? "").trim(),
      value: String(item.value ?? "").trim(),
      isNew: true,
      isUpdated: false,
    });
    if (section.status === "不明") section.status = "維持";
  }

  return PROFILE_CATEGORIES.map((category) => {
    const section = grouped.get(category)!;
    if (!section.nextQuestion) {
      section.nextQuestion = buildProfileSectionQuestion(category, section.highlights[0]);
    }
    return {
      ...section,
      highlights: section.highlights.slice(0, 4),
    };
  }).filter((section) => section.highlights.length > 0);
}

function inferSectionStatusFromText(text: string): ProfileSectionStatus {
  const normalized = String(text ?? "");
  if (/(伸び|前進|上が|できた|進ん|手応え)/.test(normalized)) return "改善";
  if (/(不安|疲|詰|落ち|止ま|できない|取れない|頭打ち)/.test(normalized)) return "落ちた";
  return "維持";
}

function buildProfileSectionsFromEvidence(input: {
  profileDelta: ProfileDelta;
  timeline: TimelineSection[];
  transcript: string;
}): ProfileSection[] {
  const fromDelta = buildProfileSectionsFromDelta(input.profileDelta);
  const grouped = new Map<ProfileCategory, ProfileSection>();

  for (const section of fromDelta) {
    grouped.set(section.category, {
      ...section,
      highlights: [...section.highlights],
    });
  }

  for (const item of input.timeline) {
    const combined = [item.title, item.what_happened, item.coach_point, item.student_state].join(" ");
    const category = inferCategoryFromText(combined);
    const section = grouped.get(category) ?? {
      category,
      status: inferSectionStatusFromText(combined),
      highlights: [],
      nextQuestion: "",
    };

    const valueCandidate = [item.what_happened, item.coach_point, item.student_state]
      .map((v) => String(v ?? "").trim())
      .find((v) => v && !hasBadUserFacingText(v));

    if (valueCandidate) {
      section.highlights.push({
        label: item.title?.trim() || `${category}の論点`,
        value: valueCandidate,
        isNew: true,
        isUpdated: false,
      });
      section.status = inferSectionStatusFromText(combined);
    }

    if (!section.nextQuestion) {
      section.nextQuestion = buildProfileSectionQuestion(category, section.highlights[0]);
    }
    grouped.set(category, section);
  }

  if (grouped.size === 0) {
    const fallbackLine = transcriptLinesForFallback(input.transcript)[0];
    if (fallbackLine) {
      const category = inferCategoryFromText(fallbackLine);
      grouped.set(category, {
        category,
        status: inferSectionStatusFromText(fallbackLine),
        highlights: [
          {
            label: `${category}の論点`,
            value: fallbackLine,
            isNew: true,
            isUpdated: false,
          },
        ],
        nextQuestion: buildProfileSectionQuestion(category),
      });
    }
  }

  return normalizeProfileSections(
    Array.from(grouped.values()).map((section) => ({
      ...section,
      highlights: dedupePreserveOrder(
        section.highlights.map((highlight) => JSON.stringify(highlight))
      )
        .map((item) => JSON.parse(item))
        .slice(0, 4),
      nextQuestion: section.nextQuestion || buildProfileSectionQuestion(section.category, section.highlights[0]),
    }))
  );
}

function buildStudentStateFallback(input: {
  transcript: string;
  timeline: TimelineSection[];
  nextActions: NextAction[];
  profileDelta: ProfileDelta;
}): StudentStateCard {
  const corpus = [
    ...input.timeline.map((item) => item.student_state),
    ...input.profileDelta.personal.map((item) => item.value),
    ...input.profileDelta.basic.map((item) => item.value),
    input.transcript.slice(0, 1200),
  ].join(" ");
  const label = inferStudentStateLabel(corpus);
  const oneLiner = buildStateOneLiner(corpus, label);

  const rationale = [
    ...input.timeline.map((item) => item.what_happened),
    ...input.timeline.map((item) => item.coach_point),
    ...input.nextActions.map((item) => item.metric),
    ...transcriptLinesForFallback(input.transcript).slice(0, 2),
  ]
    .map((value) => maskSensitiveText(String(value ?? "").trim()))
    .filter((value) => value && !hasBadUserFacingText(value))
    .slice(0, 3);

  return normalizeStudentState({
    label,
    oneLiner,
    rationale,
    confidence: 62,
  });
}

function buildRecommendedTopicsFallback(input: {
  profileSections: ProfileSection[];
  nextActions: NextAction[];
  timeline: TimelineSection[];
}): RecommendedTopic[] {
  const topics: RecommendedTopic[] = [];
  for (const section of input.profileSections.filter((item) => item.highlights.length > 0)) {
    const highlight = section.highlights[0];
    topics.push({
      category: section.category,
      title: highlight ? `${highlight.label}の背景確認` : `${section.category}の確認`,
      reason: highlight ? `${highlight.value}という話が出ており、次の対応を決める材料になるため。` : `${section.category}で会話の手がかりを増やしたいため。`,
      question: buildProfileSectionQuestion(section.category, highlight),
      priority: topics.length + 1,
    });
  }

  for (const item of input.timeline) {
    const evidenceText = [item.what_happened, item.coach_point, item.student_state].join(" ");
    if (!evidenceText.trim()) continue;
    const category = inferCategoryFromText(evidenceText);
    topics.push({
      category,
      title: item.title || `${category}の確認`,
      reason: item.coach_point || "今回の会話で重点的に触れた論点だから。",
      question: buildProfileSectionQuestion(category),
      priority: topics.length + 1,
    });
    if (topics.length >= 4) break;
  }

  for (const action of input.nextActions.filter((item) => !hasBadUserFacingText([item.action, item.metric, item.why].join(" "))).slice(0, 3)) {
    topics.push({
      category: inferCategoryFromText(`${action.action} ${action.metric} ${action.why}`),
      title: "次回までの実行状況",
      reason: action.why || "決めた行動が回ったかで、次の打ち手が変わるため。",
      question: `「${shortenForQuestion(action.action)}」はどこまで進んだ？`,
      priority: topics.length + 1,
    });
  }
  if (topics.length === 0) {
    topics.push({
      category: "学習",
      title: "今週の学習の手応え確認",
      reason: "次回の支援方針を定めるため。",
      question: "今週いちばん進んだ感覚があるのはどこ？",
      priority: 1,
    });
  }
  const deduped = dedupePreserveOrder(
    topics
      .filter((topic) => !hasBadUserFacingText([topic.title, topic.reason, topic.question].join(" ")))
      .map((topic) => JSON.stringify(topic))
  ).map((item) => JSON.parse(item) as RecommendedTopic);
  return normalizeRecommendedTopics(deduped.slice(0, 6));
}

function buildQuickQuestionsFallback(topics: RecommendedTopic[]): QuickQuestion[] {
  return normalizeQuickQuestions(
    topics.slice(0, 5).map((topic) => ({
      category: topic.category,
      question: topic.question,
      reason: topic.reason,
    }))
  );
}

function buildObservationEventsFallback(input: {
  transcript: string;
  profileSections: ProfileSection[];
  nextActions: NextAction[];
  recommendedTopics: RecommendedTopic[];
  sessionType?: "INTERVIEW" | "LESSON_REPORT";
}): ObservationEvent[] {
  const evidence = transcriptLinesForFallback(input.transcript).slice(0, 3);
  const sourceType: ObservationEvent["sourceType"] =
    input.sessionType === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW";
  return normalizeObservationEvents(
    input.profileSections
      .filter((section) => section.highlights.length > 0)
      .map((section) => ({
      sourceType,
      category: section.category,
      statusDraft: section.status,
      insights: section.highlights.map((item) => `${item.label}: ${item.value}`).slice(0, 3),
      topics: input.recommendedTopics
        .filter((topic) => topic.category === section.category)
        .map((topic) => topic.title)
        .slice(0, 3),
      nextActions: input.nextActions.map((item) => item.action).slice(0, 3),
      evidence,
      characterSignal: section.highlights[0]?.value ?? "",
      weight: input.sessionType === "LESSON_REPORT" ? 2 : 4,
    }))
  );
}

function buildEntityCandidatesFallback(transcript: string): EntityCandidate[] {
  const matches = new Set<string>();
  const candidates: EntityCandidate[] = [];
  const patterns: Array<[RegExp, EntityCandidate["kind"]]> = [
    [/([^\s、。]{1,20}(高校|中学|大学))/g, "SCHOOL"],
    [/([^\s、。]{1,20}(模試|試験|英検|漢検))/g, "EXAM"],
    [/([^\s、。]{1,20}(単語帳|教材|テキスト|問題集|参考書))/g, "MATERIAL"],
  ];
  for (const [pattern, kind] of patterns) {
    const found = transcript.matchAll(pattern);
    for (const match of found) {
      const rawValue = String(match[1] ?? "").trim();
      if (!rawValue || matches.has(`${kind}:${rawValue}`)) continue;
      matches.add(`${kind}:${rawValue}`);
      candidates.push({
        kind,
        rawValue,
        canonicalValue: rawValue,
        confidence: 56,
        status: "PENDING",
        context: `会話中に ${rawValue} への言及あり`,
      });
      if (candidates.length >= 8) break;
    }
    if (candidates.length >= 8) break;
  }
  return normalizeEntityCandidates(candidates);
}

function buildLessonReportFallback(input: {
  transcript: string;
  nextActions: NextAction[];
  timeline: TimelineSection[];
  sessionType?: "INTERVIEW" | "LESSON_REPORT";
}): LessonReportArtifact | null {
  if (input.sessionType !== "LESSON_REPORT") return null;
  const lines = transcriptLinesForFallback(input.transcript);
  return normalizeLessonReport({
    todayGoal: lines[0] ?? "授業の狙いを言語化して次回に引き継ぐ。",
    covered: input.timeline.map((item) => item.what_happened).filter(Boolean).slice(0, 3),
    blockers: input.timeline.map((item) => item.student_state).filter(Boolean).slice(0, 3),
    homework: input.nextActions.map((item) => item.action).filter(Boolean).slice(0, 3),
    nextLessonFocus: input.nextActions.map((item) => item.metric).filter(Boolean).slice(0, 3),
    parentShareDraft: lines[1] ?? undefined,
  });
}

function applySinglePassHeuristicFallbacks(
  result: FinalizeResult,
  transcript: string,
  minSummaryChars: number,
  minTimelineSections: number,
  sessionType?: "INTERVIEW" | "LESSON_REPORT"
): FinalizeResult {
  const timeline = normalizeTimeline(result.timeline ?? []);
  if (timeline.length < minTimelineSections) {
    const fallbackTimeline = buildTimelineFallbackFromTranscript(transcript, minTimelineSections);
    for (const section of fallbackTimeline) {
      if (timeline.length >= minTimelineSections) break;
      timeline.push(section);
    }
  }

  const nextActions = normalizeNextActions(result.nextActions ?? []);
  const filteredNextActions = nextActions.filter(
    (item) => !hasBadUserFacingText([item.action, item.metric, item.why].join(" "))
  );
  const fallbackNextActions = buildFallbackNextActions(transcript, sessionType);
  const finalNextActions = [...filteredNextActions];
  for (const action of fallbackNextActions) {
    if (finalNextActions.length >= 3) break;
    finalNextActions.push(action);
  }

  const profileDelta = normalizeProfileDelta(result.profileDelta ?? { basic: [], personal: [] });
  const lines = transcriptLinesForFallback(transcript);
  const parentPack = normalizeParentPack(result.parentPack ?? {
    what_we_did: lines.slice(0, 3),
    what_improved: lines.slice(3, 6),
    what_to_practice: finalNextActions.map((a) => a.action).slice(0, 3),
    risks_or_notes: ["次回は結果だけでなく、止まった理由まで確認する。"],
    next_time_plan: finalNextActions.map((a) => a.metric).slice(0, 3),
    evidence_quotes: sanitizeQuotes(lines.slice(0, 4)),
  });

  const dumpDetected = isTranscriptDumpSummary(result.summaryMarkdown ?? "", transcript);
  const summaryMarkdown =
    USE_STRUCTURED_SINGLE_PASS_SUMMARY || dumpDetected
      ? buildSinglePassStructuredSummary({
          timeline,
          nextActions: finalNextActions,
          profileDelta,
          transcript,
          minSummaryChars,
        })
      : buildSinglePassFallbackSummary(result.summaryMarkdown, transcript, minSummaryChars);

  const profileSections = normalizeProfileSections(result.profileSections ?? []);
  const profileSectionsFallback =
    profileSections.length > 0
      ? profileSections
      : buildProfileSectionsFromEvidence({
          profileDelta,
          timeline,
          transcript,
        });
  const recommendedTopics = normalizeRecommendedTopics(result.recommendedTopics ?? []);
  const recommendedTopicsFallback =
    recommendedTopics.length > 0
      ? recommendedTopics
      : buildRecommendedTopicsFallback({
          profileSections: profileSectionsFallback,
          nextActions: finalNextActions,
          timeline,
        });
  const quickQuestions = normalizeQuickQuestions(result.quickQuestions ?? []);
  const quickQuestionsFallback =
    quickQuestions.filter((item) => !hasBadUserFacingText([item.question, item.reason].join(" "))).length > 0
      ? normalizeQuickQuestions(
          quickQuestions.filter((item) => !hasBadUserFacingText([item.question, item.reason].join(" ")))
        )
      : buildQuickQuestionsFallback(recommendedTopicsFallback);
  const studentState = normalizeStudentState(result.studentState);
  const observationEvents = normalizeObservationEvents(result.observationEvents ?? []);
  const observationEventsFallback =
    observationEvents.length > 0
      ? observationEvents
      : buildObservationEventsFallback({
          transcript,
          profileSections: profileSectionsFallback,
          nextActions: finalNextActions,
          recommendedTopics: recommendedTopicsFallback,
          sessionType,
        });
  const entityCandidates = normalizeEntityCandidates(result.entityCandidates ?? []);
  const entityCandidatesFallback =
    entityCandidates.length > 0 ? entityCandidates : buildEntityCandidatesFallback(transcript);
  const lessonReport =
    normalizeLessonReport(result.lessonReport) ??
    buildLessonReportFallback({
      transcript,
      nextActions: finalNextActions,
      timeline,
      sessionType,
    });

  const baseResult: FinalizeResult = {
    summaryMarkdown,
    timeline,
    nextActions: finalNextActions,
    profileDelta,
    parentPack,
    studentState:
      studentState.oneLiner && studentState.rationale.length > 0
        ? studentState
        : buildStudentStateFallback({
            transcript,
            timeline,
            nextActions: finalNextActions,
            profileDelta,
          }),
    recommendedTopics: recommendedTopicsFallback,
    quickQuestions: quickQuestionsFallback,
    profileSections: profileSectionsFallback,
    entityCandidates: entityCandidatesFallback,
    observationEvents: observationEventsFallback,
    lessonReport,
  };

  const themes = extractTranscriptThemes(transcript, sessionType);
  if (themes.length >= 2 && shouldUseThemeFallback(baseResult as any, minTimelineSections)) {
    const themeTimeline = buildTimelineFromThemes(themes, minTimelineSections);
    const themeNextActions = buildNextActionsFromThemes(themes, sessionType);
    const themeProfileSections = buildProfileSectionsFromThemes(themes);
    const themeRecommendedTopics = buildRecommendedTopicsFromThemes(themes);
    const themeQuickQuestions = buildQuickQuestionsFromThemes(themes);
    const themeSummaryMarkdown = buildSummaryFromThemes(themes, themeNextActions, transcript, minSummaryChars);
    const themeStudentState =
      buildStudentStateFromThemes(themes, transcript) ??
      buildStudentStateFallback({
        transcript,
        timeline: themeTimeline,
        nextActions: themeNextActions,
        profileDelta,
      });
    const themeParentPack = buildParentPackFromThemes(themes, themeNextActions, transcript);
    const themeObservationEvents = buildObservationEventsFallback({
      transcript,
      profileSections: themeProfileSections,
      nextActions: themeNextActions,
      recommendedTopics: themeRecommendedTopics,
      sessionType,
    });
    const themeLessonReport =
      lessonReport ??
      buildLessonReportFallback({
        transcript,
        nextActions: themeNextActions,
        timeline: themeTimeline,
        sessionType,
      });

    return {
      ...baseResult,
      summaryMarkdown: themeSummaryMarkdown,
      timeline: themeTimeline,
      nextActions: themeNextActions,
      parentPack: themeParentPack,
      studentState: themeStudentState,
      recommendedTopics: themeRecommendedTopics,
      quickQuestions: themeQuickQuestions,
      profileSections: themeProfileSections,
      observationEvents: themeObservationEvents,
      lessonReport: themeLessonReport,
    };
  }

  return baseResult;
}

function buildSinglePassPrompt(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  minSummaryChars: number;
  minTimelineSections: number;
  sessionType?: "INTERVIEW" | "LESSON_REPORT";
  entityDictionary?: Array<{ kind: string; canonicalName: string; aliases?: string[] }>;
}) {
  const studentLabel = formatStudentLabel(input.studentName);
  const teacherLabel = formatTeacherLabel(input.teacherName);
  const sessionType = input.sessionType ?? "INTERVIEW";

  const system = `あなたは学習塾・個別指導の教務責任者です。
文字起こしから、会話ログ詳細と Student Room に必要な最終成果物を直接生成してください。
出力は厳密な JSON object のみ。

品質要件:
- ユーザー向け文はすべて日本語
- summaryMarkdown は ${input.minSummaryChars} 文字以上
- 見出しは必ず「## 会話で確認できた事実」「## 指導の要点（講師が伝えた核）」「## 次回までの方針」
- timeline は evidence がある限り ${input.minTimelineSections} セクション以上
- nextActions は具体的で、確認できる粒度にする
- profileDelta は confidence と evidence_quotes を含める
- parentPack は保護者が読んで分かる自然な日本語にする
- recommendedTopics / quickQuestions は次の会話でそのまま使えること
- 情報がないカテゴリを無理に埋めない
- 文字起こしの逐語ダンプは禁止
- 長い引用のコピペは禁止。要点に言い換える`;

  const user = `生徒: ${studentLabel}
講師: ${teacherLabel}
セッション種別: ${sessionType}
既知の固有名詞辞書: ${compactJson(input.entityDictionary ?? [])}

文字起こし:
${input.transcript}

出力 JSON:
{
  "summaryMarkdown": "...",
  "timeline": [
    {
      "title": "...",
      "what_happened": "...",
      "coach_point": "...",
      "student_state": "...",
      "evidence_quotes": ["..."]
    }
  ],
  "nextActions": [
    {
      "owner": "COACH|STUDENT|PARENT",
      "action": "...",
      "due": "YYYY-MM-DD or null",
      "metric": "...",
      "why": "..."
    }
  ],
  "profileDelta": {
    "basic": [
      { "field": "...", "value": "...", "confidence": 0-100, "evidence_quotes": ["..."] }
    ],
    "personal": [
      { "field": "...", "value": "...", "confidence": 0-100, "evidence_quotes": ["..."] }
    ]
  },
  "parentPack": {
    "what_we_did": ["..."],
    "what_improved": ["..."],
    "what_to_practice": ["..."],
    "risks_or_notes": ["..."],
    "next_time_plan": ["..."],
    "evidence_quotes": ["..."]
  },
  "studentState": {
    "label": "前進|集中|安定|不安|疲れ|詰まり|落ち込み|高揚",
    "oneLiner": "...",
    "rationale": ["..."],
    "confidence": 0-100
  },
  "recommendedTopics": [
    {
      "category": "学習|生活|学校|進路",
      "title": "...",
      "reason": "...",
      "question": "...",
      "priority": 1
    }
  ],
  "quickQuestions": [
    {
      "category": "学習|生活|学校|進路",
      "question": "...",
      "reason": "..."
    }
  ],
  "profileSections": [
    {
      "category": "学習|生活|学校|進路",
      "status": "改善|維持|落ちた|不明",
      "highlights": [
        { "label": "...", "value": "...", "isNew": true, "isUpdated": false }
      ],
      "nextQuestion": "..."
    }
  ],
  "entityCandidates": [
    {
      "kind": "SCHOOL|TARGET_SCHOOL|MATERIAL|EXAM|CRAM_SCHOOL|TEACHER|METRIC|OTHER",
      "rawValue": "...",
      "canonicalValue": "...",
      "confidence": 0-100,
      "status": "PENDING",
      "context": "..."
    }
  ],
  "observationEvents": [
    {
      "sourceType": "${sessionType}",
      "category": "学習|生活|学校|進路",
      "statusDraft": "改善|維持|落ちた|不明",
      "insights": ["..."],
      "topics": ["..."],
      "nextActions": ["..."],
      "evidence": ["..."],
      "characterSignal": "...",
      "weight": 1
    }
  ],
  "lessonReport": {
    "todayGoal": "...",
    "covered": ["..."],
    "blockers": ["..."],
    "homework": ["..."],
    "nextLessonFocus": ["..."],
    "parentShareDraft": "..."
  }
}

追加ルール:
- 英語は使わない
- 「情報が薄いので確認」などの埋め草は禁止
- timeline/title や topic/title は論点が分かる具体名にする
- quickQuestions は 30 秒以内で聞ける長さにする`;

  return { system, user };
}

async function repairSinglePassOutput(params: {
  transcript: string;
  result: FinalizeResult;
  issues: string[];
  studentName?: string;
  teacherName?: string;
  minSummaryChars: number;
  minTimelineSections: number;
  sessionType?: "INTERVIEW" | "LESSON_REPORT";
  entityDictionary?: Array<{ kind: string; canonicalName: string; aliases?: string[] }>;
}): Promise<FinalizeResult> {
  const { system } = buildSinglePassPrompt({
    transcript: params.transcript,
    studentName: params.studentName,
    teacherName: params.teacherName,
    minSummaryChars: params.minSummaryChars,
    minTimelineSections: params.minTimelineSections,
    sessionType: params.sessionType,
    entityDictionary: params.entityDictionary,
  });

  const repairUser = `現在の JSON:
${compactJson(params.result)}

文字起こし:
${params.transcript}

指摘事項をすべて解消して、JSON のみを再出力してください。
指摘: ${params.issues.join(" / ")}`;

  const { contentText, raw } = await callChatCompletions({
    model: getFinalModel(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: repairUser },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    timeoutMs: DEFAULT_LLM_TIMEOUT_MS * 2,
    max_completion_tokens: SINGLE_PASS_MAX_TOKENS,
  });

  const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
  const parsed = tryParseJson<FinalizeResult>(jsonText);
  if (!parsed) return params.result;
  return parsed;
}

export async function generateConversationArtifactsSinglePass(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  minSummaryChars: number;
  minTimelineSections?: number;
  sessionType?: "INTERVIEW" | "LESSON_REPORT";
  entityDictionary?: Array<{ kind: string; canonicalName: string; aliases?: string[] }>;
}): Promise<{ result: FinalizeResult; model: string; apiCalls: number; repaired: boolean }> {
  const minTimelineSections = input.minTimelineSections ?? 2;
  const model = getFinalModel();
  const { system, user } = buildSinglePassPrompt({
    transcript: input.transcript,
    studentName: input.studentName,
    teacherName: input.teacherName,
    minSummaryChars: input.minSummaryChars,
    minTimelineSections,
    sessionType: input.sessionType,
    entityDictionary: input.entityDictionary,
  });

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

  let apiCalls = 1;
  let repaired = false;

  const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
  const parsed = tryParseJson<FinalizeResult>(jsonText);
  if (!parsed) {
    throw new Error("SINGLE_PASS output JSON parse failed");
  }

  let result: FinalizeResult = {
    summaryMarkdown: parsed.summaryMarkdown ?? "",
    timeline: normalizeTimeline(parsed.timeline ?? []),
    nextActions: normalizeNextActions(parsed.nextActions ?? []),
    profileDelta: normalizeProfileDelta(parsed.profileDelta ?? { basic: [], personal: [] }),
    parentPack: normalizeParentPack(parsed.parentPack ?? {
      what_we_did: [],
      what_improved: [],
      what_to_practice: [],
      risks_or_notes: [],
      next_time_plan: [],
      evidence_quotes: [],
    }),
    studentState: normalizeStudentState(parsed.studentState),
    recommendedTopics: normalizeRecommendedTopics(parsed.recommendedTopics ?? []),
    quickQuestions: normalizeQuickQuestions(parsed.quickQuestions ?? []),
    profileSections: normalizeProfileSections(parsed.profileSections ?? []),
    entityCandidates: normalizeEntityCandidates(parsed.entityCandidates ?? []),
    observationEvents: normalizeObservationEvents(parsed.observationEvents ?? []),
    lessonReport: normalizeLessonReport(parsed.lessonReport),
  };

  result = applySinglePassHeuristicFallbacks(
    result,
    input.transcript,
    input.minSummaryChars,
    minTimelineSections,
    input.sessionType
  );

  let issues = validateFinalizeOutput(result, input.minSummaryChars, minTimelineSections);
  const severeIssue = issues.some((i) =>
    i === "summaryMarkdown_too_short" ||
    i === "profile_delta_missing" ||
    i === "parent_pack_missing" ||
    i === "student_state_missing" ||
    i === "recommended_topics_missing"
  );

  if (issues.length > 0 && ENABLE_FINALIZE_REPAIR && severeIssue) {
    const repairedOutput = await repairSinglePassOutput({
      transcript: input.transcript,
      result,
      issues,
      studentName: input.studentName,
      teacherName: input.teacherName,
      minSummaryChars: input.minSummaryChars,
      minTimelineSections,
      sessionType: input.sessionType,
      entityDictionary: input.entityDictionary,
    });
    apiCalls += 1;
    repaired = true;
    result = {
      summaryMarkdown: repairedOutput.summaryMarkdown ?? result.summaryMarkdown,
      timeline: normalizeTimeline(repairedOutput.timeline ?? result.timeline),
      nextActions: normalizeNextActions(repairedOutput.nextActions ?? result.nextActions),
      profileDelta: normalizeProfileDelta(repairedOutput.profileDelta ?? result.profileDelta),
      parentPack: normalizeParentPack(repairedOutput.parentPack ?? result.parentPack),
      studentState: normalizeStudentState(repairedOutput.studentState ?? result.studentState),
      recommendedTopics: normalizeRecommendedTopics(repairedOutput.recommendedTopics ?? result.recommendedTopics),
      quickQuestions: normalizeQuickQuestions(repairedOutput.quickQuestions ?? result.quickQuestions),
      profileSections: normalizeProfileSections(repairedOutput.profileSections ?? result.profileSections),
      entityCandidates: normalizeEntityCandidates(repairedOutput.entityCandidates ?? result.entityCandidates),
      observationEvents: normalizeObservationEvents(repairedOutput.observationEvents ?? result.observationEvents),
      lessonReport: normalizeLessonReport(repairedOutput.lessonReport ?? result.lessonReport),
    };

    result = applySinglePassHeuristicFallbacks(
      result,
      input.transcript,
      input.minSummaryChars,
      minTimelineSections,
      input.sessionType
    );
    issues = validateFinalizeOutput(result, input.minSummaryChars, minTimelineSections);
    if (issues.length > 0) repaired = false;
  }

  return { result, model, apiCalls, repaired };
}

export async function finalizeConversationArtifacts(input: {
  studentName?: string;
  teacherName?: string;
  reduced: ReducedAnalysis;
  minSummaryChars: number;
  minTimelineSections?: number;
  sessionType?: "INTERVIEW" | "LESSON_REPORT";
  entityDictionary?: Array<{ kind: string; canonicalName: string; aliases?: string[] }>;
}): Promise<{ result: FinalizeResult; model: string; apiCalls: number; repaired: boolean }> {
  const minTimelineSections = input.minTimelineSections ?? 3;
  const model = getFinalModel();
  const { system, user } = buildFinalizePrompt(input);
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

  let apiCalls = 1;
  let repaired = false;

  const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
  const parsed = tryParseJson<FinalizeResult>(jsonText);
  if (!parsed) {
    throw new Error("FINALIZE output JSON parse failed");
  }

  let result: FinalizeResult = {
    summaryMarkdown: parsed.summaryMarkdown ?? "",
    timeline: normalizeTimeline(parsed.timeline ?? []),
    nextActions: normalizeNextActions(parsed.nextActions ?? []),
    profileDelta: normalizeProfileDelta(parsed.profileDelta ?? { basic: [], personal: [] }),
    parentPack: normalizeParentPack(parsed.parentPack ?? {
      what_we_did: [],
      what_improved: [],
      what_to_practice: [],
      risks_or_notes: [],
      next_time_plan: [],
      evidence_quotes: [],
    }),
    studentState: normalizeStudentState(parsed.studentState),
    recommendedTopics: normalizeRecommendedTopics(parsed.recommendedTopics ?? []),
    quickQuestions: normalizeQuickQuestions(parsed.quickQuestions ?? []),
    profileSections: normalizeProfileSections(parsed.profileSections ?? []),
    entityCandidates: normalizeEntityCandidates(parsed.entityCandidates ?? []),
    observationEvents: normalizeObservationEvents(parsed.observationEvents ?? []),
    lessonReport: normalizeLessonReport(parsed.lessonReport),
  };

  result = applyFinalizeHeuristicFallbacks(
    result,
    input.reduced,
    input.minSummaryChars,
    minTimelineSections,
    input.sessionType
  );

  let issues = validateFinalizeOutput(result, input.minSummaryChars, minTimelineSections);
  const severeIssue = issues.some((i) =>
    i === "summaryMarkdown_too_short" ||
    i === "profile_delta_missing" ||
    i === "parent_pack_missing" ||
    i === "student_state_missing" ||
    i === "recommended_topics_missing"
  );

  if (issues.length > 0 && ENABLE_FINALIZE_REPAIR && severeIssue) {
    const repairedOutput = await repairFinalizeOutput({
      result,
      issues,
      studentName: input.studentName,
      teacherName: input.teacherName,
      reduced: input.reduced,
      minSummaryChars: input.minSummaryChars,
      minTimelineSections,
      sessionType: input.sessionType,
      entityDictionary: input.entityDictionary,
    });
    apiCalls += 1;
    repaired = true;

    result = {
      summaryMarkdown: repairedOutput.summaryMarkdown ?? result.summaryMarkdown,
      timeline: normalizeTimeline(repairedOutput.timeline ?? result.timeline),
      nextActions: normalizeNextActions(repairedOutput.nextActions ?? result.nextActions),
      profileDelta: normalizeProfileDelta(repairedOutput.profileDelta ?? result.profileDelta),
      parentPack: normalizeParentPack(repairedOutput.parentPack ?? result.parentPack),
      studentState: normalizeStudentState(repairedOutput.studentState ?? result.studentState),
      recommendedTopics: normalizeRecommendedTopics(repairedOutput.recommendedTopics ?? result.recommendedTopics),
      quickQuestions: normalizeQuickQuestions(repairedOutput.quickQuestions ?? result.quickQuestions),
      profileSections: normalizeProfileSections(repairedOutput.profileSections ?? result.profileSections),
      entityCandidates: normalizeEntityCandidates(repairedOutput.entityCandidates ?? result.entityCandidates),
      observationEvents: normalizeObservationEvents(repairedOutput.observationEvents ?? result.observationEvents),
      lessonReport: normalizeLessonReport(repairedOutput.lessonReport ?? result.lessonReport),
    };

    result = applyFinalizeHeuristicFallbacks(
      result,
      input.reduced,
      input.minSummaryChars,
      minTimelineSections,
      input.sessionType
    );
    issues = validateFinalizeOutput(result, input.minSummaryChars, minTimelineSections);
    if (issues.length > 0) {
      repaired = false;
    }
  }

  return { result, model, apiCalls, repaired };
}

export function getPromptVersion() {
  return PROMPT_VERSION;
}
