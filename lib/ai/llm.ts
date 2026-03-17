import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";

// OPENAI_API_KEY を LLM_API_KEY としても使用可能にする
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const MODEL_FAST = process.env.LLM_MODEL_FAST || process.env.LLM_MODEL || "gpt-5-mini";
const MODEL_FINAL = process.env.LLM_MODEL_FINAL || process.env.LLM_MODEL || "gpt-5.4";
const MODEL_REPORT = process.env.LLM_MODEL_REPORT || process.env.LLM_MODEL_FINAL || process.env.LLM_MODEL || "gpt-5.4";

export type StructuredDeltaField = {
  value: string;
  detail?: string;
  confidence?: number;
  sourceLogId?: string;
  updatedAt?: string;
  category?: string;
};

export type StructuredDelta = {
  personal?: Record<string, StructuredDeltaField>;
  basics?: Record<string, StructuredDeltaField>;
};

export type TimeSection = {
  startMinute: number;
  endMinute: number;
  topic: string;
  description: string;
};

export type StructuredConversation = {
  summary: string;
  timeSections?: TimeSection[];
  keyQuotes: string[];
  keyTopics: string[];
  nextActions: string[];
  structuredDelta: StructuredDelta;
};

type OpenAIErrorResponse = {
  error?: {
    message?: string;
    type?: string;
    param?: string;
    code?: string;
  };
};

function tryParseOpenAIError(text: string): OpenAIErrorResponse | null {
  try {
    return JSON.parse(text) as OpenAIErrorResponse;
  } catch {
    return null;
  }
}

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
      refusal?: string;
    };
    finish_reason?: string;
  }>;
};

type DiarizedSegment = {
  index: number;
  start?: number;
  end?: number;
  text: string;
};

function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractJsonCandidate(text: string): string | null {
  // Try to salvage JSON when model returns extra text.
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

  // Some APIs may return content as an array of parts.
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

const EMOTION_KEYWORDS = [
  "感情",
  "気分",
  "情緒",
  "emotion",
  "mood",
  "ストレス",
  "不安",
  "焦り",
  "安心",
  "緊張",
  "落ち込み",
  "やる気",
  "モチベ",
];

const INTEREST_KEYWORDS = [
  "興味",
  "趣味",
  "関心",
  "interest",
  "hobby",
  "アニメ",
  "ゲーム",
  "恋愛",
  "音楽",
  "スポーツ",
  "推し",
  "ドラマ",
  "部活",
];

function includesKeyword(text: string, keywords: string[]) {
  const target = text.toLowerCase();
  return keywords.some((k) => target.includes(k.toLowerCase()));
}

function normalizePersonalDelta(
  personal: Record<string, StructuredDeltaField> | undefined,
  logId?: string
): Record<string, StructuredDeltaField> {
  const normalized: Record<string, StructuredDeltaField> = {};
  const bestByCategory: Record<"感情" | "興味関心", StructuredDeltaField | null> = {
    感情: null,
    興味関心: null,
  };

  const scoreOf = (field: StructuredDeltaField) => {
    const base = typeof field.confidence === "number" ? field.confidence : 0.6;
    const detailBonus = field.detail ? 0.08 : 0;
    const valueBonus = field.value?.length ? 0.04 : 0;
    return base + detailBonus + valueBonus;
  };

  Object.entries(personal ?? {}).forEach(([key, value]) => {
    if (!value || typeof value !== "object") return;
    const title = typeof value.value === "string" ? value.value.trim() : "";
    const detail = typeof value.detail === "string" ? value.detail.trim() : "";
    if (!title || !detail) return;
    const category = String(value.category ?? "");
    const isEmotion =
      includesKeyword(category, EMOTION_KEYWORDS) ||
      includesKeyword(key, EMOTION_KEYWORDS) ||
      includesKeyword(title, EMOTION_KEYWORDS);
    const isInterest =
      includesKeyword(category, INTEREST_KEYWORDS) ||
      includesKeyword(key, INTEREST_KEYWORDS) ||
      includesKeyword(title, INTEREST_KEYWORDS);

    let bucket: "感情" | "興味関心" | null = null;
    if (isEmotion && !isInterest) bucket = "感情";
    if (isInterest) bucket = "興味関心";
    if (!bucket) return;

    const candidate: StructuredDeltaField = {
      value: title,
      detail,
      confidence: value.confidence ?? 0.6,
      sourceLogId: value.sourceLogId ?? logId,
      category: bucket,
    };
    const current = bestByCategory[bucket];
    if (!current || scoreOf(candidate) > scoreOf(current)) {
      bestByCategory[bucket] = candidate;
    }
  });

  if (bestByCategory.感情) {
    normalized["今の感情"] = {
      ...bestByCategory.感情,
      sourceLogId: bestByCategory.感情.sourceLogId ?? logId,
    };
  }
  if (bestByCategory.興味関心) {
    normalized["興味関心"] = {
      ...bestByCategory.興味関心,
      sourceLogId: bestByCategory.興味関心.sourceLogId ?? logId,
    };
  }

  return normalized;
}

function normalizeStructuredDelta(delta: StructuredDelta | undefined, logId?: string): StructuredDelta {
  return {
    personal: normalizePersonalDelta(delta?.personal, logId),
    basics: {},
  };
}

function pickShortName(name?: string) {
  if (!name) return "";
  const cleaned = name.trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/[\s　]+/).filter(Boolean);
  if (parts.length > 1) return parts[0];
  const hasLatin = /[A-Za-z]/.test(cleaned);
  if (!hasLatin && cleaned.length >= 3) {
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

export async function structureConversation(
  transcript: string,
  opts?: { studentName?: string; teacherName?: string; logId?: string }
): Promise<StructuredConversation> {
  console.log("[structureConversation] Starting...", {
    transcriptLength: transcript.length,
    studentName: opts?.studentName,
    hasLLMKey: !!LLM_API_KEY,
  });

  // 品質を守るため、APIキーが無い場合はフォールバックせずエラーにする
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY (or OPENAI_API_KEY) is not set. LLM structuring is required for quality.");
  }

  const studentLabel = formatStudentLabel(opts?.studentName);
  const teacherLabel = formatTeacherLabel(opts?.teacherName);

  // OpenAI GPT APIを使用して構造化データを生成
  console.log("[structureConversation] Calling OpenAI GPT API for structuring...");
  
  try {
    // 会話の長さを推定（文字数から時間を推定）
    const transcriptLength = transcript.length;
    const estimatedMinutes = Math.max(5, Math.round(transcriptLength / 1000)); // 1分あたり約1000文字と仮定
    let summaryParagraphs = 6; // デフォルト
    
    if (estimatedMinutes <= 10) {
      summaryParagraphs = 6 + Math.floor((estimatedMinutes - 5) / 5) * 2; // 5-10分: 6-10段落
    } else if (estimatedMinutes <= 30) {
      summaryParagraphs = 10 + Math.floor((estimatedMinutes - 10) / 10) * 5; // 10-30分: 10-20段落
    } else {
      summaryParagraphs = 20 + Math.floor((estimatedMinutes - 30) / 30) * 10; // 30分以上: 20段落以上
    }
    
    // LLMレイテンシ対策:
    // - プロンプト自体を短くして入力トークンを削減（速度↑）
    // - ただし「情報を落とさない」制約は維持（品質維持）
    const systemPrompt = `あなたは教育現場の会話ログを「意思決定の資産」に編集する専門家。
禁止: 一般論/抽象語逃げ/議事録口調/時系列なぞり/感想文。summaryへ文字起こし貼付は禁止（生っぽさはkeyQuotesへ）。

【出力（JSONのみ）】必ず次のキーを全て返す:
- summary: 会話の要点を落とさず編集したサマリー（最低${summaryParagraphs}段落。1段落=2〜4文の“密度高い”文章。冗長な相槌は削るが重要情報は落とさない。**重要箇所は必ず複数箇所を太字**にする。）
- timeSections: 3〜8件（長い会話ほど多め）。各要素: {startMinute,endMinute,topic,description}。descriptionは2〜4文で具体に。
- keyQuotes: 6〜10件。「発言」→ なぜ重要か（1行）。口語維持。
- keyTopics: 3〜8件。抽象語禁止。
- nextActions: 3〜7件。具体行動のみ（1行）。
- structuredDelta: { personal?: {...}, basics?: {...} } 具体情報のみ。推測禁止。可能ならsourceLogIdも入れる。
  - personal は「今の感情」「興味関心」だけに限定する（他の項目は出さない）
  - category は必ず「感情」または「興味関心」
  - value は“ピックアップのタイトル”（具体性のある短文）
  - detail は「どの話題/発言が根拠か」を1〜2文で明確に説明
  - 曖昧な場合は personal を空にする（無理に作らない）

【重要】この会話は約${estimatedMinutes}分。短く書きすぎるのは失敗。要点を落とさず“密度を上げて書く”。
生徒名: ${studentLabel} / 講師名: ${teacherLabel}
本文中の主語は可能な限り「${studentLabel}」「${teacherLabel}」を使う。「生徒は」「講師は」の固定表現は避ける。`;

    // ユーザープロンプト
    const userPrompt = `以下の会話テキスト（音声から文字起こしされた生のテキスト）を分析してください。

**重要**: 
- 上記のsystemプロンプトの指示を厳密に遵守してください
- **ボリュームと解像度を最大化**してください（簡略化しすぎない）
- **重要な情報を見落とさない**ように、詳細に記述してください
- 会話のニュアンス、感情、語り口、文脈を保持してください
- 同じ内容の単純な繰り返しは削除しますが、**重要な情報はすべて含めてください**
 - summary は **要約** です。文字起こし本文を貼らないでください（口語の生っぽさは keyQuotes で担保）
- すべてのセクション（summary, timeSections, keyQuotes, keyTopics, nextActions, structuredDelta）を正確に生成してください

【会話テキスト】
${transcript}`;

    // 速度のため「無駄に長い文章」を抑えつつ、要点を落とさないための出力上限。
    // finish_reason=length が出た場合は既存ロジックで自動増量リトライする。
    const baseTokens = 3500;
    const tokensPerParagraph = 200;
    const estimatedTokens = Math.min(
      Math.max(baseTokens + summaryParagraphs * tokensPerParagraph, 6000),
      24000
    );
    
    // リクエスト開始時刻を記録（パフォーマンス測定用）
    const startTime = Date.now();
    
    async function callOnce(extraSystemAddendum?: string, maxTokensOverride?: number) {
      const sys = extraSystemAddendum
        ? `${systemPrompt}\n\n---\n【追加の最重要制約】\n${extraSystemAddendum}\n`
        : systemPrompt;

      const baseBody: Record<string, any> = {
        model: MODEL_FINAL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        // model は max_tokens を使用
        max_tokens: Math.round(maxTokensOverride ?? estimatedTokens),
        // JSON強制が安定
        response_format: { type: "json_object" },
        // 4oは温度指定OK。要約の一貫性を保ちつつ、表現は硬すぎない程度。
        temperature: 0.7,
      };

      async function doFetch(body: Record<string, any>) {
        return await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
          body: JSON.stringify(body),
        });
      }

      const res1 = await doFetch(baseBody);
      if (res1.ok) return res1;

      const t1 = await res1.text().catch(() => "");
      const err1 = tryParseOpenAIError(t1);
      const param = err1?.error?.param ?? "";
      const code = err1?.error?.code ?? "";
      const msg = err1?.error?.message ?? t1;

      // 想定される400を自動修正（同一モデルで1回だけ）
      // - response_format 未対応 → 外して再試行
      // - max_tokens 未対応 → 外して再試行（極稀）
      if (res1.status === 400 && (code === "unsupported_parameter" || code === "unsupported_value")) {
        const body2 = { ...baseBody };
        if (param === "response_format" || /response_format/i.test(msg)) {
          delete body2.response_format;
        }
        if (param === "max_tokens" || /max_tokens/i.test(msg)) {
          delete body2.max_tokens;
        }
        // 念のため外す
        delete body2.temperature;
        delete body2.top_p;
        delete body2.frequency_penalty;
        delete body2.presence_penalty;

        // body2 が baseBody と変わらないなら、そのまま返す（無限リトライ防止）
        const changed =
          ("response_format" in baseBody && !("response_format" in body2)) ||
          ("max_tokens" in baseBody && !("max_tokens" in body2));
        if (changed) {
          const res2 = await doFetch(body2);
          return res2;
        }
      }

      // それ以外は元のレスポンスを返す（呼び出し側でエラーハンドリング）
      // NOTE: 呼び出し側は res.ok を見て処理する
      return new Response(t1, { status: res1.status, statusText: res1.statusText });
    }

    const response = await callOnce();
    
    const elapsedTime = Date.now() - startTime;
    console.log("[structureConversation] LLM API call completed:", {
      elapsedTimeMs: elapsedTime,
      elapsedTimeSec: (elapsedTime / 1000).toFixed(2),
      estimatedTokens: Math.round(estimatedTokens),
      transcriptLength: transcriptLength,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("[structureConversation] OpenAI API error:", {
        status: response.status,
        error: errorText,
      });
      throw new Error(`LLM API failed (${response.status}): ${errorText}`);
    }

    async function parseCompletion(res: Response) {
      const raw = await res.text().catch(() => "");
      const data = tryParseJson<ChatCompletionResponse>(raw);
      return { raw, data };
    }

    let { raw, data } = await parseCompletion(response);
    if (!data) {
      console.error("[structureConversation] Unexpected non-JSON response:", raw.slice(0, 800));
      throw new Error("LLM API returned non-JSON response (unexpected).");
    }

    const { contentText, finishReason, refusal } = extractChatCompletionContent(data);
    if (!contentText) {
      console.error("[structureConversation] Empty content from LLM:", {
        finishReason,
        refusal,
        hasChoices: !!data.choices?.length,
        choice0Keys: data.choices?.[0] ? Object.keys(data.choices[0] as any) : [],
        message0Keys: data.choices?.[0]?.message ? Object.keys(data.choices[0].message as any) : [],
        rawPreview: raw.slice(0, 1200),
      });
      // length で空になる場合は、出力上限が足りないので1回だけ増やして再試行
      if (finishReason === "length") {
        const bumped = Math.min(Math.round((estimatedTokens ?? 6000) * 1.6), 16000);
        console.warn("[structureConversation] finish_reason=length with empty content; retrying once with higher max_tokens", {
          estimatedTokens: Math.round(estimatedTokens),
          bumped,
        });
        const retry = await callOnce(undefined, bumped);
        if (!retry.ok) {
          const errText = await retry.text().catch(() => "");
          throw new Error(`LLM retry (length) failed (${retry.status}): ${errText}`);
        }
        ({ raw, data } = await parseCompletion(retry));
        if (!data) {
          console.error("[structureConversation] Retry(length) non-JSON response:", raw.slice(0, 800));
          throw new Error("LLM retry (length) returned non-JSON response.");
        }
        const extracted2 = extractChatCompletionContent(data);
        if (!extracted2.contentText) {
          const reason2 = extracted2.finishReason
            ? `finish_reason=${extracted2.finishReason}`
            : "finish_reason=(unknown)";
          const ref2 = extracted2.refusal ? ` refusal=${extracted2.refusal}` : "";
          throw new Error(`LLM API returned empty content after retry (${reason2}).${ref2}`);
        }
        // overwrite for downstream
        (data as any).__extractedContentText = extracted2.contentText;
      } else {
        const reason = finishReason ? `finish_reason=${finishReason}` : "finish_reason=(unknown)";
        const ref = refusal ? ` refusal=${refusal}` : "";
        throw new Error(`LLM API returned empty content (${reason}).${ref} (see server logs for rawPreview)`);
      }
    }

    const contentForParse =
      (data as any).__extractedContentText
        ? String((data as any).__extractedContentText)
        : String(contentText ?? "");
    const parsedJsonText = contentForParse.trim();
    const parsedObj =
      tryParseJson<any>(parsedJsonText) ??
      (extractJsonCandidate(parsedJsonText) ? tryParseJson<any>(extractJsonCandidate(parsedJsonText)!) : null);
    if (!parsedObj) {
      console.error("[structureConversation] Content was not JSON:", parsedJsonText.slice(0, 800));
      // length でJSONが途切れた可能性もあるので、finish_reason=lengthなら1回だけ増やして再試行
      const fr = extractChatCompletionContent(data).finishReason;
      if (fr === "length") {
        const bumped = Math.min(Math.round((estimatedTokens ?? 6000) * 1.6), 16000);
        console.warn("[structureConversation] finish_reason=length with non-JSON content; retrying once with higher max_tokens", {
          estimatedTokens: Math.round(estimatedTokens),
          bumped,
        });
        const retry = await callOnce("出力が途中で途切れないよう、必ず最後の } まで完全なJSONを返すこと。", bumped);
        if (!retry.ok) {
          const errText = await retry.text().catch(() => "");
          throw new Error(`LLM retry (length-json) failed (${retry.status}): ${errText}`);
        }
        const retryRaw = await retry.text().catch(() => "");
        const retryData = tryParseJson<ChatCompletionResponse>(retryRaw);
        if (!retryData) {
          console.error("[structureConversation] Retry(length-json) non-JSON response:", retryRaw.slice(0, 800));
          throw new Error("LLM retry (length-json) returned non-JSON response.");
        }
        const extracted = extractChatCompletionContent(retryData);
        const txt = (extracted.contentText ?? "").trim();
        const obj =
          tryParseJson<any>(txt) ?? (extractJsonCandidate(txt) ? tryParseJson<any>(extractJsonCandidate(txt)!) : null);
        if (!obj) {
          throw new Error("LLM returned non-JSON content even after length retry.");
        }
        // continue with obj
        const parsed = obj as {
          summary?: string;
          timeSections?: TimeSection[];
          keyQuotes?: string[];
          keyTopics?: string[];
          nextActions?: string[];
          structuredDelta?: StructuredDelta;
        };
        const summaryText = (parsed.summary ?? "").trim();
        if (!summaryText) {
          throw new Error("LLM returned empty summary");
        }
        const structured: StructuredConversation = {
          summary: summaryText,
          timeSections: parsed.timeSections || [],
          keyQuotes: parsed.keyQuotes || [],
          keyTopics: parsed.keyTopics || [],
          nextActions: parsed.nextActions || [],
          structuredDelta: parsed.structuredDelta || { personal: {}, basics: {} },
        };
        // proceed to guards below by jumping (return early into existing flow would be messy)
        // Apply sourceLogId mapping and summary guardrails by reusing existing code paths:
        structured.structuredDelta = normalizeStructuredDelta(structured.structuredDelta, opts?.logId);
        console.log("[structureConversation] LLM structure generated (after length-json retry):", {
          summaryLength: structured.summary.length,
          timeSectionsCount: structured.timeSections?.length ?? 0,
          keyQuotesCount: structured.keyQuotes.length,
          keyTopicsCount: structured.keyTopics.length,
          nextActionsCount: structured.nextActions.length,
          personalFields: Object.keys(structured.structuredDelta.personal || {}).length,
        });
        return structured;
      }
      throw new Error("LLM returned non-JSON content. Prompt/response_format may be unsupported.");
    }

    const parsed = parsedObj as {
      summary?: string;
      timeSections?: TimeSection[];
      keyQuotes?: string[];
      keyTopics?: string[];
      nextActions?: string[];
      structuredDelta?: StructuredDelta;
    };

    const summaryText = (parsed.summary ?? "").trim();
    if (!summaryText) {
      throw new Error("LLM returned empty summary");
    }

    const structured: StructuredConversation = {
      summary: summaryText,
      timeSections: parsed.timeSections || [],
      keyQuotes: parsed.keyQuotes || [],
      keyTopics: parsed.keyTopics || [],
      nextActions: parsed.nextActions || [],
      structuredDelta: parsed.structuredDelta || { personal: {}, basics: {} },
    };

    // --- Summary quality guardrails (single retry with gpt-5) ---
    function normalizeJP(s: string) {
      return (s ?? "").replace(/\s+/g, "").trim();
    }
    function shingleSet(text: string, size = 24, step = 12, cap = 2500) {
      const t = normalizeJP(text);
      const set = new Set<string>();
      if (t.length < size) return set;
      for (let i = 0; i + size <= t.length && set.size < cap; i += step) {
        set.add(t.slice(i, i + size));
      }
      return set;
    }
    function overlapRatio(summaryText0: string, transcriptText: string) {
      const sum = normalizeJP(summaryText0);
      const tr = normalizeJP(transcriptText);
      if (!sum || !tr) return 0;
      const trSet = shingleSet(tr, 24, 12, 3000);
      if (trSet.size === 0) return 0;
      let hits = 0;
      let total = 0;
      const size = 24;
      const step = 12;
      for (let i = 0; i + size <= sum.length && total < 800; i += step) {
        total++;
        if (trSet.has(sum.slice(i, i + size))) hits++;
      }
      if (total === 0) return 0;
      return hits / total;
    }
    function isBadSummary(summaryText0: string, transcriptText: string) {
      const s = normalizeJP(summaryText0);
      const t = normalizeJP(transcriptText);
      if (!s) return true;
      // too long => likely transcript dump
      if (t && s.length > t.length * 0.75) return true;
      // too much verbatim overlap
      const r = overlapRatio(summaryText0, transcriptText);
      if (r > 0.33) return true;
      // needs paragraphing for readability
      const paraCount = summaryText0.split(/\n{2,}/).filter(Boolean).length;
      if (paraCount < Math.min(3, summaryParagraphs)) return true;
      return false;
    }

    if (isBadSummary(structured.summary, transcript)) {
      console.warn("[structureConversation] Bad summary detected; retrying once with stricter constraints", {
        summaryLen: structured.summary.length,
        transcriptLen: transcriptLength,
        overlap: overlapRatio(structured.summary, transcript),
      });

      const retryResponse = await callOnce(
        [
          "summaryは必ず要約する（文字起こし本文を貼らない）",
          "summaryに長い口語の連続（相槌・口癖・同語反復）を残さない",
          "要点は落とさず、段落ごとに『分かったこと→判断→合意/次の一手』で編集する",
          "口語の生っぽさは keyQuotes に寄せる（summaryは読みやすい文章）",
        ].join("\n")
      );

      if (!retryResponse.ok) {
        const errText = await retryResponse.text().catch(() => "");
        throw new Error(`LLM retry failed (${retryResponse.status}): ${errText}`);
      }

      const retryRaw = await retryResponse.text().catch(() => "");
      const retryData = tryParseJson<ChatCompletionResponse>(retryRaw);
      if (!retryData) {
        console.error("[structureConversation] Retry returned non-JSON response:", retryRaw.slice(0, 800));
        throw new Error("LLM retry returned non-JSON response.");
      }
      const retryExtracted = extractChatCompletionContent(retryData);
      if (!retryExtracted.contentText) {
        throw new Error(
          `LLM retry returned empty content (finish_reason=${retryExtracted.finishReason ?? "(unknown)"}).`
        );
      }
      const retryParsedObj =
        tryParseJson<any>(retryExtracted.contentText) ??
        (extractJsonCandidate(retryExtracted.contentText)
          ? tryParseJson<any>(extractJsonCandidate(retryExtracted.contentText)!)
          : null) ??
        {};
      const retryParsed = retryParsedObj as any;

      const retriedSummary = String(retryParsed.summary ?? "").trim();
      if (!retriedSummary) {
        throw new Error("LLM retry returned empty summary");
      }

      if (isBadSummary(retriedSummary, transcript)) {
        // gpt-4o運用では「止めない」を優先。最良の再試行結果を採用して継続。
        console.warn("[structureConversation] Summary still transcript-like after retry; continuing with best effort (no abort).");
      }

      structured.summary = retriedSummary;
      structured.timeSections = retryParsed.timeSections || structured.timeSections || [];
      structured.keyQuotes = retryParsed.keyQuotes || structured.keyQuotes || [];
      structured.keyTopics = retryParsed.keyTopics || structured.keyTopics || [];
      structured.nextActions = retryParsed.nextActions || structured.nextActions || [];
      structured.structuredDelta = retryParsed.structuredDelta || structured.structuredDelta || { personal: {}, basics: {} };
    }

    structured.structuredDelta = normalizeStructuredDelta(structured.structuredDelta, opts?.logId);

    console.log("[structureConversation] LLM structure generated:", {
      summaryLength: structured.summary.length,
      timeSectionsCount: structured.timeSections?.length ?? 0,
      keyQuotesCount: structured.keyQuotes.length,
      keyTopicsCount: structured.keyTopics.length,
      nextActionsCount: structured.nextActions.length,
      personalFields: Object.keys(structured.structuredDelta.personal || {}).length,
    });
    
    if (structured.timeSections && structured.timeSections.length > 0) {
      console.log("[structureConversation] Time sections preview:", 
        structured.timeSections.slice(0, 2).map(s => `${s.startMinute}-${s.endMinute}分: ${s.topic}`)
      );
    }

    return structured;
  } catch (error: any) {
    console.error("[structureConversation] LLM API failed:", {
      error: error?.message,
      stack: error?.stack,
    });
    // 品質を守るためフォールバックしない
    throw error;
  }
}

// -----------------------------
// v0.2 爆速パイプライン: Job A / Job B
// -----------------------------

type TimelineItem = {
  topic: string;
  summary: string;
};

type ExtractOnlyResult = {
  title?: string;
  timeline?: TimelineItem[];
  nextActions?: string[];
  structuredDelta?: StructuredDelta;
};

async function callChatCompletions(params: {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
}): Promise<{ raw: string; data: ChatCompletionResponse | null; contentText: string | null; finishReason?: string; refusal?: string }> {
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY (or OPENAI_API_KEY) is not set. LLM is required.");
  }

  let body: Record<string, unknown> = {
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

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text().catch(() => "");
    if (res.ok) {
      const data = tryParseJson<ChatCompletionResponse>(raw);
      if (!data) return { raw, data: null, contentText: null };
      const extracted = extractChatCompletionContent(data);
      return { raw, data, ...extracted };
    }

    const lower = raw.toLowerCase();
    let changed = false;
    const nextBody = { ...body };

    if ("temperature" in nextBody && /temperature/.test(lower) && /default|unsupported|not supported/.test(lower)) {
      delete nextBody.temperature;
      changed = true;
    }

    if ("response_format" in nextBody && /response_format/.test(lower)) {
      delete nextBody.response_format;
      changed = true;
    }

    if ("max_completion_tokens" in nextBody && /max_completion_tokens/.test(lower)) {
      nextBody.max_tokens = nextBody.max_completion_tokens;
      delete nextBody.max_completion_tokens;
      changed = true;
    } else if ("max_tokens" in nextBody && /max_tokens/.test(lower) && !/max_completion_tokens/.test(lower)) {
      nextBody.max_completion_tokens = nextBody.max_tokens;
      delete nextBody.max_tokens;
      changed = true;
    }

    if (!changed) {
      throw new Error(`LLM API failed (${res.status}): ${raw}`);
    }

    body = nextBody;
  }

  throw new Error("LLM API retry budget exceeded.");
}

export async function normalizeTranscriptKanji(
  rawText: string,
  opts?: { studentName?: string; teacherName?: string }
): Promise<string> {
  const studentLabel = formatStudentLabel(opts?.studentName);
  const teacherLabel = formatTeacherLabel(opts?.teacherName);
  const source = rawText?.trim();
  if (!source) return rawText;

  const estimatedInputTokens = Math.ceil(source.length / 2);
  const maxTokens = Math.min(Math.max(estimatedInputTokens * 2, 4000), 20000);

  const system = `あなたは日本語の校正者です。
目的: 文字起こしテキストの漢字変換を正確にする（かな→漢字変換の改善）。
禁止: 要約/省略/言い換え/意味変更/勝手な補足。
必須: 改行・句読点・話者の区切りは維持。出力は本文のみ。
固有名詞はそのまま維持（例: ${studentLabel}, ${teacherLabel}）。`;

  const user = `以下のテキストを、意味は変えずに漢字変換だけ高精度に整えてください。
曖昧で自信がない箇所はそのまま残すこと。

【本文】
${source}`.trim();

  const { contentText, finishReason, refusal, raw } = await callChatCompletions({
    model: MODEL_FAST,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0.2,
  });

  if (!contentText) {
    console.error("[normalizeTranscriptKanji] Empty content:", {
      finishReason,
      refusal,
      rawPreview: raw.slice(0, 1200),
    });
    return rawText;
  }

  return contentText.trim();
}

/**
 * Generate summary for a single chunk (used in parallel processing)
 */
async function generateLongConversationSummaryChunk(
  rawTextCleaned: string,
  opts?: { studentName?: string; teacherName?: string; logId?: string; chunkIndex?: number; totalChunks?: number }
): Promise<string> {
  const studentLabel = formatStudentLabel(opts?.studentName);
  const teacherLabel = formatTeacherLabel(opts?.teacherName);
  
  // 爆速化: プロンプトを大幅に短縮（必須情報のみ）
  const system = `講師（${teacherLabel}）と生徒（${studentLabel}）の1対1会話を要約。

【必須要素】
1. 会話のテーマ（冒頭1-2文）
2. 生徒の状態・問題点（内面的な思考パターン含む）
3. 講師の具体例・比喩（必ず含める）
4. 生徒の気づき・自覚
5. 会話の流れ（時系列）
6. 結論・今後の方針
7. 生徒の内面的変化

【出力形式】
- **重要なポイントは太字（**text**）で強調（最低5箇所）**
- 段落は改行2回
- 一文を長く、自然に（「。」で区切りすぎない）
- 主語は「${studentLabel}」「${teacherLabel}」を使用
- 「この会話では〜」のような報告文は禁止
- 会話の長さに比例して十分に長く（10-15段落以上）`.trim();

  const user = `会話テキストを要約。上記の必須要素を全て含め、**重要なポイントは太字（**text**）で最低5箇所強調**してください。

【会話テキスト】
${rawTextCleaned}`.trim();

  const { contentText, finishReason, refusal, raw } = await callChatCompletions({
    model: MODEL_FAST,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // 爆速化: max_tokensを削減
    max_tokens: 6000,
    temperature: 0.7,
  });

  if (!contentText) {
    console.error("[generateLongConversationSummaryChunk] Empty content:", {
      finishReason,
      refusal,
      rawPreview: raw.slice(0, 1200),
      logId: opts?.logId,
      chunkIndex: opts?.chunkIndex,
    });
    throw new Error(`LLM summary returned empty content (finish_reason=${finishReason ?? "unknown"}).`);
  }

  return contentText.trim();
}

/**
 * Generate long conversation summary with parallel processing for long transcripts
 */
export async function generateLongConversationSummary(
  rawTextCleaned: string,
  opts?: { studentName?: string; teacherName?: string; logId?: string }
): Promise<string> {
  // 長いテキスト（約20分以上の音声、20000文字以上）の場合は分割して並列処理
  const shouldSplit = rawTextCleaned.length > 20000;
  
  if (shouldSplit) {
    console.log("[generateLongConversationSummary] Long transcript detected, splitting into chunks for parallel processing:", {
      totalLength: rawTextCleaned.length,
      estimatedChunks: Math.ceil(rawTextCleaned.length / 10000),
    });

    const chunks = splitTextIntoChunks(rawTextCleaned, 10000);
    console.log("[generateLongConversationSummary] Split into chunks:", {
      chunkCount: chunks.length,
      chunkSizes: chunks.map(c => c.length),
    });

    // 各チャンクを並列で処理
    const chunkResults = await Promise.allSettled(
      chunks.map((chunk, index) =>
        generateLongConversationSummaryChunk(chunk, {
          studentName: opts?.studentName,
          teacherName: opts?.teacherName,
          logId: opts?.logId,
          chunkIndex: index,
          totalChunks: chunks.length,
        })
      )
    );

    // 結果を結合（各チャンクのサマリーを統合）
    const summaries: string[] = [];
    for (let i = 0; i < chunkResults.length; i++) {
      const result = chunkResults[i];
      if (result.status === "fulfilled" && result.value) {
        summaries.push(result.value);
      } else {
        console.error(`[generateLongConversationSummary] Chunk ${i} failed:`, result.status === "rejected" ? result.reason : "empty result");
        // 失敗したチャンクはスキップ（部分的なサマリーでも表示）
      }
    }

    // 複数のサマリーを統合
    if (summaries.length === 0) {
      throw new Error("All summary chunks failed");
    }

    // 複数のサマリーがある場合は、それらを結合
    if (summaries.length > 1) {
      const combinedSummaries = summaries.join("\n\n---\n\n");
      return combinedSummaries.trim();
    }

    return summaries[0].trim();
  }

  // 短いテキストは通常通り処理
  return generateLongConversationSummaryChunk(rawTextCleaned, opts);
}

export async function extractConversationArtifactsMini(
  rawTextCleaned: string,
  opts?: { studentName?: string; teacherName?: string; logId?: string; existingCategories?: string[] }
): Promise<ExtractOnlyResult> {
  const studentLabel = formatStudentLabel(opts?.studentName);
  const teacherLabel = formatTeacherLabel(opts?.teacherName);
  
  // 爆速化: プロンプトを大幅に短縮
  const system = `会話ログからJSONを抽出。主語は「${studentLabel}」「${teacherLabel}」を使用。

出力JSON:
{
  "title": "タイトル（1文章、30-60文字）",
  "timeline": [{"topic": "話題タイトル", "summary": "具体的なサマリー（3-5文、講師の具体例・比喩、生徒の気づき含む）"}],
  "nextActions": ["結論・次アクション（実行可能な粒度）", ...],
  "structuredDelta": {
    "personal": {
      "今の感情": {"value": "タイトル", "detail": "根拠説明", "confidence": 0.0-1.0, "category": "感情"},
      "興味関心": {"value": "タイトル", "detail": "根拠説明", "confidence": 0.0-1.0, "category": "興味関心"}
    },
    "basics": {}
  }
}

既存カテゴリー: ${opts?.existingCategories?.join(", ") || "なし"}`.trim();

  const user = `会話テキストを分析。JSONを出力。

【会話テキスト】
${rawTextCleaned}`.trim();

  const { contentText, finishReason, refusal, raw } = await callChatCompletions({
    model: MODEL_FAST,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_tokens: 4000,
    temperature: 0.5,
  });

  if (!contentText) {
    console.error("[extractConversationArtifactsMini] Empty content:", {
      finishReason,
      refusal,
      rawPreview: raw.slice(0, 1200),
      logId: opts?.logId,
    });
    throw new Error(`LLM extract returned empty content (finish_reason=${finishReason ?? "unknown"}).`);
  }

  const txt = contentText.trim();
  const obj =
    tryParseJson<any>(txt) ?? (extractJsonCandidate(txt) ? tryParseJson<any>(extractJsonCandidate(txt)!) : null);
  if (!obj) {
    console.error("[extractConversationArtifactsMini] Non-JSON content:", txt.slice(0, 800));
    throw new Error("LLM extract returned non-JSON content.");
  }

  return {
    title: typeof obj.title === "string" ? obj.title : undefined,
    timeline: Array.isArray(obj.timeline) ? (obj.timeline as any) : undefined,
    nextActions: Array.isArray(obj.nextActions) ? (obj.nextActions as any) : undefined,
    structuredDelta: normalizeStructuredDelta(obj.structuredDelta as StructuredDelta | undefined, opts?.logId),
  };
}

/**
 * Split long text into chunks for parallel processing
 */
function splitTextIntoChunks(text: string, maxChunkSize: number = 10000): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let currentIndex = 0;

  while (currentIndex < text.length) {
    const chunkEnd = Math.min(currentIndex + maxChunkSize, text.length);
    let chunk = text.slice(currentIndex, chunkEnd);

    // Try to split at a natural boundary (sentence end, paragraph break)
    if (chunkEnd < text.length) {
      // Look for sentence endings within the last 500 characters
      const lookback = Math.min(500, chunk.length);
      const lookbackText = chunk.slice(-lookback);
      const sentenceEnd = Math.max(
        lookbackText.lastIndexOf('。'),
        lookbackText.lastIndexOf('\n\n'),
        lookbackText.lastIndexOf('\n')
      );

      if (sentenceEnd > 0) {
        const actualEnd = chunk.length - lookback + sentenceEnd + 1;
        chunk = text.slice(currentIndex, currentIndex + actualEnd);
        currentIndex += actualEnd;
      } else {
        currentIndex = chunkEnd;
      }
    } else {
      currentIndex = chunkEnd;
    }

    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Format raw transcript with topic headings and speaker separation
 * For long transcripts (>30000 chars), splits into chunks and processes in parallel
 */
export async function formatTranscript(
  rawTextOriginal: string,
  opts?: { studentName?: string; teacherName?: string }
): Promise<string> {
  const studentLabel = formatStudentLabel(opts?.studentName);
  const teacherLabel = formatTeacherLabel(opts?.teacherName);
  
  // 長いテキスト（約20分以上の音声、20000文字以上）の場合は分割して並列処理
  const shouldSplit = rawTextOriginal.length > 20000;
  
  if (shouldSplit) {
    console.log("[formatTranscript] Long transcript detected, splitting into chunks for parallel processing:", {
      totalLength: rawTextOriginal.length,
      estimatedChunks: Math.ceil(rawTextOriginal.length / 10000),
    });

    const chunks = splitTextIntoChunks(rawTextOriginal, 10000);
    console.log("[formatTranscript] Split into chunks:", {
      chunkCount: chunks.length,
      chunkSizes: chunks.map(c => c.length),
    });

    // 各チャンクを並列で処理
    const chunkResults = await Promise.allSettled(
      chunks.map((chunk, index) =>
        formatTranscriptChunk(chunk, {
          studentName: opts?.studentName,
          teacherName: opts?.teacherName,
          chunkIndex: index,
          totalChunks: chunks.length,
        })
      )
    );

    // 結果を結合
    const formattedChunks: string[] = [];
    for (let i = 0; i < chunkResults.length; i++) {
      const result = chunkResults[i];
      if (result.status === "fulfilled" && result.value) {
        formattedChunks.push(result.value);
      } else {
        console.error(`[formatTranscript] Chunk ${i} failed:`, result.status === "rejected" ? result.reason : "empty result");
        // 失敗したチャンクは元のテキストを使用
        formattedChunks.push(chunks[i]);
      }
    }

    // チャンクを結合（見出しの重複を避ける）
    const combined = formattedChunks
      .map((chunk, index) => {
        // 最初のチャンク以外は、最初の見出しを削除
        if (index > 0) {
          return chunk.replace(/^##\s+.*?\n\n?/m, '');
        }
        return chunk;
      })
      .join('\n\n');

    return combined.trim();
  }

  // 短いテキストは通常通り処理
  return formatTranscriptChunk(rawTextOriginal, opts);
}

/**
 * Format a single chunk of transcript
 */
async function formatTranscriptChunk(
  rawTextOriginal: string,
  opts?: { studentName?: string; teacherName?: string; chunkIndex?: number; totalChunks?: number }
): Promise<string> {
  const studentLabel = formatStudentLabel(opts?.studentName);
  const teacherLabel = formatTeacherLabel(opts?.teacherName);
  
  // 爆速化: max_tokensを大幅に削減
  // 入力テキストの長さから出力トークン数を推定（日本語は約2文字/トークン）
  const estimatedInputTokens = Math.ceil(rawTextOriginal.length / 2);
  // 出力は入力の1.2-1.3倍程度（整形により若干増える）
  const baseOutputTokens = Math.ceil(estimatedInputTokens * 1.3);
  // 最低5000、最大8000トークン（爆速化のため上限を大幅に下げる）
  const maxTokens = Math.min(Math.max(baseOutputTokens, 5000), 8000);
  
  // 爆速化: プロンプトを大幅に短縮
  const system = `会話テキストを整形。話題ごとに見出し（##）をつけ、講師（${teacherLabel}）と生徒（${studentLabel}）の発言を分ける。

【必須】
- 全文保持（省略・要約禁止）
- 会話として自然に読めるように整形
- 喋り口調のニュアンス保持
- 不完全な文は補完（話し方の特徴は残す）
- 発言の順序保持
- **重要なポイントは太字（**text**）でハイライト（最低3-5箇所）**

【出力形式】
- 話題ごとに見出し（## 話題のタイトル）
- 講師: 「**${teacherLabel}**: 発言内容」
- 生徒: 「**${studentLabel}**: 発言内容」`.trim();

  const user = `会話テキストを整形。全文保持、会話として自然に、**重要なポイントは太字（**text**）で最低3-5箇所ハイライト**。

【会話テキスト】
${rawTextOriginal}`.trim();

  const { contentText, finishReason, refusal, raw } = await callChatCompletions({
    model: MODEL_FAST,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
  });

  if (!contentText) {
    console.error("[formatTranscript] Empty content:", {
      finishReason,
      refusal,
      rawPreview: raw.slice(0, 1200),
      maxTokens,
      inputLength: rawTextOriginal.length,
    });
    // フォールバック: 元のテキストを返す
    return rawTextOriginal;
  }

  // finish_reason=lengthの場合は警告を出すが、生成された内容を返す
  if (finishReason === "length") {
    console.warn("[formatTranscript] Output truncated (finish_reason=length):", {
      maxTokens,
      inputLength: rawTextOriginal.length,
      outputLength: contentText.length,
    });
  }

  return contentText.trim();
}

function chunkSegmentsByChars(segments: DiarizedSegment[], maxChars = 4000) {
  const chunks: DiarizedSegment[][] = [];
  let current: DiarizedSegment[] = [];
  let size = 0;
  for (const seg of segments) {
    const nextSize = size + seg.text.length;
    if (current.length > 0 && nextSize > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(seg);
    size += seg.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function heuristicSpeakerLabel(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "unknown";
  if (/^(はい|うん|ええ|そうです|そうですね)/.test(trimmed)) return "student";
  if (/(どう思う|どうかな|どう？|できますか|できる？|次回|宿題)/.test(trimmed)) return "teacher";
  if (trimmed.endsWith("？") || trimmed.endsWith("?")) return "teacher";
  return "unknown";
}

async function diarizeSegmentChunk(
  chunk: Array<DiarizedSegment & { hint?: string }>,
  opts?: { studentName?: string; teacherName?: string }
): Promise<
  Array<{ index: number; speaker: "teacher" | "student" | "unknown"; text: string; confidence?: number }>
> {
  const studentLabel = formatStudentLabel(opts?.studentName);
  const teacherLabel = formatTeacherLabel(opts?.teacherName);
  const system = `あなたは1対1面談の話者推定と漢字補正の担当者です。
目的: 各セグメントに話者ラベル（teacher/student/unknown）を付与し、漢字変換を自然に修正する。
禁止: 要約/省略/意味変更/並び替え/勝手な補足。
ルール:
- teacher は説明・指導・質問・次の行動提示が中心
- student は回答・感想・困りごと・自己状況の共有が中心
- 迷ったら unknown にする（誤判定より安全）
- 出力JSONは入力と同じ index を必ず全件返す
話者名は ${teacherLabel} / ${studentLabel} を想定する。`;

  const user = `以下のセグメント配列に対して、話者ラベルと漢字補正済みテキストを返してください。
出力は必ず次のJSONのみ:
{"segments":[{"index":0,"speaker":"teacher|student|unknown","text":"...","confidence":0.0-1.0}]}

入力:
${JSON.stringify(chunk, null, 2)}`;

  const { contentText, finishReason, refusal, raw } = await callChatCompletions({
    model: MODEL_FAST,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_tokens: 4000,
    temperature: 0.2,
  });

  if (!contentText) {
    console.error("[diarizeSegmentChunk] Empty content:", { finishReason, refusal, rawPreview: raw.slice(0, 800) });
    return chunk.map((s) => ({ index: s.index, speaker: "unknown", text: s.text }));
  }

  const parsed =
    tryParseJson<{ segments?: Array<{ index: number; speaker?: string; text?: string; confidence?: number }> }>(
      contentText.trim()
    ) ?? (extractJsonCandidate(contentText.trim()) ? tryParseJson<any>(extractJsonCandidate(contentText.trim())!) : null);
  if (!parsed?.segments) {
    console.error("[diarizeSegmentChunk] Non-JSON or missing segments:", contentText.slice(0, 800));
    return chunk.map((s) => ({ index: s.index, speaker: "unknown", text: s.text }));
  }

  return parsed.segments.map((s: { index: number; speaker?: string; text?: string; confidence?: number }) => ({
    index: s.index,
    speaker:
      s.speaker === "teacher" || s.speaker === "student" || s.speaker === "unknown"
        ? s.speaker
        : "unknown",
    text: (s.text ?? "").trim(),
    confidence: typeof s.confidence === "number" ? s.confidence : undefined,
  }));
}

async function refineDiarizedChunk(
  chunk: Array<{ index: number; speaker: "teacher" | "student" | "unknown"; text: string }>,
  opts?: { studentName?: string; teacherName?: string }
) {
  const studentLabel = formatStudentLabel(opts?.studentName);
  const teacherLabel = formatTeacherLabel(opts?.teacherName);
  const system = `あなたは話者ラベルの整合性チェックを行います。
目的: teacher/student/unknown の誤りを直す。意味変更は禁止。
話者名は ${teacherLabel}/${studentLabel} を想定。出力はJSONのみ。`;

  const user = `以下の話者ラベルを整合性チェックし、必要なら修正してください。
出力JSON:
{"segments":[{"index":0,"speaker":"teacher|student|unknown","text":"..."}]}

入力:
${JSON.stringify(chunk, null, 2)}`;

  const { contentText, raw } = await callChatCompletions({
    model: MODEL_FINAL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const parsed =
    tryParseJson<{ segments?: Array<{ index: number; speaker?: string; text?: string }> }>(
      (contentText ?? "").trim()
    ) ??
    (extractJsonCandidate(raw) ? tryParseJson<any>(extractJsonCandidate(raw)!) : null);

  if (!parsed?.segments) return chunk;
  return parsed.segments.map((s: { index: number; speaker?: string; text?: string }) => ({
    index: s.index,
    speaker:
      s.speaker === "teacher" || s.speaker === "student" || s.speaker === "unknown"
        ? s.speaker
        : "unknown",
    text: (s.text ?? "").trim(),
  }));
}

export async function formatTranscriptFromSegments(
  segments: Array<{ start?: number; end?: number; text?: string }>,
  opts?: { studentName?: string; teacherName?: string }
): Promise<string> {
  const sourceSegments: DiarizedSegment[] = segments
    .map((s, index) => ({
      index,
      start: s.start,
      end: s.end,
      text: (s.text ?? "").trim(),
    }))
    .filter((s) => s.text.length > 0);

  if (!sourceSegments.length) return "";

  const chunks = chunkSegmentsByChars(sourceSegments, 3500);
  const labeled: Array<{ index: number; speaker: "teacher" | "student" | "unknown"; text: string }> = [];
  for (const chunk of chunks) {
    const hinted = chunk.map((c) => ({ ...c, hint: heuristicSpeakerLabel(c.text) }));
    const result = await diarizeSegmentChunk(hinted, opts);
    labeled.push(...result);
  }

  const refinedChunks = chunkSegmentsByChars(
    labeled.map((l) => ({ index: l.index, text: l.text })) as DiarizedSegment[],
    3800
  );
  const refined: Array<{ index: number; speaker: "teacher" | "student" | "unknown"; text: string }> = [];
  for (const chunk of refinedChunks) {
    const chunkItems = chunk.map((c) => {
      const matched = labeled.find((l) => l.index === c.index);
      return {
        index: c.index,
        speaker: matched?.speaker ?? "unknown",
        text: matched?.text ?? c.text,
      };
    });
    const result = await refineDiarizedChunk(chunkItems, opts);
    refined.push(...result);
  }

  const labelMap = new Map(refined.map((s) => [s.index, s]));
  const teacherLabel = formatTeacherLabel(opts?.teacherName);
  const studentLabel = formatStudentLabel(opts?.studentName);

  const lines: string[] = [];
  let currentSpeaker: "teacher" | "student" | "unknown" | null = null;
  let buffer = "";

  const flush = () => {
    if (!buffer.trim() || !currentSpeaker) return;
    const label =
      currentSpeaker === "teacher"
        ? teacherLabel
        : currentSpeaker === "student"
        ? studentLabel
        : "話者不明";
    lines.push(`**${label}**: ${buffer.trim()}`);
  };

  for (const seg of sourceSegments) {
    const labeledSeg = labelMap.get(seg.index);
    const speaker = labeledSeg?.speaker ?? "unknown";
    const text = labeledSeg?.text || seg.text;
    if (!text) continue;
    if (currentSpeaker === speaker) {
      buffer = `${buffer} ${text}`.trim();
    } else {
      flush();
      currentSpeaker = speaker;
      buffer = text;
    }
  }
  flush();

  return lines.join("\n");
}

export async function formatTranscriptFromText(
  rawText: string,
  opts?: { studentName?: string; teacherName?: string }
): Promise<string> {
  if (!rawText?.trim()) return "";
  const paragraphs = rawText
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((p) => `**話者不明**: ${p}`).join("\n");
}
type ReportInput = {
  studentName: string;
  organizationName?: string;
  periodFrom?: string;
  periodTo?: string;
  previousReport?: string;
  profileSnapshot?: any;
  logs: Array<{
    id: string;
    date: string;
    parentPack?: any;
    summaryMarkdown?: string;
    timeline?: any;
    nextActions?: any;
    profileDelta?: any;
  }>;
};

type ParentReportJson = {
  date: string;
  salutation: string;
  studentName: string;
  keyPoints: string;
  sections: Array<{ title: string; body: string }>;
  homework: Array<{ item: string; why: string; metric: string; due: string | null }>;
  closing: string;
};

function renderParentReportMarkdown(report: ParentReportJson, orgName: string, periodFrom: string, periodTo: string) {
  const lines: string[] = [];
  lines.push(`${orgName} / ${report.studentName} / 対象期間: ${periodFrom}〜${periodTo} / 作成日: ${report.date}`);
  lines.push("");
  lines.push(report.salutation);
  lines.push("");
  lines.push("## 今回の要点");
  lines.push(report.keyPoints);
  lines.push("");
  report.sections.forEach((section) => {
    lines.push(`## ${section.title}`);
    lines.push(section.body);
    lines.push("");
  });
  lines.push("## 次回までの宿題");
  if (report.homework.length === 0) {
    lines.push("（今回の宿題はありません）");
  } else {
    report.homework.forEach((hw, idx) => {
      lines.push(`${idx + 1}. ${hw.item}（期限: ${hw.due ?? "次回面談まで"} / 指標: ${hw.metric}）`);
      lines.push(`   理由: ${hw.why}`);
    });
  }
  lines.push("");
  lines.push(report.closing);
  return lines.join("\n").trim();
}

export async function generateParentReport(input: ReportInput): Promise<{ markdown: string; reportJson: ParentReportJson }> {
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY (or OPENAI_API_KEY) is not set. Report generation requires LLM (no mock).");
  }

  const organizationName = input.organizationName ?? "塾";
  const periodFrom = input.periodFrom ?? "前回レポート以降";
  const periodTo = input.periodTo ?? "今回まで";
  const createdAt = new Date().toISOString().slice(0, 10);
  const previous = (input.previousReport ?? "").trim();

  const systemPrompt = `あなたは学習塾の教務責任者です。保護者向けの近況報告レポートを作成します。
浅見が手書きしていた文章と同等の品質を目標に、具体的で自然な日本語（ですます）で書いてください。

# 絶対ルール
- ですます調
- 入力に parentPack がある場合は **parentPack を最優先**で構成する
- 推測で盛らない。不明は「現時点では未確認です」と書く
- 前回レポートがある場合、「継続」「変化」「今回の焦点」を必ず明示する
- 科目や試験、教材、期限は可能な範囲で具体に

# 章立て（必ずこの順）
1) 今回の要点（2〜4文）
2) 学習状況（事実）
3) 課題と原因（分析）
4) 次の打ち手（科目別・教材・順序・期限）
5) 受験戦略（志望校/併願リスク/今やる理由）
6) 次回までの宿題（3〜6件、why/due/metric付き）
7) 締め

# 出力（JSONのみ）
{
  \"date\": \"YYYY-MM-DD\",
  \"salutation\": \"お世話になっております。◯◯でございます。...\",
  \"studentName\": \"...\",
  \"keyPoints\": \"...\",\n  \"sections\": [\n    { \"title\": \"学習状況\", \"body\": \"...\" },\n    { \"title\": \"課題と原因\", \"body\": \"...\" },\n    { \"title\": \"次の打ち手\", \"body\": \"...\" },\n    { \"title\": \"受験戦略\", \"body\": \"...\" }\n  ],\n  \"homework\": [\n    { \"item\": \"...\", \"why\": \"...\", \"metric\": \"...\", \"due\": \"YYYY-MM-DD or null\" }\n  ],\n  \"closing\": \"近況報告は以上になります。引き続きよろしくお願いいたします。\"\n}`;

  const userPrompt = `生徒名: ${input.studentName}
対象期間: ${periodFrom} 〜 ${periodTo}
作成日: ${createdAt}

前回レポート（あれば必ず参照）:
${previous ? previous : "（前回レポートなし）"}

生徒プロフィール（最新スナップショット）:
${JSON.stringify(input.profileSnapshot ?? {}, null, 2)}

会話ログ（今回の対象。新しい順）:
${input.logs
    .map((l, idx) =>
      [
        `# Log ${idx + 1}`,
        `date: ${l.date}`,
        `id: ${l.id}`,
        `parentPack:`,
        JSON.stringify(l.parentPack ?? {}, null, 2),
        `summaryMarkdown:`,
        l.summaryMarkdown ?? "",
        `timeline:`,
        JSON.stringify(l.timeline ?? [], null, 2),
        `nextActions:`,
        JSON.stringify(l.nextActions ?? [], null, 2),
        `profileDelta:`,
        JSON.stringify(l.profileDelta ?? {}, null, 2),
      ].join("\n")
    )
    .join("\n\n")}`;

  const { contentText, raw } = await callChatCompletions({
    model: MODEL_REPORT,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const jsonText = contentText ?? extractJsonCandidate(raw) ?? "";
  const parsed = tryParseJson<ParentReportJson>(jsonText);
  if (!parsed) {
    throw new Error("LLM report returned non-JSON response.");
  }

  const reportJson: ParentReportJson = {
    date: parsed.date ?? createdAt,
    salutation: parsed.salutation ?? "お世話になっております。",
    studentName: parsed.studentName ?? input.studentName,
    keyPoints: parsed.keyPoints ?? "",
    sections: parsed.sections ?? [],
    homework: parsed.homework ?? [],
    closing: parsed.closing ?? "近況報告は以上になります。引き続きよろしくお願いいたします。",
  };

  const markdown = renderParentReportMarkdown(reportJson, organizationName, periodFrom, periodTo);
  return { markdown, reportJson };
}

export async function generateParentReportMarkdown(input: ReportInput): Promise<string> {
  const { markdown } = await generateParentReport(input);
  return markdown;
}
