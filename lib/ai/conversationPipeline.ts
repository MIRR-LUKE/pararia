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
const PROMPT_VERSION = "v0.3";

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
  temperature?: number;
  response_format?: { type: "json_object" };
}): Promise<ChatResult> {
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY (or OPENAI_API_KEY) is not set. LLM is required.");
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      ...(params.max_tokens ? { max_tokens: params.max_tokens } : {}),
      ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
      ...(params.response_format ? { response_format: params.response_format } : {}),
    }),
  });

  const raw = await res.text().catch(() => "");
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

function getFastModel() {
  return process.env.LLM_MODEL_FAST || process.env.LLM_MODEL || "gpt-5.2";
}

function getFinalModel() {
  return process.env.LLM_MODEL_FINAL || process.env.LLM_MODEL || "gpt-5.2";
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

export async function analyzeChunkBlocks(
  blocks: Array<{ index: number; text: string; hash: string }>,
  opts: { studentName?: string; teacherName?: string }
): Promise<{ analyses: ChunkAnalysis[]; model: string }> {
  const model = getFastModel();
  const studentLabel = formatStudentLabel(opts.studentName);
  const teacherLabel = formatTeacherLabel(opts.teacherName);

  const tasks = blocks.map(async (block) => {
    const system = `あなたは学習塾の教務です。会話チャンクを1回で分析し、構造化JSONを返します。
推測は禁止。引用は原文から20〜60文字。出力はJSONのみ。`;

    const user = `会話チャンク（${block.index + 1}）:
${block.text}

出力JSON:
{
  "facts": ["..."],
  "coaching_points": ["..."],
  "decisions": ["..."],
  "student_state_delta": ["..."],
  "todo_candidates": [
    {
      "owner": "COACH|STUDENT|PARENT",
      "action": "...",
      "due": "YYYY-MM-DD or 次回面談まで or null",
      "metric": "...",
      "why": "...",
      "evidence_quotes": ["..."]
    }
  ],
  "timeline_candidates": [
    {
      "title": "...",
      "what_happened": "...",
      "coach_point": "...",
      "student_state": "...",
      "evidence_quotes": ["..."]
    }
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

注意:
- facts は会話から確認できた事実のみ
- coaching_points は ${teacherLabel} の指導の核
- quotes は ${studentLabel}/${teacherLabel} の短い引用
- safety_flags は該当がない場合は空配列`;

    const { contentText, raw } = await callChatCompletions({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
    const parsed = tryParseJson<any>(jsonText) ?? {};
    const analysis: ChunkAnalysis = {
      index: block.index,
      hash: block.hash,
      facts: (parsed.facts ?? []).map((v: any) => String(v)),
      coaching_points: (parsed.coaching_points ?? []).map((v: any) => String(v)),
      decisions: (parsed.decisions ?? []).map((v: any) => String(v)),
      student_state_delta: (parsed.student_state_delta ?? []).map((v: any) => String(v)),
      todo_candidates: (parsed.todo_candidates ?? []).map((item: any) => ({
        owner: item?.owner ?? "STUDENT",
        action: String(item?.action ?? ""),
        due: item?.due ?? null,
        metric: String(item?.metric ?? ""),
        why: String(item?.why ?? ""),
        evidence_quotes: sanitizeQuotes((item?.evidence_quotes ?? []).map((v: any) => String(v))),
      })),
      timeline_candidates: (parsed.timeline_candidates ?? []).map((item: any) => ({
        title: String(item?.title ?? ""),
        what_happened: String(item?.what_happened ?? ""),
        coach_point: String(item?.coach_point ?? ""),
        student_state: String(item?.student_state ?? ""),
        evidence_quotes: sanitizeQuotes((item?.evidence_quotes ?? []).map((v: any) => String(v))),
      })),
      profile_delta_candidates: normalizeProfileDelta(parsed.profile_delta_candidates ?? { basic: [], personal: [] }),
      quotes: sanitizeQuotes((parsed.quotes ?? []).map((v: any) => String(v))),
      safety_flags: (parsed.safety_flags ?? []).map((v: any) => String(v)),
    };
    return analysis;
  });

  const analyses = await Promise.all(tasks);
  return { analyses, model };
}

export async function reduceChunkAnalyses(input: {
  analyses: ChunkAnalysis[];
  studentName?: string;
  teacherName?: string;
}): Promise<{ reduced: ReducedAnalysis; model: string }> {
  const model = getFastModel();
  const studentLabel = formatStudentLabel(input.studentName);
  const teacherLabel = formatTeacherLabel(input.teacherName);

  const system = `あなたは会話ログの統合担当です。以下のチャンク分析を重複排除し、整合性を保ちながら統合します。
創作は禁止。出力はJSONのみ。`;

  const user = `生徒: ${studentLabel}
講師: ${teacherLabel}

チャンク分析:
${JSON.stringify(
    input.analyses.map((a) => ({
      index: a.index,
      facts: a.facts,
      coaching_points: a.coaching_points,
      decisions: a.decisions,
      student_state_delta: a.student_state_delta,
      todo_candidates: a.todo_candidates,
      timeline_candidates: a.timeline_candidates,
      profile_delta_candidates: a.profile_delta_candidates,
      quotes: a.quotes,
      safety_flags: a.safety_flags,
    })),
    null,
    2
  )}

出力JSON:
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
}`;

  const { contentText, raw } = await callChatCompletions({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
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
  return { reduced, model };
}

function buildFinalizePrompt(input: {
  studentName?: string;
  teacherName?: string;
  reduced: ReducedAnalysis;
  minSummaryChars: number;
}): { system: string; user: string } {
  const studentLabel = formatStudentLabel(input.studentName);
  const teacherLabel = formatTeacherLabel(input.teacherName);

  const system = `あなたは学習塾の教務担当です。統合済み素材から会話ログの最終成果物を作成します。

【絶対ルール】
- 推測・断定を禁止（会話から確認できた事実のみ）
- Summaryは「ですます」調で自然に繋げる
- Summaryは短すぎ禁止（最低${input.minSummaryChars}文字）
- Timelineは最低3セクション、各セクションに引用2〜4本必須
- ToDoは owner/action/due/metric/why を必須
- ProfileDeltaは basic/personal に分け、confidenceと引用必須
- ParentPackは保護者向け素材として具体的に
- evidence_quotes は20〜60文字の短い引用

【出力JSON】
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
      "due": "YYYY-MM-DD or 次回面談まで or null",
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
}

SummaryMarkdownの見出しは必ず以下を使用:
## 会話で確認できた事実
## 指導の要点（講師が伝えた核）
## 次回までの方針`;

  const user = `生徒: ${studentLabel}
講師: ${teacherLabel}

統合素材:
${JSON.stringify(input.reduced, null, 2)}

上記を統合して、JSONのみ出力してください。`;
  return { system, user };
}

function validateFinalizeOutput(result: FinalizeResult, minSummaryChars: number) {
  const issues: string[] = [];
  if (!result.summaryMarkdown || result.summaryMarkdown.length < minSummaryChars) {
    issues.push("summaryMarkdownが短すぎます");
  }
  if ((result.timeline ?? []).length < 3) {
    issues.push("timelineのセクション数が不足しています");
  }
  if ((result.nextActions ?? []).length === 0) {
    issues.push("nextActionsが空です");
  }
  if (!result.profileDelta) {
    issues.push("profileDeltaが空です");
  }
  if (!result.parentPack) {
    issues.push("parentPackが空です");
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
}): Promise<FinalizeResult> {
  const { system } = buildFinalizePrompt({
    studentName: params.studentName,
    teacherName: params.teacherName,
    reduced: params.reduced,
    minSummaryChars: params.minSummaryChars,
  });

  const repairSystem = `${system}

以下のJSONは不足があります。指摘事項を解消して再出力してください。
指摘: ${params.issues.join(" / ")}`;

  const repairUser = `現在のJSON:
${JSON.stringify(params.result, null, 2)}

修正してJSONのみ出力してください。`;

  const { contentText, raw } = await callChatCompletions({
    model: getFinalModel(),
    messages: [
      { role: "system", content: repairSystem },
      { role: "user", content: repairUser },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
  const parsed = tryParseJson<FinalizeResult>(jsonText);
  if (!parsed) return params.result;
  return parsed;
}

export async function finalizeConversationArtifacts(input: {
  studentName?: string;
  teacherName?: string;
  reduced: ReducedAnalysis;
  minSummaryChars: number;
}): Promise<{ result: FinalizeResult; model: string }> {
  const { system, user } = buildFinalizePrompt(input);
  const { contentText, raw } = await callChatCompletions({
    model: getFinalModel(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

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

  const issues = validateFinalizeOutput(result, input.minSummaryChars);
  if (issues.length > 0) {
    const repaired = await repairFinalizeOutput({
      result,
      issues,
      studentName: input.studentName,
      teacherName: input.teacherName,
      reduced: input.reduced,
      minSummaryChars: input.minSummaryChars,
    });
    result = {
      summaryMarkdown: repaired.summaryMarkdown ?? result.summaryMarkdown,
      timeline: normalizeTimeline(repaired.timeline ?? result.timeline),
      nextActions: normalizeNextActions(repaired.nextActions ?? result.nextActions),
      profileDelta: normalizeProfileDelta(repaired.profileDelta ?? result.profileDelta),
      parentPack: normalizeParentPack(repaired.parentPack ?? result.parentPack),
    };
  }

  return { result, model: getFinalModel() };
}

export function getPromptVersion() {
  return PROMPT_VERSION;
}
