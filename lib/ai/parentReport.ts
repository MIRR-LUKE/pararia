import {
  buildBundlePreview,
  buildReportBundleLog,
  buildBundleQualityEval,
  type BundleQualityEval,
} from "@/lib/operational-log";
import { parseConversationArtifact, renderConversationArtifactOrFallback } from "@/lib/conversation-artifact";

const REPORT_MODEL =
  process.env.LLM_MODEL_REPORT ||
  process.env.LLM_MODEL_FINAL ||
  process.env.LLM_MODEL ||
  "gpt-5.4";

type ReportInput = {
  studentName: string;
  organizationName?: string;
  periodFrom?: string;
  periodTo?: string;
  logs: Array<{
    id: string;
    sessionId?: string | null;
    date: string;
    mode: "INTERVIEW" | "LESSON_REPORT";
    subType?: string | null;
    artifactJson?: unknown;
    summaryMarkdown?: string;
  }>;
};

export type ParentReportJson = {
  date: string;
  greeting: string;
  introduction: string;
  summary: string;
  sections: Array<{ title: string; body: string }>;
  closing: string;
};

export type ParentReportResult = {
  markdown: string;
  reportJson: ParentReportJson;
  bundleQualityEval: BundleQualityEval;
  generationMeta: ParentReportGenerationMeta;
};

export type ParentReportTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
};

export type ParentReportGenerationMeta = {
  model: string;
  apiCalls: number;
  retried: boolean;
  tokenUsage: ParentReportTokenUsage;
};

const DEFAULT_REPORT_SECTIONS = [
  { title: "今回の様子", body: "今回の記録から、現在の学習状況と次回に向けた確認事項を整理しています。" },
  { title: "学習状況の変化", body: "直近のやり取りの中で見えた変化は、次回面談・授業で継続して確認します。" },
  { title: "講師としての見立て", body: "事実ベースの記録を踏まえ、次回も方針の妥当性を確認していきます。" },
  { title: "科目別またはテーマ別の具体策", body: "教材・教科・優先順位を具体化し、次回までに何を回すかを明確にします。" },
  { title: "リスクとその意味", body: "止まりやすいポイントや見落としやすい点を、必要以上に煽らず整理します。" },
  { title: "次回までの方針", body: "今回整理した確認事項と次の行動をもとに、学習の進め方を具体化していきます。" },
  { title: "ご家庭で見てほしいこと", body: "課題を終えたかどうかだけでなく、やり直しや定着確認まで進められたかを一言確認いただけると効果的です。" },
] as const;

function getApiKey() {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    throw new Error("LLM_API_KEY or OPENAI_API_KEY is required.");
  }
  return apiKey;
}

function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function extractJsonCandidate(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function containsSentenceLikeEnglish(text: string) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/(?:\b[A-Za-z]{3,}\b[\s,.;:!?'"()/-]*){3,}/.test(normalized)) return true;
  const latinChars = (normalized.match(/[A-Za-z]/g) ?? []).length;
  return latinChars >= 18;
}

function countJapaneseChars(text: string) {
  return (text.match(/[ぁ-んァ-ヶ一-龠]/g) ?? []).length;
}

function countEnglishWords(text: string) {
  return (text.match(/\b[A-Za-z][A-Za-z'/-]{2,}\b/g) ?? []).length;
}

function isJapanesePrimaryText(text: string) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const japaneseChars = countJapaneseChars(normalized);
  const latinChars = (normalized.match(/[A-Za-z]/g) ?? []).length;
  const englishWords = countEnglishWords(normalized);
  if (japaneseChars === 0) return false;
  if (englishWords >= 4) return false;
  if (latinChars >= Math.max(18, japaneseChars)) return false;
  return true;
}

function sanitizeReportText(text: unknown, maxLength: number) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const sliced = normalized.slice(0, maxLength).trim();
  if (!sliced) return "";
  if (containsSentenceLikeEnglish(sliced)) return "";
  if (!isJapanesePrimaryText(sliced)) return "";
  return sliced;
}

function emptyTokenUsage(): ParentReportTokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
  };
}

function parseTokenUsage(payload: any): ParentReportTokenUsage {
  const usage = payload?.usage ?? {};
  return {
    inputTokens: Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0,
    cachedInputTokens:
      Number(usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? 0) || 0,
    outputTokens: Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0,
    totalTokens: Number(usage?.total_tokens ?? 0) || 0,
    reasoningTokens:
      Number(usage?.completion_tokens_details?.reasoning_tokens ?? usage?.output_tokens_details?.reasoning_tokens ?? 0) ||
      0,
  };
}

function addTokenUsage(left: ParentReportTokenUsage, right: ParentReportTokenUsage): ParentReportTokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  };
}

function countReportBodyChars(report: ParentReportJson) {
  return report.sections.reduce((sum, section) => sum + section.body.length, 0) + report.summary.length;
}

function evaluateParentReportQuality(report: ParentReportJson, fallback: ParentReportJson) {
  const issues: string[] = [];
  const defaultSectionCount = report.sections.filter((section, index) => section.body === fallback.sections[index]?.body).length;
  const distinctSectionBodies = new Set(report.sections.map((section) => section.body)).size;
  const totalBodyChars = countReportBodyChars(report);

  if (report.summary === fallback.summary) {
    issues.push("summary_is_generic");
  }
  if (defaultSectionCount >= 2) {
    issues.push("too_many_default_sections");
  }
  if (distinctSectionBodies < 4) {
    issues.push("sections_are_not_distinct_enough");
  }
  if (totalBodyChars < 650) {
    issues.push("report_is_too_short");
  }

  return issues;
}

function buildParentReportRepairPrompt(input: {
  studentName: string;
  periodFrom: string;
  periodTo: string;
  createdAt: string;
  bundlePreview: string;
  logPayload: string;
  previousReport: ParentReportJson;
  issues: string[];
}) {
  const labels = input.issues.map((issue) => {
    if (issue === "summary_is_generic") return "- 要約が汎用的で、今回の状況が弱い";
    if (issue === "too_many_default_sections") return "- 定型文のまま残っている段落が多い";
    if (issue === "sections_are_not_distinct_enough") return "- 各段落の役割が分かれず、内容が重複している";
    if (issue === "report_is_too_short") return "- 全体が短く、判断理由や具体策が足りない";
    return `- ${issue}`;
  });
  return `前回の保護者レポート案は具体性が足りません。選択ログだけを根拠に、弱い点を修正して JSON object のみで出力し直してください。

生徒名: ${input.studentName}
対象期間: ${input.periodFrom}〜${input.periodTo}
作成日: ${input.createdAt}

前回案:
${JSON.stringify(input.previousReport, null, 2)}

修正理由:
${labels.join("\n")}

選択中ログの束ね品質:
${input.bundlePreview}

選択ログ詳細:
${input.logPayload}

必須ルール:
- 前回案の generic な段落を、選択ログに出てくる事実で具体化する
- ない情報を足さない
- 7 セクションは維持する
- 同じことを言い換えて繰り返さない
- 保護者が次に何を見ればよいかが伝わるようにする`;
}

async function callReportModel(systemPrompt: string, userPrompt: string) {
  const body = {
    model: REPORT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_completion_tokens: 3200,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    let detail: unknown = text;
    try {
      detail = JSON.parse(text);
    } catch {
      // use raw text
    }

    const tempUnsupported = /temperature/i.test(text) && /unsupported|invalid/i.test(text);
    if (tempUnsupported) {
      const retry = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify({
          ...body,
          temperature: undefined,
        }),
      });
      const retryText = await retry.text();
      if (!retry.ok) {
        throw new Error(`Parent report generation failed (${retry.status}): ${retryText}`);
      }
      const retryParsed = tryParseJson<any>(retryText);
      const retryContent = retryParsed?.choices?.[0]?.message?.content;
      return {
        contentText: typeof retryContent === "string" ? retryContent : JSON.stringify(retryContent ?? ""),
        tokenUsage: parseTokenUsage(retryParsed),
      };
    }

    throw new Error(`Parent report generation failed (${res.status}): ${JSON.stringify(detail)}`);
  }

  const parsed = tryParseJson<any>(text);
  const content = parsed?.choices?.[0]?.message?.content;
  const tokenUsage = parseTokenUsage(parsed);
  if (typeof content === "string") {
    return {
      contentText: content,
      tokenUsage,
    };
  }
  if (Array.isArray(content)) {
    return {
      contentText: content
        .map((part) => (typeof part?.text === "string" ? part.text : typeof part === "string" ? part : ""))
        .join("")
        .trim(),
      tokenUsage,
    };
  }
  return {
    contentText: text,
    tokenUsage,
  };
}

function renderParentReportMarkdown(
  report: ParentReportJson,
  organizationName: string,
  periodFrom: string,
  periodTo: string
) {
  const lines: string[] = [];
  lines.push(`${organizationName} / ${report.date} / 対象期間: ${periodFrom}〜${periodTo}`);
  lines.push("");
  lines.push(report.greeting);
  lines.push("");
  lines.push(report.introduction);
  lines.push("");
  lines.push("## 今回の要点");
  lines.push(report.summary);
  lines.push("");
  for (const section of report.sections) {
    lines.push(`## ${section.title}`);
    lines.push(section.body);
    lines.push("");
  }
  lines.push(report.closing);
  return lines.join("\n").trim();
}

function defaultReportJson(input: ReportInput, createdAt: string): ParentReportJson {
  return {
    date: createdAt,
    greeting: "お世話になっております。",
    introduction: "直近の面談・授業記録をもとに、現在の状況と今後の進め方をご報告いたします。",
    summary: "現在の状況と次回までの方針を、会話ログの内容に基づいて整理しました。",
    sections: DEFAULT_REPORT_SECTIONS.map((section) => ({ ...section })),
    closing: "引き続きよろしくお願いいたします。",
  };
}

function sanitizeParentReportJson(value: ParentReportJson | null | undefined, fallback: ParentReportJson): ParentReportJson {
  const rawSections = Array.isArray(value?.sections) ? value.sections : [];
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.date ?? "")) ? String(value?.date) : fallback.date,
    greeting: sanitizeReportText(value?.greeting, 80) || fallback.greeting,
    introduction: sanitizeReportText(value?.introduction, 220) || fallback.introduction,
    summary: sanitizeReportText(value?.summary, 320) || fallback.summary,
    sections: DEFAULT_REPORT_SECTIONS.map((defaultSection, index) => {
      const candidate = rawSections[index];
      return {
        title: sanitizeReportText(candidate?.title, 48) || defaultSection.title,
        body: sanitizeReportText(candidate?.body, 520) || defaultSection.body,
      };
    }),
    closing: sanitizeReportText(value?.closing, 120) || fallback.closing,
  };
}

export function buildReportBundle(input: ReportInput) {
  const selected = input.logs.map((log) =>
    buildReportBundleLog({
      id: log.id,
      sessionId: log.sessionId ?? null,
      date: log.date,
      mode: log.mode,
      subType: log.subType ?? null,
      sessionType: log.mode,
      artifactJson: log.artifactJson,
      summaryMarkdown: log.summaryMarkdown,
    })
  );

  return {
    selected,
    bundleQualityEval: buildBundleQualityEval(selected, selected),
  };
}

export async function generateParentReport(input: ReportInput): Promise<ParentReportResult> {
  const createdAt = new Date().toISOString().slice(0, 10);
  const organizationName = input.organizationName ?? "PARARIA";
  const periodFrom = input.periodFrom ?? createdAt;
  const periodTo = input.periodTo ?? createdAt;

  const { bundleQualityEval } = buildReportBundle(input);

  const systemPrompt = `あなたは学習塾の講師責任者として保護者向けレポートを作成します。
出力は JSON object のみです。必ず自然な日本語で書いてください。

品質基準:
- ただの要約ではなく、事実→見立て→方針→具体策→リスク→次回方針 が一本で通る文章にする
- 具体名(学校名、教材名、模試名、教科名、日付、数値、志望校)は落とさない
- 根拠のない励ましや感想文にしない
- 「頑張っていました」で終わらせない
- 事実と解釈を混ぜすぎない
- 本人の特性に合う進め方なら、その理由まで書く
- 選択されたログ以外は使わない
- 情報が弱い点は、断定せず慎重に書く
- 本文・見出し・要約はすべて日本語で書く
- 英語の見出し、英語の定型句、英語逃げは禁止
- 英字表記を残す場合も、日本語文の中で意味が分かるように説明する
- 入力には structuredArtifact と derivedMarkdown がある。正本は structuredArtifact とみなし、derivedMarkdown は表示用の派生物として扱う
- 保護者レポート用の別要約、前回レポート、プロフィール情報がある前提で書かない
- 各ログの structuredArtifact を優先して読み、必要に応じて derivedMarkdown で文脈を補う
- ログ本文の見出しや箇条書きを、そのままコピペせず保護者向け文章へ言い換える

JSON schema:
{
  "date": "YYYY-MM-DD",
  "greeting": "冒頭の挨拶",
  "introduction": "今回どの記録をもとに何を報告するか",
  "summary": "今回の一番大きい変化や現在地を短くまとめた段落",
  "sections": [
    { "title": "今回の様子", "body": "..." },
    { "title": "学習状況の変化", "body": "..." },
    { "title": "講師としての見立て", "body": "..." },
    { "title": "科目別またはテーマ別の具体策", "body": "..." },
    { "title": "リスクとその意味", "body": "..." },
    { "title": "次回までの方針", "body": "..." },
    { "title": "ご家庭で見てほしいこと", "body": "..." }
  ],
  "closing": "締めの一文"
}`;

  const logPayload = input.logs
    .map((log, index) => {
      const artifact = parseConversationArtifact(log.artifactJson);
      const derivedMarkdown = renderConversationArtifactOrFallback(log.artifactJson, log.summaryMarkdown);
      return [
        `# Log ${index + 1}`,
        `id: ${log.id}`,
        `date: ${log.date}`,
        `mode: ${log.mode}`,
        "structuredArtifact:",
        artifact ? JSON.stringify(artifact, null, 2) : "null",
        "derivedMarkdown:",
        derivedMarkdown.trim(),
      ].join("\n");
    })
    .join("\n\n");

  const userPrompt = `生徒名: ${input.studentName}
対象期間: ${periodFrom}〜${periodTo}
作成日: ${createdAt}

選択中ログの束ね品質:
${buildBundlePreview(bundleQualityEval)}

選択ログ詳細:
${logPayload}

必須ルール:
- 「今回の様子」では、何が確認できたかを事実ベースで書く
- 「学習状況の変化」では、前回からの変化や切り替わりを書く
- 「講師としての見立て」では、なぜその方針かを書く
- 「科目別またはテーマ別の具体策」では、教材・教科・設計を具体化する
- 「リスクとその意味」では、煽らずに判断根拠として書く
- 「次回までの方針」では、次に何を確認し何を決めるかを書く
- 「ご家庭で見てほしいこと」では、家庭で確認しやすい一言や見守りポイントにする
- structuredArtifact / derivedMarkdown のどちらにもない内容は足さない`;

  const firstCall = await callReportModel(systemPrompt, userPrompt);
  const jsonText = extractJsonCandidate(firstCall.contentText) ?? firstCall.contentText;
  const parsed = tryParseJson<ParentReportJson>(jsonText);
  const fallbackReport = defaultReportJson(input, createdAt);
  let reportJson = sanitizeParentReportJson(parsed, fallbackReport);
  let apiCalls = 1;
  let tokenUsage = firstCall.tokenUsage ?? emptyTokenUsage();
  const qualityIssues = evaluateParentReportQuality(reportJson, fallbackReport);

  if (qualityIssues.length > 0) {
    const retryCall = await callReportModel(
      systemPrompt,
      buildParentReportRepairPrompt({
        studentName: input.studentName,
        periodFrom,
        periodTo,
        createdAt,
        bundlePreview: buildBundlePreview(bundleQualityEval),
        logPayload,
        previousReport: reportJson,
        issues: qualityIssues,
      })
    );
    const retryJsonText = extractJsonCandidate(retryCall.contentText) ?? retryCall.contentText;
    const retryParsed = tryParseJson<ParentReportJson>(retryJsonText);
    const retryReportJson = sanitizeParentReportJson(retryParsed, fallbackReport);
    const retryIssues = evaluateParentReportQuality(retryReportJson, fallbackReport);

    if (retryIssues.length <= qualityIssues.length) {
      reportJson = retryReportJson;
    }
    apiCalls += 1;
    tokenUsage = addTokenUsage(tokenUsage, retryCall.tokenUsage ?? emptyTokenUsage());
  }

  const markdown = renderParentReportMarkdown(reportJson, organizationName, periodFrom, periodTo);
  return {
    markdown,
    reportJson,
    bundleQualityEval,
    generationMeta: {
      model: REPORT_MODEL,
      apiCalls,
      retried: apiCalls > 1,
      tokenUsage,
    },
  };
}
