import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";

type SessionMode = "INTERVIEW" | "LESSON_REPORT";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: unknown; refusal?: string };
    finish_reason?: string;
  }>;
};

type ResponsesApiResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  incomplete_details?: {
    reason?: string;
  };
};

type ChatResult = {
  raw: string;
  contentText: string | null;
  finishReason?: string;
  refusal?: string;
};

const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const PROMPT_VERSION = "v4.1";
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

function extractResponsesContent(data: ResponsesApiResponse) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return {
      contentText: data.output_text.trim(),
      finishReason: data.incomplete_details?.reason,
      refusal: undefined,
    };
  }

  const message = Array.isArray(data.output)
    ? data.output.find((item) => item?.type === "message" && Array.isArray(item.content))
    : null;
  const contentText = message?.content
    ?.filter((item) => item?.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text?.trim() || "")
    .filter(Boolean)
    .join("\n")
    .trim();
  const refusal = message?.content?.find((item) => item?.type === "refusal")?.refusal;

  return {
    contentText: contentText || null,
    finishReason: data.incomplete_details?.reason,
    refusal,
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

function toResponsesPromptCacheRetention(retention?: "in_memory" | "24h") {
  if (retention === "24h") return "24h";
  if (retention === "in_memory") return "in-memory";
  return undefined;
}

async function callResponsesApi(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_output_tokens?: number;
  timeoutMs?: number;
  prompt_cache_key?: string;
  prompt_cache_retention?: "in_memory" | "24h";
  verbosity?: "low" | "medium" | "high";
}): Promise<ChatResult> {
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY (or OPENAI_API_KEY) is not set.");
  }

  const timeoutMs = Math.max(10000, params.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
  let body: Record<string, unknown> = {
    model: params.model,
    input: params.messages,
    store: false,
    reasoning: { effort: "none" },
    text: {
      format: { type: "text" },
      ...(params.verbosity ? { verbosity: params.verbosity } : {}),
    },
    ...(params.max_output_tokens ? { max_output_tokens: params.max_output_tokens } : {}),
    ...(params.prompt_cache_key ? { prompt_cache_key: params.prompt_cache_key } : {}),
    ...(toResponsesPromptCacheRetention(params.prompt_cache_retention)
      ? { prompt_cache_retention: toResponsesPromptCacheRetention(params.prompt_cache_retention) }
      : {}),
  };

  const requestOnce = async (requestBody: Record<string, unknown>) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
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
        if (/(prompt_cache_key|prompt_cache_retention)/i.test(raw)) {
          delete retryBody.prompt_cache_key;
          delete retryBody.prompt_cache_retention;
          changed = true;
        }
        if (/verbosity/i.test(raw)) {
          const nextText =
            retryBody.text && typeof retryBody.text === "object" && !Array.isArray(retryBody.text)
              ? { ...(retryBody.text as Record<string, unknown>) }
              : {};
          delete nextText.verbosity;
          retryBody.text = nextText;
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
        throw new Error(`Responses API failed (${res.status}): ${raw}`);
      }

      const data = tryParseJson<ResponsesApiResponse>(raw);
      if (!data) return { raw, contentText: null };
      return { raw, ...extractResponsesContent(data) };
    } catch (error) {
      if (attempt < 3 && isRetryableLlmError(error)) {
        await waitForLlmRetry(attempt);
        continue;
      }
      throw error;
    }
  }

  throw new Error("Responses API retry budget exceeded.");
}

async function callTextGeneration(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_output_tokens?: number;
  timeoutMs?: number;
  prompt_cache_key?: string;
  prompt_cache_retention?: "in_memory" | "24h";
  verbosity?: "low" | "medium" | "high";
}) {
  try {
    return await callResponsesApi(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (!/(Responses API failed|Responses API retry budget exceeded|404|400|unsupported|invalid)/i.test(message)) {
      throw error;
    }
    return callChatCompletions({
      model: params.model,
      messages: params.messages,
      timeoutMs: params.timeoutMs,
      max_completion_tokens: params.max_output_tokens,
      prompt_cache_key: params.prompt_cache_key,
      prompt_cache_retention: params.prompt_cache_retention,
    });
  }
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

const INTERVIEW_KEYWORD_RE =
  /学習|学校|生活|睡眠|宿題|部活|進路|志望|不安|課題|目標|復習|模試|受験|成績|提出|習慣|過去問|共通テスト|私大|数学|英語|国語|理科|社会|ベクトル|数列|微分|積分/;
const LESSON_KEYWORD_RE =
  /宿題|授業|演習|理解|つまず|復習|次回|課題|単元|解説|確認|極限|三角関数|ベクトル|数列|微分|積分|学校|講習|化学|英語|数学/;

function countJapaneseChars(text: string) {
  return (text.match(/[一-龯ぁ-んァ-ヶー]/g) ?? []).length;
}

function countAsciiLetters(text: string) {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

function isLikelyNoiseLine(line: string) {
  const normalized = normalizeWhitespace(line);
  if (!normalized) return true;
  if (/^(はい|ええ|うん|了解|わかりました|オッケー|OK|ないです|特にない|大丈夫|以上です|お疲れさま)[。！!？?]*$/i.test(normalized)) {
    return true;
  }
  const japaneseChars = countJapaneseChars(normalized);
  const asciiLetters = countAsciiLetters(normalized);
  if (asciiLetters >= 10 && japaneseChars < asciiLetters) return true;
  if (/^[\s,，、。.・!?？！-]+$/.test(normalized)) return true;
  if (japaneseChars < 5 && normalized.length < 10) return true;
  return false;
}

function scoreEvidenceLine(line: string, keywordRegex: RegExp) {
  const normalized = normalizeWhitespace(line);
  const keywordBoost = keywordRegex.test(normalized) ? 30 : 0;
  const japaneseScore = Math.min(countJapaneseChars(normalized), 60);
  const lengthScore = Math.min(normalized.length, 90);
  const asciiPenalty = countAsciiLetters(normalized) > 8 ? 16 : 0;
  const fillerPenalty = /^(はい|ええ|うん|そう|なるほど|たしかに)/.test(normalized) ? 18 : 0;
  return japaneseScore + lengthScore + keywordBoost - asciiPenalty - fillerPenalty;
}

function pickInformativeLines(lines: string[], keywordRegex: RegExp, limit: number) {
  return lines
    .map((line, index) => ({
      line,
      index,
      score: isLikelyNoiseLine(line) ? -999 : scoreEvidenceLine(line, keywordRegex),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.line);
}

function pickInterviewLines(transcript: string) {
  const lines = transcriptLines(transcript).filter((line) => !isLikelyNoiseLine(line));
  const keywordLines = lines.filter((line) => INTERVIEW_KEYWORD_RE.test(line));
  const informativeLines = pickInformativeLines(lines, INTERVIEW_KEYWORD_RE, 12);
  return dedupeKeepOrder([
    ...lines.slice(0, 10),
    ...keywordLines.slice(0, 14),
    ...informativeLines,
    ...lines.slice(-8),
  ]).slice(0, 32);
}

function pickLessonLines(transcript: string) {
  const checkIn = transcriptLines(extractMarkdownSectionBody(transcript, "授業前チェックイン"))
    .filter((line) => !isLikelyNoiseLine(line))
    .slice(0, 10);
  const checkOut = transcriptLines(extractMarkdownSectionBody(transcript, "授業後チェックアウト"))
    .filter((line) => !isLikelyNoiseLine(line))
    .slice(0, 12);
  const all = transcriptLines(transcript).filter((line) => !isLikelyNoiseLine(line));
  const keywordLines = all.filter((line) => LESSON_KEYWORD_RE.test(line));
  const informativeLines = pickInformativeLines(all, LESSON_KEYWORD_RE, 14);
  return dedupeKeepOrder([
    ...checkIn,
    ...checkOut,
    ...keywordLines.slice(0, 18),
    ...informativeLines,
    ...all.slice(-6),
  ]).slice(0, 42);
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

function buildDraftInputBlock(sessionType: SessionMode, transcript: string) {
  const normalizedTranscript = String(transcript ?? "").replace(/\r/g, "").trim();
  if (estimateTokens(normalizedTranscript) <= 3500) {
    return {
      label: "文字起こし全文",
      content: normalizedTranscript,
    };
  }
  return {
    label: "圧縮済み証拠",
    content: buildFastDraftEvidenceText(sessionType, normalizedTranscript),
  };
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
      "必ず次の4セクションに固定すること。",
      "■ 基本情報: 各項目を改行して1行ずつ書く。",
      "■ 1. 本日の指導サマリー（室長向け要約）: 2-3段落で、授業で扱った内容・理解状況・全体判断を具体的に書く。",
      "■ 2. 課題と指導成果（Before → After）: 2-3論点。各論点は `【論点名】` → `現状（Before）:` → `成果（After）:` → 必要なら `※特記事項:` の順で書く。",
      "■ 3. 学習方針と次回アクション（自学習の設計）: `生徒:` `次回までの宿題:` `次回の確認（テスト）事項:` を見出しとして入れ、それぞれ箇条書きで具体化する。",
      "■ 4. 室長・他講師への共有・連携事項: 2-4項目の箇条書き。",
      "授業前チェックイン / 授業後チェックアウト の逐語転写は禁止。",
      "ノイズ音声、言い淀み、壊れた固有名詞をそのまま出さない。",
      "抽象語だけで済ませず、理解したこと・残課題・次回確認事項を具体化する。",
    ];
  }
  return [
    "必ず次の4セクションに固定すること。",
    "■ 基本情報: 各項目を改行して1行ずつ書く。",
    "■ 1. サマリー: 2-4段落で、主論点・現状認識・講師の判断・今後の方向性を具体的に要約する。箇条書き禁止。",
    "■ 2. ポジティブな話題: 3-5項目の箇条書き。各項目は『良かった事実 → その意味』まで書く。",
    "■ 3. 改善・対策が必要な話題: 3-6項目の箇条書き。各項目は `現状の課題は ... -> 背景には ... -> 今後は ...` の流れで具体的に書く。",
    "■ 4. 保護者への共有ポイント: 2-4項目の箇条書き。安心材料と注意点を混ぜて書く。",
    "ノイズ音声、言い淀み、壊れた引用の貼り付けは禁止。",
    "抽象語だけで済ませず、単元名・受験方針・学習行動など具体語を残す。",
  ];
}

function buildDraftSystemPrompt(sessionType: SessionMode) {
  if (sessionType === "LESSON_REPORT") {
    return [
      "あなたは学習塾の教務責任者です。口語の授業 transcript を、管理者がそのまま使える正式な指導報告ログへ書き直してください。",
      "出力は markdown 本文のみ。逐語録の貼り付け、疑問文の転載、言い差し、相づち、話し言葉のままの引用を禁止します。",
      "必ず教務文体へ言い換え、扱った単元・理解状況・残課題・次回確認事項を具体語で残してください。",
      "短中尺の入力では全文を渡すことがあるが、出力では要点だけを整理すること。",
      ...buildSummaryMarkdownSpec(true),
    ].join("\n");
  }
  return [
    "あなたは学習塾の教務責任者です。口語の面談 transcript を、管理者がそのまま使える正式な面談ログへ書き直してください。",
    "出力は markdown 本文のみ。逐語録の貼り付け、疑問文の転載、言い差し、相づち、話し言葉のままの引用を禁止します。",
    "必ず教務文体へ言い換え、単元名・受験方針・学習行動など具体語を残してください。",
    ...buildSummaryMarkdownSpec(false),
  ].join("\n");
}

function cleanupSummaryMarkdown(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[•・*]\s+/gm, "- ")
    .trim();
}

function repairSummaryMarkdownFormatting(text: string) {
  return cleanupSummaryMarkdown(text)
    .replace(/\*\*(生徒:|次回までの宿題:|次回の確認（テスト）事項:)\*\*/g, "$1")
    .replace(/^\*\*\s*$/gm, "")
    .replace(/対象\s*\n\s*生徒:/g, "対象生徒:")
    .replace(/(■ 基本情報)\s*(対象生徒:)/, "$1\n$2")
    .replace(/([^\n])(面談日:|指導日:|面談時間:|教科・単元:|担当チューター:|面談目的:)/g, "$1\n$2")
    .replace(/([^\n])(■ \d+\.)/g, "$1\n$2")
    .replace(/([^\n])(【)/g, "$1\n$2")
    .replace(/([^\n])(現状（Before）:|成果（After）:|※特記事項:|生徒:|次回までの宿題:|次回の確認（テスト）事項:)/g, "$1\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isValidDraftMarkdown(markdown: string | null | undefined, sessionType: SessionMode, minChars: number) {
  const trimmed = repairSummaryMarkdownFormatting(String(markdown ?? ""));
  if (!trimmed.includes("■ 基本情報")) return false;
  if (sessionType === "LESSON_REPORT" && !trimmed.includes("■ 4. 室長・他講師への共有・連携事項")) return false;
  if (sessionType !== "LESSON_REPORT" && !trimmed.includes("■ 4. 保護者への共有ポイント")) return false;
  return trimmed.length >= Math.min(Math.max(minChars, 260), 1000);
}

function isWeakDraftMarkdown(markdown: string | null | undefined, sessionType: SessionMode, minChars: number) {
  const trimmed = repairSummaryMarkdownFormatting(String(markdown ?? ""));
  if (!isValidDraftMarkdown(trimmed, sessionType, minChars)) return true;
  if (/##\s*授業前チェックイン|##\s*授業後チェックアウト|録音始めた|何喋ろうか忘れちゃった|質問もありますか|以上です。お疲れ/.test(trimmed)) {
    return true;
  }
  if (sessionType === "LESSON_REPORT") {
    if ((trimmed.match(/現状（Before）:/g) ?? []).length < 2) return true;
    if ((trimmed.match(/成果（After）:/g) ?? []).length < 2) return true;
    if (!trimmed.includes("次回までの宿題:")) return true;
    if (!trimmed.includes("次回の確認（テスト）事項:")) return true;
    if (!trimmed.includes("【")) return true;
    return false;
  }
  if ((trimmed.match(/\n- /g) ?? []).length < 6) return true;
  if (/面談日:[^\n]+面談時間:/.test(trimmed)) return true;
  return false;
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
  const positiveLines = dedupeKeepOrder(lines.slice(0, 6)).slice(0, 4);
  const issueLines = dedupeKeepOrder(lines.slice(6, 12)).slice(0, 4);
  const parentLines = dedupeKeepOrder(lines.slice(12, 16)).slice(0, 3);
  return repairSummaryMarkdownFormatting([
    "■ 基本情報",
    `対象生徒: ${formatStudentLabel(input.studentName)} 様`,
    `面談日: ${formatSessionDateLabel(input.sessionDate) || "未記録"}`,
    "面談時間: 未記録",
    `担当チューター: ${formatTeacherLabel(input.teacherName)}`,
    "面談目的: 学習状況の確認と次回方針の整理",
    "",
    "■ 1. サマリー",
    joinFallbackSentence(lines.slice(0, 5), "今回の面談で確認できた内容を整理した。"),
    joinFallbackSentence(lines.slice(5, 10), "今後の学習方針と次回までの確認事項を整理した。"),
    "",
    "■ 2. ポジティブな話題",
    ...positiveLines.map((line) => `- ${line}。前向きな材料として継続確認したい。`),
    "",
    "■ 3. 改善・対策が必要な話題",
    ...issueLines.map((line) => `- 現状の課題は ${line}。背景には再現性や運用面の詰め不足があるため、次回までに対策を具体化する。`),
    "",
    "■ 4. 保護者への共有ポイント",
    ...parentLines.map((line) => `- ${line}。家庭では進め方と確認ポイントをセットで共有したい。`),
  ].join("\n"));
}

function buildLessonDraftFallbackMarkdown(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
}) {
  const lines = pickLessonLines(input.transcript);
  const checkInLines = transcriptLines(extractMarkdownSectionBody(input.transcript, "授業前チェックイン"))
    .filter((line) => !isLikelyNoiseLine(line))
    .slice(0, 6);
  const checkOutLines = transcriptLines(extractMarkdownSectionBody(input.transcript, "授業後チェックアウト"))
    .filter((line) => !isLikelyNoiseLine(line))
    .slice(0, 6);
  return repairSummaryMarkdownFormatting([
    "■ 基本情報",
    `対象生徒: ${formatStudentLabel(input.studentName)} 様`,
    `指導日: ${formatSessionDateLabel(input.sessionDate) || "未記録"}`,
    "教科・単元: 文字起こしから確認した内容を整理",
    `担当チューター: ${formatTeacherLabel(input.teacherName)}`,
    "",
    "■ 1. 本日の指導サマリー（室長向け要約）",
    joinFallbackSentence([...checkInLines.slice(0, 2), ...lines.slice(0, 2)], "本日の授業内容と生徒の反応を整理した。"),
    joinFallbackSentence([...checkOutLines.slice(0, 2), ...lines.slice(2, 4)], "理解状況と次回への接続を確認した。"),
    "",
    "■ 2. 課題と指導成果（Before → After）",
    "【授業前の理解状況】",
    `現状（Before）: ${joinFallbackSentence(checkInLines.slice(0, 3), "授業前の理解状況を確認した。")}`,
    `成果（After）: ${joinFallbackSentence(checkOutLines.slice(0, 3), "授業後に理解の手応えを確認した。")}`,
    "※特記事項: 次回も同論点の再現性を確認する。",
    "",
    "【授業中の主要論点】",
    `現状（Before）: ${joinFallbackSentence(lines.slice(3, 6), "授業中に重点確認が必要な論点があった。")}`,
    `成果（After）: ${joinFallbackSentence(lines.slice(6, 10), "授業内で考え方を整理し、次回へつながる状態にした。")}`,
    "※特記事項: 説明できる状態まで演習で固める必要がある。",
    "",
    "■ 3. 学習方針と次回アクション（自学習の設計）",
    "生徒:",
    ...dedupeKeepOrder(lines.slice(10, 13)).map((line) => `- ${line}`),
    "次回までの宿題:",
    ...dedupeKeepOrder(lines.slice(13, 16)).map((line) => `- ${line}`),
    "次回の確認（テスト）事項:",
    ...dedupeKeepOrder(lines.slice(16, 19)).map((line) => `- ${line}`),
    "",
    "■ 4. 室長・他講師への共有・連携事項",
    ...dedupeKeepOrder(lines.slice(19, 23)).map((line) => `- ${line}`),
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
  const draftInput = buildDraftInputBlock(sessionType, input.transcript);
  const model = getFastModel();
  const system = buildDraftSystemPrompt(sessionType);
  const user = [
    `生徒: ${formatStudentLabel(input.studentName)}`,
    `講師: ${formatTeacherLabel(input.teacherName)}`,
    `日付: ${formatSessionDateLabel(input.sessionDate) || "不明"}`,
    `最低文字数目安: ${input.minSummaryChars}`,
    "",
    `${draftInput.label}:`,
    draftInput.content,
  ].join("\n");
  const promptInputTokensEstimate = estimateTokens(system) + estimateTokens(user);

  let apiCalls = 0;
  try {
    apiCalls += 1;
    const { contentText, raw } = await callTextGeneration({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
      max_output_tokens: sessionType === "LESSON_REPORT" ? 2200 : 2400,
      prompt_cache_key: buildPromptCacheKey("draft-fast", sessionType),
      prompt_cache_retention: supportsExtendedPromptCaching(model) ? "24h" : "in_memory",
      verbosity: "medium",
    });
    const cleaned = repairSummaryMarkdownFormatting(contentText ?? raw);
    if (!isWeakDraftMarkdown(cleaned, sessionType, input.minSummaryChars)) {
      return {
        summaryMarkdown: cleaned,
        model,
        apiCalls,
        evidenceChars: draftInput.content.length,
        usedFallback: false,
        inputTokensEstimate: promptInputTokensEstimate,
      };
    }
  } catch {
    // chat-completions retry below
  }

  try {
    apiCalls += 1;
    const { contentText, raw } = await callTextGeneration({
      model,
      messages: [
        {
          role: "system",
          content: `${system}\n前回出力では要件を満たさなかったため、構造・具体性・改行を厳守して再生成してください。口語の引用や断片文を絶対に残さず、すべて教務文体へ言い換えてください。`,
        },
        { role: "user", content: user },
      ],
      timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
      max_output_tokens: sessionType === "LESSON_REPORT" ? 2400 : 2600,
      prompt_cache_key: buildPromptCacheKey("draft-fast-retry", sessionType),
      prompt_cache_retention: supportsExtendedPromptCaching(model) ? "24h" : "in_memory",
      verbosity: "high",
    });
    const cleaned = repairSummaryMarkdownFormatting(contentText ?? raw);
    if (!isWeakDraftMarkdown(cleaned, sessionType, input.minSummaryChars)) {
      return {
        summaryMarkdown: cleaned,
        model,
        apiCalls,
        evidenceChars: draftInput.content.length,
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
    apiCalls: Math.max(apiCalls, 1),
    evidenceChars: draftInput.content.length,
    usedFallback: true,
    inputTokensEstimate: promptInputTokensEstimate,
  };
}

export function getPromptVersion() {
  return PROMPT_VERSION;
}
