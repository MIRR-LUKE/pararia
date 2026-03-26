import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";

const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const MODEL_FAST = process.env.LLM_MODEL_FAST || process.env.LLM_MODEL || "gpt-5.4";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
      refusal?: string;
    };
    finish_reason?: string;
  }>;
};

type ChatResult = {
  raw: string;
  contentText: string | null;
  finishReason?: string;
  refusal?: string;
};

type TranscriptSpeaker = "teacher" | "student" | "unknown";

type DiarizedSegment = {
  index: number;
  start?: number;
  end?: number;
  text: string;
  sourceSpeaker?: string;
};

function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractChatCompletionContent(data: ChatCompletionResponse): {
  contentText: string | null;
  finishReason?: string;
  refusal?: string;
} {
  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason;
  const refusal = choice?.message?.refusal;
  const content = choice?.message?.content;

  if (typeof content === "string") {
    const trimmed = content.trim();
    return { contentText: trimmed || null, finishReason, refusal };
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : "";
        }
        return "";
      })
      .join("")
      .trim();
    return { contentText: joined || null, finishReason, refusal };
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
  max_completion_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
}): Promise<ChatResult> {
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY (or OPENAI_API_KEY) is not set. LLM is required.");
  }

  let body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    ...(params.max_completion_tokens ? { max_completion_tokens: params.max_completion_tokens } : {}),
    ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
    ...(params.response_format ? { response_format: params.response_format } : {}),
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      const raw = await response.text().catch(() => "");
      if (response.ok) {
        const data = tryParseJson<ChatCompletionResponse>(raw);
        if (!data) return { raw, contentText: null };
        return { raw, ...extractChatCompletionContent(data) };
      }

      const nextBody = { ...body };
      let changed = false;
      if ("temperature" in nextBody && /temperature/i.test(raw) && /default|unsupported|not supported/i.test(raw)) {
        delete nextBody.temperature;
        changed = true;
      }
      if ("response_format" in nextBody && /response_format/i.test(raw)) {
        delete nextBody.response_format;
        changed = true;
      }
      if (changed) {
        body = nextBody;
        continue;
      }

      if (attempt < 3 && isRetryableLlmStatus(response.status, raw)) {
        await waitForLlmRetry(attempt);
        continue;
      }

      throw new Error(`LLM API failed (${response.status}): ${raw}`);
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

function pickShortName(name?: string) {
  if (!name) return "";
  const cleaned = name.trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/[\s　]+/).filter(Boolean);
  if (parts.length > 1) return parts[0];
  if (!/[A-Za-z]/.test(cleaned) && cleaned.length >= 3) {
    return cleaned.slice(0, 2);
  }
  return cleaned;
}

function ensureSuffix(name: string, suffix: string) {
  if (!name) return "";
  if (/[様さん先生くん君]$/.test(name)) return name;
  return `${name}${suffix}`;
}

function formatStudentLabel(name?: string) {
  const base = pickShortName(name) || "生徒";
  return base === "生徒" ? base : ensureSuffix(base, "さん");
}

function formatTeacherLabel(name?: string) {
  const base = pickShortName(name || DEFAULT_TEACHER_FULL_NAME) || "講師";
  return base === "講師" ? base : ensureSuffix(base, "先生");
}

function heuristicSpeakerLabel(text: string): TranscriptSpeaker {
  const trimmed = text.trim();
  if (!trimmed) return "unknown";
  if (/(どう思う|できますか|できる|宿題|次回|確認しよう|やってみよう|見てみよう|だよね|でしょうか|ますか|だった\?|だった？|\?)$/.test(trimmed)) {
    return "teacher";
  }
  if (/^(はい|うん|そうです|そうですね|できました|わかりました|まだです|やりました)/.test(trimmed)) {
    return "student";
  }
  return "unknown";
}

function normalizeSourceSpeaker(value?: string | null) {
  const cleaned = String(value ?? "").trim().toLowerCase();
  if (!cleaned) return null;
  return cleaned;
}

function mapSourceSpeakers(segments: DiarizedSegment[]) {
  const keys = Array.from(
    new Set(segments.map((segment) => normalizeSourceSpeaker(segment.sourceSpeaker)).filter((key): key is string => Boolean(key)))
  );
  const mapping = new Map<string, TranscriptSpeaker>();
  if (keys.length === 0) return mapping;

  const scores = keys.map((key) => {
    const related = segments.filter((segment) => normalizeSourceSpeaker(segment.sourceSpeaker) === key);
    const teacherScore = related.reduce((sum, segment) => {
      const guess = heuristicSpeakerLabel(segment.text);
      if (guess === "teacher") return sum + 2;
      if (/[?？]$/.test(segment.text.trim())) return sum + 1;
      return sum;
    }, 0);
    const studentScore = related.reduce((sum, segment) => {
      const guess = heuristicSpeakerLabel(segment.text);
      if (guess === "student") return sum + 2;
      if (/^(はい|うん|そうです|まだです|できました)/.test(segment.text.trim())) return sum + 1;
      return sum;
    }, 0);
    return { key, teacherScore, studentScore };
  });

  const sorted = [...scores].sort((left, right) => {
    const teacherDiff = right.teacherScore - left.teacherScore;
    if (teacherDiff !== 0) return teacherDiff;
    return left.studentScore - right.studentScore;
  });

  if (sorted.length >= 1) {
    mapping.set(sorted[0].key, sorted[0].teacherScore >= sorted[0].studentScore ? "teacher" : "student");
  }
  if (sorted.length >= 2) {
    const first = mapping.get(sorted[0].key);
    mapping.set(sorted[1].key, first === "teacher" ? "student" : "teacher");
  }
  for (const score of sorted.slice(2)) {
    mapping.set(score.key, heuristicSpeakerLabel(segments.find((segment) => normalizeSourceSpeaker(segment.sourceSpeaker) === score.key)?.text ?? ""));
  }
  return mapping;
}

function joinConsecutiveSpeakerLines(
  segments: Array<{ speaker: TranscriptSpeaker; text: string }>,
  opts?: { studentName?: string; teacherName?: string }
) {
  const teacherLabel = formatTeacherLabel(opts?.teacherName);
  const studentLabel = formatStudentLabel(opts?.studentName);
  const lines: string[] = [];
  let currentSpeaker: TranscriptSpeaker | null = null;
  let buffer = "";

  const flush = () => {
    if (!currentSpeaker || !buffer.trim()) return;
    const label =
      currentSpeaker === "teacher" ? teacherLabel : currentSpeaker === "student" ? studentLabel : "話者不明";
    lines.push(`**${label}**: ${buffer.trim()}`);
  };

  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    if (segment.speaker === currentSpeaker) {
      buffer = `${buffer} ${text}`.trim();
      continue;
    }
    flush();
    currentSpeaker = segment.speaker;
    buffer = text;
  }
  flush();

  return lines.join("\n");
}

export async function normalizeTranscriptKanji(
  rawText: string,
  opts?: { studentName?: string; teacherName?: string }
): Promise<string> {
  const source = rawText?.trim();
  if (!source) return rawText;
  const studentLabel = formatStudentLabel(opts?.studentName);
  const teacherLabel = formatTeacherLabel(opts?.teacherName);
  const estimatedInputTokens = Math.ceil(source.length / 2);
  const maxCompletionTokens = Math.min(Math.max(estimatedInputTokens * 2, 1200), 12000);

  const system = `あなたは日本語の校正者です。
目的: 文字起こしテキストの漢字変換を正確にする。
禁止: 要約/省略/意味変更/話者入れ替え/勝手な補足。
必須: 改行・句読点・話者の区切りは維持する。
名称はそのまま維持（例: ${studentLabel}, ${teacherLabel}）。`;

  const user = `以下の本文を、意味を変えずに漢字変換だけ整えてください。
曖昧な箇所は無理に補完せず、そのまま残してください。

【本文】
${source}`.trim();

  const { contentText, raw } = await callChatCompletions({
    model: MODEL_FAST,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_completion_tokens: maxCompletionTokens,
    temperature: 0.2,
  });

  return contentText?.trim() || rawText;
}

export async function formatTranscriptFromSegments(
  segments: Array<{ start?: number; end?: number; text?: string; speaker?: string }>,
  opts?: { studentName?: string; teacherName?: string }
): Promise<string> {
  const sourceSegments: DiarizedSegment[] = segments
    .map((segment, index) => ({
      index,
      start: segment.start,
      end: segment.end,
      text: String(segment.text ?? "").trim(),
      sourceSpeaker: typeof segment.speaker === "string" ? segment.speaker : undefined,
    }))
    .filter((segment) => segment.text.length > 0);

  if (sourceSegments.length === 0) return "";

  const sourceSpeakerMap = mapSourceSpeakers(sourceSegments);
  const normalized = sourceSegments.map((segment) => {
    const sourceKey = normalizeSourceSpeaker(segment.sourceSpeaker);
    const mapped = sourceKey ? sourceSpeakerMap.get(sourceKey) : undefined;
    return {
      speaker: mapped ?? heuristicSpeakerLabel(segment.text),
      text: segment.text,
    };
  });

  return joinConsecutiveSpeakerLines(normalized, opts);
}

function parseInlineSpeakerLine(
  line: string,
  opts?: { studentName?: string; teacherName?: string }
): { speaker: TranscriptSpeaker; text: string } {
  const trimmed = line.trim();
  if (!trimmed) return { speaker: "unknown", text: "" };
  const teacherName = formatTeacherLabel(opts?.teacherName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const studentName = formatStudentLabel(opts?.studentName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const teacherPattern = new RegExp(`^(講師|先生|teacher|tutor|${teacherName})\\s*[:：]\\s*`, "i");
  const studentPattern = new RegExp(`^(生徒|student|learner|${studentName})\\s*[:：]\\s*`, "i");

  if (teacherPattern.test(trimmed)) {
    return {
      speaker: "teacher",
      text: trimmed.replace(teacherPattern, "").trim(),
    };
  }
  if (studentPattern.test(trimmed)) {
    return {
      speaker: "student",
      text: trimmed.replace(studentPattern, "").trim(),
    };
  }
  return {
    speaker: heuristicSpeakerLabel(trimmed),
    text: trimmed,
  };
}

export async function formatTranscriptFromText(
  rawText: string,
  opts?: { studentName?: string; teacherName?: string }
): Promise<string> {
  const source = String(rawText ?? "").trim();
  if (!source) return "";

  const parts = source
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => parseInlineSpeakerLine(line, opts))
    .filter((line) => line.text);

  if (parts.length === 0) return "";
  return joinConsecutiveSpeakerLines(parts, opts);
}
