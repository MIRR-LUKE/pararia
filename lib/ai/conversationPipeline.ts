import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";

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

const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const PROMPT_VERSION = "v4.0";
const DEFAULT_LLM_TIMEOUT_MS = clampInt(Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000), 10000, 180000);

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

function extractChatCompletionContent(data: ChatCompletionResponse) {
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") {
    return {
      contentText: content,
      finishReason: choice?.finish_reason,
      refusal: choice?.message?.refusal,
    };
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return typeof (item as { text?: unknown }).text === "string"
            ? (item as { text: string }).text
            : "";
        }
        return "";
      })
      .join("")
      .trim();
    return {
      contentText: joined || null,
      finishReason: choice?.finish_reason,
      refusal: choice?.message?.refusal,
    };
  }
  return {
    contentText: null,
    finishReason: choice?.finish_reason,
    refusal: choice?.message?.refusal,
  };
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
    ...(params.max_completion_tokens ? { max_completion_tokens: params.max_completion_tokens } : {}),
    ...(typeof params.temperature === "number" ? { temperature: params.temperature } : {}),
    ...(params.prompt_cache_key ? { prompt_cache_key: params.prompt_cache_key } : {}),
    ...(params.prompt_cache_retention ? { prompt_cache_retention: params.prompt_cache_retention } : {}),
  };

  const requestOnce = async (requestBody: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
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
        const retryBody = { ...body };
        let changed = false;
        if (typeof retryBody.temperature === "number" && /temperature/i.test(raw) && /default|unsupported|not supported/i.test(raw)) {
          delete retryBody.temperature;
          changed = true;
        }
        if (/(prompt_cache_key|prompt_cache_retention)/i.test(raw)) {
          delete retryBody.prompt_cache_key;
          delete retryBody.prompt_cache_retention;
          changed = true;
        }
        if (changed) {
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

function supportsExtendedPromptCaching(model: string) {
  return /^gpt-5(?:\.|$|-)/i.test(model) || /^gpt-4\.1(?:$|-)/i.test(model);
}

function buildPromptCacheKey(kind: string, sessionType?: SessionMode) {
  return ["conversation-pipeline", PROMPT_VERSION, kind, sessionType ?? "COMMON"].join(":");
}

function normalizeWhitespace(text: string) {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function transcriptLines(transcript: string) {
  return transcript
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => !/^##\s+/.test(line))
    .filter((line) => !/^授業前チェックイン$/.test(line))
    .filter((line) => !/^授業後チェックアウト$/.test(line));
}

function extractMarkdownSectionBody(markdown: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`##\\s+${escaped}\\n([\\s\\S]*?)(?=\\n##\\s+|$)`));
  return match?.[1]?.trim() ?? "";
}

function dedupeKeepOrder(lines: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = normalizeWhitespace(line);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function pickInterviewLines(transcript: string) {
  const lines = transcriptLines(transcript);
  const keywordLines = lines.filter((line) =>
    /学習|学校|生活|睡眠|宿題|部活|進路|志望|不安|課題|目標|復習|模試|受験|成績|提出|習慣/.test(line)
  );
  return dedupeKeepOrder([
    ...lines.slice(0, 10),
    ...keywordLines.slice(0, 14),
    ...lines.slice(-10),
  ]).slice(0, 28);
}

function pickLessonLines(transcript: string) {
  const checkIn = transcriptLines(extractMarkdownSectionBody(transcript, "授業前チェックイン")).slice(0, 12);
  const checkOut = transcriptLines(extractMarkdownSectionBody(transcript, "授業後チェックアウト")).slice(0, 14);
  const all = transcriptLines(transcript);
  const keywordLines = all.filter((line) => /宿題|授業|演習|理解|つまず|復習|次回|課題|単元|解説|確認/.test(line));
  return dedupeKeepOrder([
    ...checkIn,
    ...checkOut,
    ...keywordLines.slice(0, 16),
    ...all.slice(-8),
  ]).slice(0, 36);
}

function buildFastDraftEvidenceText(sessionType: SessionMode, transcript: string) {
  if (sessionType === "LESSON_REPORT") {
    const lines = pickLessonLines(transcript);
    return [
      "### 授業ログの重要発話",
      ...lines.map((line) => `- ${line}`),
    ].join("\n");
  }
  const lines = pickInterviewLines(transcript);
  return [
    "### 面談ログの重要発話",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}

function formatStudentLabel(studentName?: string | null) {
  const trimmed = String(studentName ?? "").trim();
  return trimmed || "未設定";
}

function formatTeacherLabel(teacherName?: string | null) {
  const trimmed = String(teacherName ?? "").trim();
  return trimmed || DEFAULT_TEACHER_FULL_NAME;
}

function formatSessionDateLabel(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildSummaryMarkdownSpec(isLesson: boolean) {
  if (isLesson) {
    return [
      "出力構成は必ず次の4セクションに固定すること:",
      "■ 基本情報",
      "■ 1. 本日の指導サマリー（室長向け要約）",
      "■ 2. 課題と指導成果（Before → After）",
      "■ 3. 学習方針と次回アクション（自学習の設計）",
      "■ 4. 室長・他講師への共有・連携事項",
    ];
  }
  return [
    "出力構成は必ず次の4セクションに固定すること:",
    "■ 基本情報",
    "■ 1. サマリー",
    "■ 2. ポジティブな話題",
    "■ 3. 改善・対策が必要な話題",
    "■ 4. 保護者への共有ポイント",
  ];
}

function cleanupSummaryMarkdown(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[#*-]+\s*/gm, "")
    .trim();
}

function isValidDraftMarkdown(markdown: string | null | undefined, sessionType: SessionMode, minChars: number) {
  const trimmed = cleanupSummaryMarkdown(String(markdown ?? ""));
  if (!trimmed.includes("■ 基本情報")) return false;
  if (sessionType === "LESSON_REPORT" && !trimmed.includes("■ 4. 室長・他講師への共有・連携事項")) return false;
  if (sessionType !== "LESSON_REPORT" && !trimmed.includes("■ 4. 保護者への共有ポイント")) return false;
  return trimmed.length >= Math.min(Math.max(minChars, 260), 1000);
}

function joinFallbackSentence(lines: string[], fallback: string) {
  const picked = dedupeKeepOrder(lines).slice(0, 4);
  return picked.length > 0 ? `${picked.join("。")}。` : fallback;
}

function buildInterviewDraftFallbackMarkdown(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
}) {
  const lines = pickInterviewLines(input.transcript);
  return cleanupSummaryMarkdown([
    "■ 基本情報",
    `対象生徒: ${formatStudentLabel(input.studentName)} 様`,
    `面談日: ${formatSessionDateLabel(input.sessionDate) || "未記録"}`,
    "面談時間: 未記録",
    `担当チューター: ${formatTeacherLabel(input.teacherName)}`,
    "面談目的: 学習状況の確認と次回方針の整理",
    "",
    "■ 1. サマリー",
    joinFallbackSentence(lines.slice(0, 8), "今回の面談で確認できた内容を整理した。"),
    "",
    "■ 2. ポジティブな話題",
    ...dedupeKeepOrder(lines.slice(0, 5)).map((line) => `- ${line}`),
    "",
    "■ 3. 改善・対策が必要な話題",
    ...dedupeKeepOrder(lines.slice(5, 10)).map((line) => `- ${line}`),
    "",
    "■ 4. 保護者への共有ポイント",
    joinFallbackSentence(lines.slice(10, 14), "次回までの実行状況と、止まった理由の確認が必要。"),
  ].join("\n"));
}

function buildLessonDraftFallbackMarkdown(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
}) {
  const lines = pickLessonLines(input.transcript);
  return cleanupSummaryMarkdown([
    "■ 基本情報",
    `対象生徒: ${formatStudentLabel(input.studentName)} 様`,
    `指導日: ${formatSessionDateLabel(input.sessionDate) || "未記録"}`,
    "教科・単元: 文字起こしから確認した内容を整理",
    `担当チューター: ${formatTeacherLabel(input.teacherName)}`,
    "",
    "■ 1. 本日の指導サマリー（室長向け要約）",
    joinFallbackSentence(lines.slice(0, 10), "本日の授業内容と生徒の反応を整理した。"),
    "",
    "■ 2. 課題と指導成果（Before → After）",
    ...dedupeKeepOrder(lines.slice(4, 12)).map((line) => `- ${line}`),
    "",
    "■ 3. 学習方針と次回アクション（自学習の設計）",
    ...dedupeKeepOrder(lines.slice(12, 18)).map((line) => `- ${line}`),
    "",
    "■ 4. 室長・他講師への共有・連携事項",
    joinFallbackSentence(lines.slice(18, 24), "次回授業では、今回止まった論点の再確認が必要。"),
  ].join("\n"));
}

export async function generateConversationDraftFast(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
  minSummaryChars: number;
  sessionType?: SessionMode;
}): Promise<{
  summaryMarkdown: string;
  model: string;
  apiCalls: number;
  evidenceChars: number;
  usedFallback: boolean;
  inputTokensEstimate: number;
}> {
  const sessionType = input.sessionType ?? "INTERVIEW";
  const evidenceText = buildFastDraftEvidenceText(sessionType, input.transcript);
  const model = getFastModel();
  const system = [
    "あなたは学習塾の教務責任者です。",
    sessionType === "LESSON_REPORT"
      ? "圧縮した授業記録から、管理者がそのまま使える指導報告ログ本文を markdown で完成させてください。"
      : "圧縮した面談記録から、管理者がそのまま使える面談ログ本文を markdown で完成させてください。",
    "出力は markdown 本文のみ。前置き・JSON・英語見出しは禁止。",
    "証拠にない内容は足さず、断定しすぎない。",
    "逐語録の貼り付けは禁止。ノイズと重複は捨てる。",
    "文末は基本的に『。』で閉じる。",
    ...buildSummaryMarkdownSpec(sessionType === "LESSON_REPORT"),
  ].join("\n");
  const user = [
    `生徒: ${formatStudentLabel(input.studentName)}`,
    `講師: ${formatTeacherLabel(input.teacherName)}`,
    `日付: ${formatSessionDateLabel(input.sessionDate) || "不明"}`,
    `最低文字数目安: ${input.minSummaryChars}`,
    "",
    "圧縮済み証拠:",
    evidenceText,
  ].join("\n");
  const promptInputTokensEstimate = estimateTokens(system) + estimateTokens(user);

  try {
    const { contentText, raw } = await callChatCompletions({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
      max_completion_tokens: sessionType === "LESSON_REPORT" ? 1700 : 1300,
      prompt_cache_key: buildPromptCacheKey("draft-fast", sessionType),
      prompt_cache_retention: supportsExtendedPromptCaching(model) ? "24h" : "in_memory",
    });
    const cleaned = cleanupSummaryMarkdown(contentText ?? raw);
    if (isValidDraftMarkdown(cleaned, sessionType, input.minSummaryChars)) {
      return {
        summaryMarkdown: cleaned,
        model,
        apiCalls: 1,
        evidenceChars: evidenceText.length,
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
    apiCalls: 1,
    evidenceChars: evidenceText.length,
    usedFallback: true,
    inputTokensEstimate: promptInputTokensEstimate,
  };
}

export function getPromptVersion() {
  return PROMPT_VERSION;
}
