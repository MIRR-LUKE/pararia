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

const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const PROMPT_VERSION = "v0.4";

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

function forceGpt52Family(model: string) {
  const normalized = model.trim();
  if (!normalized) return "gpt-5.2";
  return normalized.includes("5.2") ? normalized : "gpt-5.2";
}

function getFastModel() {
  return forceGpt52Family(process.env.LLM_MODEL_FAST || process.env.LLM_MODEL || "gpt-5.2");
}

function getFinalModel() {
  return forceGpt52Family(process.env.LLM_MODEL_FINAL || process.env.LLM_MODEL || "gpt-5.2");
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
      }));
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
    (items ?? []).map((v) => String(v).trim()).filter(Boolean);
  return {
    what_we_did: normalizeList(pack.what_we_did),
    what_improved: normalizeList(pack.what_improved),
    what_to_practice: normalizeList(pack.what_to_practice),
    risks_or_notes: normalizeList(pack.risks_or_notes),
    next_time_plan: normalizeList(pack.next_time_plan),
    evidence_quotes: sanitizeQuotes(pack.evidence_quotes ?? []),
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
  const out: string[] = [text.trim()];
  let cursor = 0;
  while (out.join("\n").length < minChars && fillerLines.length > 0) {
    out.push(`- ${fillerLines[cursor % fillerLines.length]}`);
    cursor += 1;
    if (cursor > fillerLines.length * 4) break;
  }
  const built = out.join("\n").trim();
  if (built.length >= minChars) return built;
  return `${built}\n\n- Continue tracking evidence and convert it into measurable next actions.`;
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

  const singleSystem = `You are an academic coaching analyst. Analyze one conversation chunk and return only strict JSON.`;

  const analyzeSingle = async (block: ChunkBlockInput): Promise<ChunkAnalysis> => {
    const user = `Conversation chunk #${block.index + 1}
${block.text}

Output JSON:
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

Rules:
- facts: only observable facts from transcript
- coaching_points: key teaching points from ${teacherLabel}
- quotes: short direct quotes from ${studentLabel}/${teacherLabel}
- keep outputs concise: facts<=10, coaching_points<=8, decisions<=6, student_state_delta<=6
- keep candidates concise: todo_candidates<=5, timeline_candidates<=5, profile basic/personal<=6 each`; 

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
    const batchSystem = `複数チャンクを同時分析する。必ずJSON objectのみを返す。形式は {"analyses":[...]}。analyses は入力チャンク数と同数で、各要素に hash/index を含める。`;
    const batches = splitIntoBatches(uniqueBlocks, ANALYZE_BATCH_SIZE);

    const runBatch = async (batch: ChunkBlockInput[]) => {
      const batchUser = `Student: ${studentLabel}\nTeacher: ${teacherLabel}\n\nInput chunks:\n${compactJson(batch)}\n\nOutput JSON:\n{\n  "analyses": [\n    {\n      "hash": "input hash",\n      "index": 0,\n      "facts": ["..."],\n      "coaching_points": ["..."],\n      "decisions": ["..."],\n      "student_state_delta": ["..."],\n      "todo_candidates": [{ "owner": "COACH|STUDENT|PARENT", "action": "...", "due": "YYYY-MM-DD or null", "metric": "...", "why": "...", "evidence_quotes": ["..."] }],\n      "timeline_candidates": [{ "title": "...", "what_happened": "...", "coach_point": "...", "student_state": "...", "evidence_quotes": ["..."] }],\n      "profile_delta_candidates": { "basic": [], "personal": [] },\n      "quotes": ["..."],\n      "safety_flags": ["PII","SENSITIVE","AMBIGUOUS"]\n    }\n  ]\n}\nRules: keep each analysis concise (facts<=10, coaching_points<=8, decisions<=6, student_state_delta<=6, todo<=5, timeline<=5).`;
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

  const system = `You are an academic coaching analyst.
Merge multiple chunk analyses into one reduced analysis.
Return strict JSON only. Do not include markdown.`;

  const user = `Student: ${studentLabel}
Teacher: ${teacherLabel}

Chunk analyses:
${compactJson(compactAnalyses)}

Output JSON:
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

Rules:
- Deduplicate semantically similar items.
- Preserve actionable items and evidence.
- Keep lists concise and high-signal.`;

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
}): { system: string; user: string } {
  const studentLabel = formatStudentLabel(input.studentName);
  const teacherLabel = formatTeacherLabel(input.teacherName);
  const timelineTarget = input.minTimelineSections ?? 3;
  const reducedCompact = compactReducedForPrompt(input.reduced);

  const system = `You are an academic coaching analyst.
Use only the provided evidence to produce final coaching artifacts.
Return strict JSON only (no markdown outside summaryMarkdown).

Quality requirements:
- summaryMarkdown must be at least ${input.minSummaryChars} characters.
- timeline must include at least ${timelineTarget} sections when evidence allows.
- nextActions must include owner/action/metric and concrete why.
- profileDelta must include confidence and evidence quotes.
- parentPack should be parent-friendly and concrete.
- keep output concise but complete (timeline 2-4, nextActions 3-5, each parentPack list up to 4 items).`;

  const user = `Student: ${studentLabel}
Teacher: ${teacherLabel}

Reduced evidence JSON:
${compactJson(reducedCompact)}

Output JSON:
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
  }
}`;

  return { system, user };
}

function buildFallbackSummaryMarkdown(
  reduced: ReducedAnalysis,
  current: string,
  minSummaryChars: number
) {
  if (current && current.length >= minSummaryChars) return current;
  const facts = (reduced.facts ?? []).slice(0, 6);
  const points = (reduced.coaching_points ?? []).slice(0, 6);
  const decisions = (reduced.decisions ?? []).slice(0, 4);
  const lines: string[] = [
    "## Confirmed From Conversation",
    ...facts.map((v) => `- ${v}`),
    "",
    "## Coaching Focus",
    ...points.map((v) => `- ${v}`),
  ];
  if (decisions.length > 0) {
    lines.push("", "## Direction Until Next Session");
    lines.push(...decisions.map((v) => `- ${v}`));
  }
  const built = lines.join("\n").trim();
  const filler = [...facts, ...points, ...decisions, ...(reduced.student_state_delta ?? []), ...(reduced.quotes ?? [])]
    .map((v) => String(v).trim())
    .filter(Boolean);
  return ensureMinChars(
    `${built}\n\n## Notes\n- Continue validating progress and connect findings to next actions.`,
    minSummaryChars,
    filler.length ? filler : ["Use session evidence to refine the next study cycle."]
  );
}

function applyFinalizeHeuristicFallbacks(
  result: FinalizeResult,
  reduced: ReducedAnalysis,
  minSummaryChars: number,
  minTimelineSections: number
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
  const parentPack = normalizeParentPack(result.parentPack ?? {
    what_we_did: reduced.facts.slice(0, 3),
    what_improved: reduced.student_state_delta.slice(0, 3),
    what_to_practice: (reduced.todo_candidates ?? []).map((t) => t.action).slice(0, 3),
    risks_or_notes: reduced.safety_flags.slice(0, 3),
    next_time_plan: reduced.decisions.slice(0, 3),
    evidence_quotes: reduced.quotes.slice(0, 4),
  });

  return {
    summaryMarkdown: buildFallbackSummaryMarkdown(reduced, result.summaryMarkdown ?? "", minSummaryChars),
    timeline: normalizeTimeline(timeline),
    nextActions: normalizeNextActions(nextActions),
    profileDelta,
    parentPack,
  };
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
}): Promise<FinalizeResult> {
  const { system } = buildFinalizePrompt({
    studentName: params.studentName,
    teacherName: params.teacherName,
    reduced: params.reduced,
    minSummaryChars: params.minSummaryChars,
    minTimelineSections: params.minTimelineSections,
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
  return transcript
    .replace(/\r\n/g, "\n")
    .split(/\n+|(?<=[。！？.!?])\s*/g)
    .map((line) => maskSensitiveText(String(line).replace(/\s+/g, " ").trim()))
    .flatMap((line) => splitLongTextUnit(line, 120))
    .filter(Boolean);
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
    timeline.push({
      title: `Section ${i + 1}`,
      what_happened: slice.slice(0, 3).join(" / "),
      coach_point: "",
      student_state: "",
      evidence_quotes: sanitizeQuotes(slice.slice(0, 2)),
    });
  }
  while (timeline.length < target && timeline.length > 0) {
    const prev = timeline[timeline.length - 1];
    timeline.push({
      ...prev,
      title: `Section ${timeline.length + 1}`,
    });
  }
  return timeline;
}

function buildSinglePassFallbackSummary(
  current: string | undefined,
  transcript: string,
  minSummaryChars: number
) {
  if (current && current.length >= minSummaryChars) return current;
  const lines = transcriptLinesForFallback(transcript);
  const parts = [
    "## Session Summary",
    ...lines.slice(0, 8).map((line) => `- ${line}`),
    "",
    "## Next Focus",
    "- Connect today's evidence to concrete actions before the next session.",
  ];
  let built = parts.join("\n").trim();
  if (built.length < minSummaryChars) {
    const extra = lines.slice(8, 16).map((line) => `- ${line}`).join("\n");
    if (extra) built = `${built}\n${extra}`;
  }
  return ensureMinChars(
    `${built}\n\n## Notes\n- Continue monitoring progress with measurable outcomes.`,
    minSummaryChars,
    lines.length ? lines : ["Use transcript evidence to define concrete next actions."]
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
    .map((a) => `${a.owner}: ${a.action}（指標: ${a.metric}）`)
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
          "STUDENT: 面談内容を振り返り、次回までの実行タスクを完了する（指標: 実行ログを1件以上記録）",
          "COACH: 次回面談で進捗を確認し、改善点を具体化する（指標: 達成1点・課題1点を確認）",
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

function applySinglePassHeuristicFallbacks(
  result: FinalizeResult,
  transcript: string,
  minSummaryChars: number,
  minTimelineSections: number
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
  if (nextActions.length === 0) {
    nextActions.push({
      owner: "STUDENT",
      action: "Review this session's key points and complete one focused practice cycle.",
      due: null,
      metric: "Record one measurable practice outcome before the next session.",
      why: "Maintains momentum and turns feedback into concrete progress.",
    });
  }
  if (nextActions.length < 2) {
    nextActions.push({
      owner: "COACH",
      action: "Validate progress against the student's recorded outcome in the next session.",
      due: null,
      metric: "Confirm one achieved metric and one remaining gap.",
      why: "Keeps the plan measurable and closes the feedback loop.",
    });
  }

  const profileDelta = normalizeProfileDelta(result.profileDelta ?? { basic: [], personal: [] });
  const lines = transcriptLinesForFallback(transcript);
  const parentPack = normalizeParentPack(result.parentPack ?? {
    what_we_did: lines.slice(0, 3),
    what_improved: lines.slice(3, 6),
    what_to_practice: nextActions.map((a) => a.action).slice(0, 3),
    risks_or_notes: ["Track consistency and verify outcomes with evidence."],
    next_time_plan: nextActions.map((a) => a.metric).slice(0, 3),
    evidence_quotes: sanitizeQuotes(lines.slice(0, 4)),
  });

  const dumpDetected = isTranscriptDumpSummary(result.summaryMarkdown ?? "", transcript);
  const summaryMarkdown =
    USE_STRUCTURED_SINGLE_PASS_SUMMARY || dumpDetected
      ? buildSinglePassStructuredSummary({
          timeline,
          nextActions,
          profileDelta,
          transcript,
          minSummaryChars,
        })
      : buildSinglePassFallbackSummary(result.summaryMarkdown, transcript, minSummaryChars);

  return {
    summaryMarkdown,
    timeline,
    nextActions,
    profileDelta,
    parentPack,
  };
}

function buildSinglePassPrompt(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  minSummaryChars: number;
  minTimelineSections: number;
}) {
  const studentLabel = formatStudentLabel(input.studentName);
  const teacherLabel = formatTeacherLabel(input.teacherName);

  const system = `You are an academic coaching analyst.
Read the transcript and generate final coaching artifacts directly.
Return strict JSON only.

Quality requirements:
- summaryMarkdown must be at least ${input.minSummaryChars} characters.
- timeline must include at least ${input.minTimelineSections} sections when evidence allows.
- nextActions must be concrete and measurable.
- profileDelta must include confidence and evidence quotes.
- parentPack must be parent-friendly and concrete.
- keep output concise but complete (timeline 2-4, nextActions 3-5, each parentPack list up to 4 items).
- NEVER dump the transcript verbatim. Summarize and synthesize.
- Avoid long copied lines; keep each bullet line short and abstracted.`;

  const user = `Student: ${studentLabel}
Teacher: ${teacherLabel}

Transcript:
${input.transcript}

Output JSON:
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
  }
}`;

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
}): Promise<FinalizeResult> {
  const { system } = buildSinglePassPrompt({
    transcript: params.transcript,
    studentName: params.studentName,
    teacherName: params.teacherName,
    minSummaryChars: params.minSummaryChars,
    minTimelineSections: params.minTimelineSections,
  });

  const repairUser = `Current JSON:
${compactJson(params.result)}

Transcript:
${params.transcript}

Fix all issues and return JSON only.
Issues: ${params.issues.join(" / ")}`;

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
}): Promise<{ result: FinalizeResult; model: string; apiCalls: number; repaired: boolean }> {
  const minTimelineSections = input.minTimelineSections ?? 2;
  const model = getFinalModel();
  const { system, user } = buildSinglePassPrompt({
    transcript: input.transcript,
    studentName: input.studentName,
    teacherName: input.teacherName,
    minSummaryChars: input.minSummaryChars,
    minTimelineSections,
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
  };

  result = applySinglePassHeuristicFallbacks(
    result,
    input.transcript,
    input.minSummaryChars,
    minTimelineSections
  );

  let issues = validateFinalizeOutput(result, input.minSummaryChars, minTimelineSections);
  const severeIssue = issues.some((i) =>
    i === "summaryMarkdown_too_short" ||
    i === "profile_delta_missing" ||
    i === "parent_pack_missing"
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
    });
    apiCalls += 1;
    repaired = true;
    result = {
      summaryMarkdown: repairedOutput.summaryMarkdown ?? result.summaryMarkdown,
      timeline: normalizeTimeline(repairedOutput.timeline ?? result.timeline),
      nextActions: normalizeNextActions(repairedOutput.nextActions ?? result.nextActions),
      profileDelta: normalizeProfileDelta(repairedOutput.profileDelta ?? result.profileDelta),
      parentPack: normalizeParentPack(repairedOutput.parentPack ?? result.parentPack),
    };

    result = applySinglePassHeuristicFallbacks(
      result,
      input.transcript,
      input.minSummaryChars,
      minTimelineSections
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
  };

  result = applyFinalizeHeuristicFallbacks(
    result,
    input.reduced,
    input.minSummaryChars,
    minTimelineSections
  );

  let issues = validateFinalizeOutput(result, input.minSummaryChars, minTimelineSections);
  const severeIssue = issues.some((i) =>
    i === "summaryMarkdown_too_short" ||
    i === "profile_delta_missing" ||
    i === "parent_pack_missing"
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
    });
    apiCalls += 1;
    repaired = true;

    result = {
      summaryMarkdown: repairedOutput.summaryMarkdown ?? result.summaryMarkdown,
      timeline: normalizeTimeline(repairedOutput.timeline ?? result.timeline),
      nextActions: normalizeNextActions(repairedOutput.nextActions ?? result.nextActions),
      profileDelta: normalizeProfileDelta(repairedOutput.profileDelta ?? result.profileDelta),
      parentPack: normalizeParentPack(repairedOutput.parentPack ?? result.parentPack),
    };

    result = applyFinalizeHeuristicFallbacks(
      result,
      input.reduced,
      input.minSummaryChars,
      minTimelineSections
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
