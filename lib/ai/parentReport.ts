import {
  buildBundlePreview,
  buildReportBundleLog,
  buildBundleQualityEval,
  type BundleQualityEval,
  type ReportBundleLog,
} from "@/lib/operational-log";
import { renderConversationArtifactOrFallback } from "@/lib/conversation-artifact";
import {
  addLlmTokenUsage,
  emptyLlmTokenUsage,
  generateJsonObject,
  normalizeGeneratedText,
  readGeneratedJson,
  renderMarkdownDocument,
  type LlmTokenUsage,
} from "@/lib/ai/structured-generation";

const REPORT_MODEL =
  process.env.LLM_MODEL_REPORT ||
  process.env.LLM_MODEL_FINAL ||
  process.env.LLM_MODEL ||
  "gpt-5.4";

type ReportInput = {
  studentName: string;
  guardianNames?: string | null;
  teacherName?: string | null;
  organizationName?: string | null;
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

type ParentReportDraftJson = {
  date: string;
  openingParagraph: string;
  detailParagraphs: string[];
  closingParagraph: string;
};

export type ParentReportJson = {
  date: string;
  salutation: string;
  selfIntroduction: string;
  reportLead: string;
  openingParagraph: string;
  detailParagraphs: string[];
  closingParagraph: string;
  signatureLines: string[];
};

export type ParentReportResult = {
  markdown: string;
  reportJson: ParentReportJson;
  bundleQualityEval: BundleQualityEval;
  generationMeta: ParentReportGenerationMeta;
};

export type ParentReportTokenUsage = LlmTokenUsage;

export type ParentReportGenerationMeta = {
  model: string;
  apiCalls: number;
  retried: boolean;
  tokenUsage: ParentReportTokenUsage;
};

type ReportContext = {
  createdAt: string;
  periodFrom: string;
  periodTo: string;
  salutation: string;
  selfIntroduction: string;
  reportLead: string;
  signatureLines: string[];
};

type ReportEvidenceLog = {
  id: string;
  date: string;
  mode: "INTERVIEW" | "LESSON_REPORT";
  theme: string;
  facts: string[];
  changes: string[];
  assessment: string[];
  nextChecks: string[];
  parentShare: string[];
  derivedMarkdown: string;
};

const DEFAULT_DETAIL_PARAGRAPHS = [
  "今回の記録では、学習の進め方や優先順位について、いま何を固めるべきかを丁寧に整理しています。",
  "また、本人の受け止め方や気持ちの動きにも触れながら、無理なく続けられるやり方を一緒に確認しました。",
  "次回までに何を積み上げ、どこを見直すかが分かるよう、確認の軸も合わせて整えています。",
] as const;

const GENERIC_REPORT_PHRASES = [
  "現在の状況をまとめてご報告いたします。",
  "現在の状況と今後の進め方をご報告いたします。",
  "今回の記録から、学習状況と確認事項を整理しました。",
  "今後も継続して確認します。",
  "次回も様子を見ていきます。",
  "現在の状況と次回までの方針を整理しました。",
] as const;

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
  const normalized = normalizeGeneratedText(text, maxLength);
  if (!normalized) return "";
  if (containsSentenceLikeEnglish(normalized)) return "";
  if (!isJapanesePrimaryText(normalized)) return "";
  return normalized;
}

function normalizeForCompare(text: string) {
  return String(text ?? "")
    .replace(/\s+/g, "")
    .replace(/[。．！？、,]/g, "")
    .trim();
}

function normalizeGuardianSourceText(raw: string | null | undefined) {
  return String(raw ?? "")
    .replace(/\r/g, "\n")
    .split(/[\n/／]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildGuardianSalutation(guardianNames: string | null | undefined) {
  const first = normalizeGuardianSourceText(guardianNames)[0] ?? "";
  const cleaned = first
    .replace(/^(父|母|保護者|ご家族|祖父|祖母)\s*[:：]\s*/u, "")
    .replace(/様$/u, "")
    .trim();
  if (!cleaned) {
    return "保護者様、いつも大変お世話になっております。";
  }
  const surname = cleaned.split(/\s+/)[0]?.trim() || cleaned;
  return `${surname}様、いつも大変お世話になっております。`;
}

function buildTeacherIntroduction(organizationName?: string | null, teacherName?: string | null) {
  const organization = String(organizationName ?? "").trim();
  const teacher = String(teacherName ?? "").trim();

  if (organization && teacher) {
    return `担当講師をさせていただいております、${organization}の${teacher}です。`;
  }
  if (teacher) {
    return `担当講師をさせていただいております、${teacher}です。`;
  }
  if (organization) {
    return `担当講師より、${organization}からご報告いたします。`;
  }
  return "担当講師よりご報告いたします。";
}

function buildSignatureLines(organizationName?: string | null, teacherName?: string | null) {
  const lines: string[] = [];
  const organization = String(organizationName ?? "").trim();
  const teacher = String(teacherName ?? "").trim();
  if (organization) lines.push(organization);
  if (teacher) lines.push(`担当講師 ${teacher}`);
  return lines;
}

function isSameYearMonth(left: Date, right: Date) {
  return left.getUTCFullYear() === right.getUTCFullYear() && left.getUTCMonth() === right.getUTCMonth();
}

function buildReportLead(studentName: string, periodFrom: string, periodTo: string, createdAt: string) {
  const createdDate = new Date(`${createdAt}T00:00:00.000Z`);
  const fromDate = new Date(`${periodFrom}T00:00:00.000Z`);
  const toDate = new Date(`${periodTo}T00:00:00.000Z`);

  if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime()) && isSameYearMonth(fromDate, toDate)) {
    if (isSameYearMonth(toDate, createdDate)) {
      return `今月の${studentName}さんのご様子について、ご報告いたします。`;
    }
    return `${toDate.getUTCMonth() + 1}月の${studentName}さんのご様子について、ご報告いたします。`;
  }

  return `この期間の${studentName}さんのご様子について、ご報告いたします。`;
}

function buildReportContext(input: ReportInput, createdAt: string, periodFrom: string, periodTo: string): ReportContext {
  return {
    createdAt,
    periodFrom,
    periodTo,
    salutation: buildGuardianSalutation(input.guardianNames),
    selfIntroduction: buildTeacherIntroduction(input.organizationName, input.teacherName),
    reportLead: buildReportLead(input.studentName, periodFrom, periodTo, createdAt),
    signatureLines: buildSignatureLines(input.organizationName, input.teacherName),
  };
}

function buildReportEvidenceLogs(input: ReportInput): ReportEvidenceLog[] {
  return input.logs.map((log) => {
    const bundleLog: ReportBundleLog = buildReportBundleLog({
      id: log.id,
      sessionId: log.sessionId ?? null,
      date: log.date,
      mode: log.mode,
      subType: log.subType ?? null,
      sessionType: log.mode,
      artifactJson: log.artifactJson,
      summaryMarkdown: log.summaryMarkdown,
    });

    return {
      id: log.id,
      date: log.date,
      mode: log.mode,
      theme: bundleLog.operationalLog.theme,
      facts: bundleLog.operationalLog.facts,
      changes: bundleLog.operationalLog.changes,
      assessment: bundleLog.operationalLog.assessment,
      nextChecks: bundleLog.operationalLog.nextChecks,
      parentShare: bundleLog.operationalLog.parentShare,
      derivedMarkdown: renderConversationArtifactOrFallback(log.artifactJson, log.summaryMarkdown).trim(),
    };
  });
}

function buildEvidencePrompt(logs: ReportEvidenceLog[]) {
  return logs
    .map((log, index) =>
      [
        `# Log ${index + 1}`,
        `id: ${log.id}`,
        `date: ${log.date}`,
        `mode: ${log.mode}`,
        `theme: ${log.theme || "なし"}`,
        `facts: ${log.facts.join(" / ") || "なし"}`,
        `changes: ${log.changes.join(" / ") || "なし"}`,
        `assessment: ${log.assessment.join(" / ") || "なし"}`,
        `nextChecks: ${log.nextChecks.join(" / ") || "なし"}`,
        `parentShare: ${log.parentShare.join(" / ") || "なし"}`,
        "derivedMarkdown:",
        log.derivedMarkdown || "なし",
      ].join("\n")
    )
    .join("\n\n");
}

function reportBodyCharCount(report: ParentReportJson) {
  return [report.openingParagraph, ...report.detailParagraphs, report.closingParagraph]
    .join("")
    .replace(/\s+/g, "")
    .length;
}

function countParagraphs(report: ParentReportJson) {
  return [report.openingParagraph, ...report.detailParagraphs, report.closingParagraph].filter(Boolean).length;
}

function collectNormalizedParagraphs(report: ParentReportJson) {
  return [report.openingParagraph, ...report.detailParagraphs, report.closingParagraph]
    .map((paragraph) => normalizeForCompare(paragraph))
    .filter(Boolean);
}

function hasMarkdownLikeHeading(report: ParentReportJson) {
  return [report.openingParagraph, ...report.detailParagraphs, report.closingParagraph].some((paragraph) =>
    /(^|\n)\s*(##|###|[-*]\s+|\d+\.\s+)/m.test(paragraph)
  );
}

function containsGenericPhrase(text: string) {
  return GENERIC_REPORT_PHRASES.some((phrase) => normalizeForCompare(text).includes(normalizeForCompare(phrase)));
}

function evaluateParentReportQuality(report: ParentReportJson, fallback: ParentReportJson) {
  const issues: string[] = [];
  const normalizedParagraphs = collectNormalizedParagraphs(report);
  const distinctParagraphs = new Set(normalizedParagraphs);

  if (report.openingParagraph === fallback.openingParagraph) {
    issues.push("opening_is_generic");
  }
  if (report.detailParagraphs.filter((paragraph, index) => paragraph === fallback.detailParagraphs[index]).length >= 2) {
    issues.push("body_is_too_generic");
  }
  if (containsGenericPhrase(report.openingParagraph) || report.detailParagraphs.some(containsGenericPhrase)) {
    issues.push("generic_phrases_remain");
  }
  if (reportBodyCharCount(report) < 750) {
    issues.push("report_is_too_short");
  }
  if (countParagraphs(report) < 5 || report.detailParagraphs.length < 3) {
    issues.push("too_few_paragraphs");
  }
  if (distinctParagraphs.size < normalizedParagraphs.length) {
    issues.push("paragraphs_are_repetitive");
  }
  if (hasMarkdownLikeHeading(report)) {
    issues.push("contains_headings_or_bullets");
  }
  if (!report.openingParagraph.includes("感じています") && !report.openingParagraph.includes("時間になりました")) {
    issues.push("opening_needs_better_tone");
  }
  if (!report.closingParagraph.includes("見てまいります") && !report.closingParagraph.includes("支えてまいります")) {
    issues.push("closing_needs_commitment");
  }

  return issues;
}

function buildParentReportRepairPrompt(input: {
  context: ReportContext;
  bundlePreview: string;
  evidencePrompt: string;
  previousReport: ParentReportJson;
  issues: string[];
}) {
  const labels = input.issues.map((issue) => {
    if (issue === "opening_is_generic") return "- 全体の出だしが弱く、今月の見立てが見えにくい";
    if (issue === "body_is_too_generic") return "- 本文に定型文が残り、今回の話としての具体性が足りない";
    if (issue === "generic_phrases_remain") return "- 汎用的な言い回しが残っていて、先生の手紙らしさが弱い";
    if (issue === "report_is_too_short") return "- 分量が足りず、判断理由や成長の説明が浅い";
    if (issue === "too_few_paragraphs") return "- 段落数が少なく、流れが単調";
    if (issue === "paragraphs_are_repetitive") return "- 同じ内容の言い換えが多い";
    if (issue === "contains_headings_or_bullets") return "- 見出しや箇条書きが混ざっている";
    if (issue === "opening_needs_better_tone") return "- 冒頭のトーンが硬く、手紙としての温度が足りない";
    if (issue === "closing_needs_commitment") return "- 締めに今後どう伴走するかが弱い";
    return `- ${issue}`;
  });

  return `前回案は、保護者に送る手紙としてまだ弱いです。より自然で具体的な本文に書き直してください。

固定で差し込まれる行:
- 宛名: ${input.context.salutation}
- 自己紹介: ${input.context.selfIntroduction}
- リード: ${input.context.reportLead}
- 署名: ${input.context.signatureLines.join(" / ") || "なし"}

前回案:
${JSON.stringify(input.previousReport, null, 2)}

直したい点:
${labels.join("\n")}

選択中ログの束ね品質:
${input.bundlePreview}

選択ログ詳細:
${input.evidencePrompt}

必須ルール:
- 見出し禁止、箇条書き禁止、説明口調禁止
- 「こういう事実があり、だからこう見ていて、次はこう支える」という流れにする
- 科目や教材や迷いがあるなら、判断理由まで丁寧に書く
- 本人の気持ちや成長を 1 段落できちんと扱う
- 来月・次回で何を意識するかを 1 段落ではっきり書く
- 入力にないことは足さない
- JSON object のみで返す`;
}

async function callReportModel(systemPrompt: string, userPrompt: string) {
  return generateJsonObject({
    model: REPORT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_output_tokens: 4200,
    json_schema: {
      name: "parent_report_letter_body",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: "string" },
          openingParagraph: { type: "string" },
          detailParagraphs: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: { type: "string" },
          },
          closingParagraph: { type: "string" },
        },
        required: ["date", "openingParagraph", "detailParagraphs", "closingParagraph"],
      },
    },
  });
}

function renderParentReportMarkdown(report: ParentReportJson) {
  const lines: string[] = [
    report.salutation,
    report.selfIntroduction,
    "",
    report.reportLead,
    report.openingParagraph,
    "",
  ];

  for (const paragraph of report.detailParagraphs) {
    lines.push(paragraph);
    lines.push("");
  }

  lines.push(report.closingParagraph);

  if (report.signatureLines.length > 0) {
    lines.push("");
    for (const line of report.signatureLines) {
      lines.push(line);
    }
  }

  return renderMarkdownDocument(lines);
}

function defaultReportDraft(createdAt: string): ParentReportDraftJson {
  return {
    date: createdAt,
    openingParagraph:
      "今月は、目先の不安に振り回されるのではなく、いまの学習の進め方を丁寧に整えながら、土台を固めていく段階に入ってきたと感じています。",
    detailParagraphs: DEFAULT_DETAIL_PARAGRAPHS.map((paragraph) => paragraph),
    closingParagraph:
      "引き続き、安心して前を向きながら自分に合うやり方を積み上げていけるよう、丁寧に見てまいります。今後ともどうぞよろしくお願いいたします。",
  };
}

function sanitizeParentReportJson(
  value: ParentReportDraftJson | null | undefined,
  fallbackDraft: ParentReportDraftJson,
  context: ReportContext
): ParentReportJson {
  const rawParagraphs = Array.isArray(value?.detailParagraphs) ? value?.detailParagraphs : [];
  const detailParagraphs = rawParagraphs
    .map((paragraph) => sanitizeReportText(paragraph, 760))
    .filter(Boolean)
    .slice(0, 5);

  while (detailParagraphs.length < 3) {
    detailParagraphs.push(fallbackDraft.detailParagraphs[detailParagraphs.length] ?? fallbackDraft.detailParagraphs.at(-1) ?? "");
  }

  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.date ?? "")) ? String(value?.date) : fallbackDraft.date,
    salutation: context.salutation,
    selfIntroduction: context.selfIntroduction,
    reportLead: context.reportLead,
    openingParagraph: sanitizeReportText(value?.openingParagraph, 420) || fallbackDraft.openingParagraph,
    detailParagraphs,
    closingParagraph: sanitizeReportText(value?.closingParagraph, 260) || fallbackDraft.closingParagraph,
    signatureLines: context.signatureLines,
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
  const periodFrom = input.periodFrom ?? createdAt;
  const periodTo = input.periodTo ?? createdAt;
  const context = buildReportContext(input, createdAt, periodFrom, periodTo);
  const evidenceLogs = buildReportEvidenceLogs(input);
  const evidencePrompt = buildEvidencePrompt(evidenceLogs);
  const { bundleQualityEval } = buildReportBundle(input);

  const systemPrompt = `あなたは、塾の担当講師が保護者へ送る月次レターの専任編集者です。
出力は JSON object のみで、本文は必ず自然な日本語で書いてください。

これは「保護者レポート」ですが、読み味は説明書ではなく「先生から保護者に送る丁寧な手紙」です。
固定の宛名・自己紹介・署名は別で差し込まれるため、あなたは本文だけを書きます。

本文の理想像:
- 温度感はやわらかいが、内容は具体的
- ただの要約ではなく、先生が見て感じた現在地と次の方針が伝わる
- 「頑張っていました」で終わらせず、なぜそう見立てたかまで書く
- 学習法の迷い、教材の扱い、気持ちの揺れ、前向きな変化を丁寧につなぐ
- 不安や課題を書くときも、必要以上に煽らず、その意味づけまで書く

絶対ルール:
- 見出し禁止
- 箇条書き禁止
- Markdown 記法禁止
- 「今回の要点」「以下の通り」などの説明口調禁止
- 英語禁止
- 選択ログにない事実を足さない
- structuredArtifact 由来の事実を優先し、derivedMarkdown は補足にだけ使う
- 本文は openingParagraph 1本、detailParagraphs 3〜5本、closingParagraph 1本で返す
- openingParagraph では、その月の全体像を落ち着いた筆致で示す
- detailParagraphs では、少なくとも次の役割を重複なく入れる:
  1) 科目・教材・学習法の迷いと、その判断理由
  2) 本人の受け止め方や成長の見立て
  3) いま積み上がっていることと、次に意識すること
- closingParagraph では、今後どう伴走するかを丁寧に伝える

目標の雰囲気:
- 「今月は〜と感じています」
- 「〜という話をしました」
- 「〜段階に入ってきているように思います」
- 「引き続き、〜できるよう丁寧に見てまいります」

JSON schema:
{
  "date": "YYYY-MM-DD",
  "openingParagraph": "本文1段落目",
  "detailParagraphs": ["本文2段落目", "本文3段落目", "本文4段落目"],
  "closingParagraph": "最後の締め段落"
}`;

  const userPrompt = `固定で差し込まれる行:
- 宛名: ${context.salutation}
- 自己紹介: ${context.selfIntroduction}
- リード: ${context.reportLead}
- 署名: ${context.signatureLines.join(" / ") || "なし"}

生徒名: ${input.studentName}
対象期間: ${periodFrom}〜${periodTo}
作成日: ${createdAt}

選択中ログの束ね品質:
${buildBundlePreview(bundleQualityEval)}

選択ログ詳細:
${evidencePrompt}

書き方の指示:
- 1段落目では、この期間がどんな時間だったかを先生の見立てとしてまとめる
- 2〜3段落目では、科目や教材や学習法の迷いと、その判断理由を丁寧に書く
- 4段落目では、本人の不安、前向きさ、以前との違いなど、内面の変化を書く
- 5段落目では、今できていることと、次に意識したいことを整理する
- 最後は、引き続きどう支えるかを丁寧に伝える
- どの段落も、保護者が読んだときに「ちゃんと見てくれている」と感じる密度にする
- 同じことの言い換えを繰り返さない`;

  const firstCall = await callReportModel(systemPrompt, userPrompt);
  const fallbackDraft = defaultReportDraft(createdAt);
  const fallbackReport = sanitizeParentReportJson(fallbackDraft, fallbackDraft, context);
  let reportJson = sanitizeParentReportJson(readGeneratedJson<ParentReportDraftJson>(firstCall), fallbackDraft, context);
  let apiCalls = 1;
  let tokenUsage = firstCall.usage ?? emptyLlmTokenUsage();
  const qualityIssues = evaluateParentReportQuality(reportJson, fallbackReport);

  if (qualityIssues.length > 0) {
    const retryCall = await callReportModel(
      systemPrompt,
      buildParentReportRepairPrompt({
        context,
        bundlePreview: buildBundlePreview(bundleQualityEval),
        evidencePrompt,
        previousReport: reportJson,
        issues: qualityIssues,
      })
    );
    const retryReportJson = sanitizeParentReportJson(
      readGeneratedJson<ParentReportDraftJson>(retryCall),
      fallbackDraft,
      context
    );
    const retryIssues = evaluateParentReportQuality(
      retryReportJson,
      fallbackReport
    );

    if (retryIssues.length <= qualityIssues.length) {
      reportJson = retryReportJson;
    }

    apiCalls += 1;
    tokenUsage = addLlmTokenUsage(tokenUsage, retryCall.usage ?? emptyLlmTokenUsage());
  }

  const markdown = renderParentReportMarkdown(reportJson);
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
