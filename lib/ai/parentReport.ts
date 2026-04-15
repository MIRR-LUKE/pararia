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
  studentReferenceName: string;
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
  "英語や社会など、それぞれの科目で迷いが出ていた点については、いま大事にすべきやり方を一つずつ整理し、途中で方法を増やしすぎない方針を確認しました。",
  "受験勉強では、目先の不安からやり方を変え続けるより、自分に合った方法を定めて積み上げていくことの方が、最終的には安定した力につながることが多いです。",
  "本人の気持ちの面についても、ただ不安を抱えるのではなく、自分がどこに向かいたいのかを考えながら前に進もうとしている変化が見えてきました。",
  "今できていることや積み上がってきていることもきちんと確認しながら、小さな成功体験を重ねていけるよう、次回以降も特に意識して見ていきます。",
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

function splitStudentName(studentName: string) {
  return String(studentName ?? "")
    .trim()
    .split(/[\s\u3000]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildStudentReferenceName(studentName: string) {
  const parts = splitStudentName(studentName);
  const base = parts.length >= 2 ? parts[parts.length - 1] : String(studentName ?? "").trim();
  return base ? `${base}さん` : "生徒さん";
}

function buildGuardianSalutation(guardianNames: string | null | undefined, studentName: string) {
  const first = normalizeGuardianSourceText(guardianNames)[0] ?? "";
  const cleaned = first
    .replace(/^(父|母|保護者|ご家族|祖父|祖母)\s*[:：]\s*/u, "")
    .replace(/様$/u, "")
    .trim();
  if (cleaned) {
    const surname = cleaned.split(/\s+/)[0]?.trim() || cleaned;
    return `${surname}様、いつも大変お世話になっております。`;
  }

  const studentSurname = splitStudentName(studentName)[0] ?? "";
  if (studentSurname) {
    return `${studentSurname}様、いつも大変お世話になっております。`;
  }

  if (!cleaned) {
    return "保護者様、いつも大変お世話になっております。";
  }
  return "保護者様、いつも大変お世話になっております。";
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
    return `${organization}よりご報告いたします。`;
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
  const referenceName = buildStudentReferenceName(studentName);

  if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime()) && isSameYearMonth(fromDate, toDate)) {
    if (isSameYearMonth(toDate, createdDate)) {
      return `今月の${referenceName}のご様子について、ご報告いたします。`;
    }
    return `${toDate.getUTCMonth() + 1}月の${referenceName}のご様子について、ご報告いたします。`;
  }

  return `この期間の${referenceName}のご様子について、ご報告いたします。`;
}

function buildReportContext(input: ReportInput, createdAt: string, periodFrom: string, periodTo: string): ReportContext {
  const studentReferenceName = buildStudentReferenceName(input.studentName);
  return {
    createdAt,
    periodFrom,
    periodTo,
    studentReferenceName,
    salutation: buildGuardianSalutation(input.guardianNames, input.studentName),
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

function hasOddJapaneseSpacing(text: string) {
  return /[ぁ-んァ-ヶ一-龠]\s+[ぁ-んァ-ヶ一-龠]/.test(text);
}

function countSentences(text: string) {
  return String(text ?? "")
    .split(/[。！？]/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function evaluateParentReportQuality(report: ParentReportJson, fallback: ParentReportJson) {
  const issues: string[] = [];
  const normalizedParagraphs = collectNormalizedParagraphs(report);
  const distinctParagraphs = new Set(normalizedParagraphs);
  const paragraphs = [report.openingParagraph, ...report.detailParagraphs, report.closingParagraph];
  const paragraphLengths = [report.openingParagraph, ...report.detailParagraphs, report.closingParagraph]
    .map((paragraph) => paragraph.replace(/\s+/g, "").length)
    .filter((length) => length > 0);
  const longestParagraph = paragraphLengths.length > 0 ? Math.max(...paragraphLengths) : 0;
  const shortestParagraph = paragraphLengths.length > 0 ? Math.min(...paragraphLengths) : 0;

  if (report.openingParagraph === fallback.openingParagraph) {
    issues.push("opening_is_generic");
  }
  if (report.openingParagraph.replace(/\s+/g, "").length > 110) {
    issues.push("opening_is_too_long");
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
  if (countParagraphs(report) < 6 || report.detailParagraphs.length < 4) {
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
  if (paragraphs.some(hasOddJapaneseSpacing)) {
    issues.push("contains_odd_spacing");
  }
  if (report.detailParagraphs.some((paragraph) => /次回は|確認します|チェックします|どこまで/.test(paragraph))) {
    issues.push("body_has_checklist_tone");
  }
  if (report.detailParagraphs.some((paragraph) => countSentences(paragraph) > 4)) {
    issues.push("paragraph_has_too_many_sentences");
  }
  if (/(ネクステージ|実況中継|全レベル問題集|音読|音声)/.test(report.detailParagraphs[1] ?? "")) {
    issues.push("phase_paragraph_is_too_operational");
  }
  if (!/今月特に印象的だったのは|印象的だったのは/.test(report.detailParagraphs[2] ?? "")) {
    issues.push("growth_impression_needs_anchor");
  }
  if (!/今月の成長として大きかったのは|成長として大きかった/.test(report.detailParagraphs[3] ?? "")) {
    issues.push("growth_summary_needs_anchor");
  }
  if (longestParagraph >= 420) {
    issues.push("paragraph_is_too_long");
  }
  if (shortestParagraph > 0 && longestParagraph >= 320 && shortestParagraph <= 130 && longestParagraph / shortestParagraph >= 2.2) {
    issues.push("paragraph_length_is_unbalanced");
  }
  if (!report.closingParagraph.includes("見てまいります") && !report.closingParagraph.includes("支えてまいります")) {
    issues.push("closing_needs_commitment");
  }
  if (/今後ともどうぞよろしくお願いいたします/.test(report.closingParagraph)) {
    issues.push("closing_contains_fixed_greeting");
  }
  if (/次回は|確認します|一緒に確かめ/.test(report.closingParagraph)) {
    issues.push("closing_is_too_operational");
  }
  if (
    (report.closingParagraph.match(/引き続き/g) ?? []).length >= 2 ||
    (report.closingParagraph.match(/見てまいります/g) ?? []).length >= 2 ||
    (report.closingParagraph.match(/伴走してまいります/g) ?? []).length >= 2 ||
    (report.closingParagraph.includes("見てまいります") && report.closingParagraph.includes("伴走してまいります"))
  ) {
    issues.push("closing_is_repetitive");
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
    if (issue === "opening_is_too_long") return "- 冒頭が長く、今月の印象がすっと入ってこない";
    if (issue === "body_is_too_generic") return "- 本文に定型文が残り、今回の話としての具体性が足りない";
    if (issue === "generic_phrases_remain") return "- 汎用的な言い回しが残っていて、先生の手紙らしさが弱い";
    if (issue === "report_is_too_short") return "- 分量が足りず、判断理由や成長の説明が浅い";
    if (issue === "too_few_paragraphs") return "- 段落数が少なく、流れが単調";
    if (issue === "paragraphs_are_repetitive") return "- 同じ内容の言い換えが多い";
    if (issue === "contains_headings_or_bullets") return "- 見出しや箇条書きが混ざっている";
    if (issue === "opening_needs_better_tone") return "- 冒頭のトーンが硬く、手紙としての温度が足りない";
    if (issue === "contains_odd_spacing") return "- 日本語の文中に不自然な空白が混ざっている";
    if (issue === "body_has_checklist_tone") return "- 本文が確認項目の並びのように見えて、手紙の温度が弱い";
    if (issue === "paragraph_has_too_many_sentences") return "- どこかの段落が文を詰め込みすぎていて、息継ぎしにくい";
    if (issue === "phase_paragraph_is_too_operational") return "- 受験期の意味づけを書く段落が、教材や手順の説明に寄りすぎている";
    if (issue === "growth_impression_needs_anchor") return "- 印象的だった成長の段落に、印象の言葉が立っていない";
    if (issue === "growth_summary_needs_anchor") return "- 成長と来月の意識を書く段落の主題が弱い";
    if (issue === "paragraph_is_too_long") return "- どこかの段落が長すぎて、読み切りにくい";
    if (issue === "paragraph_length_is_unbalanced") return "- 段落ごとの長さにムラがあり、流れが重く見える";
    if (issue === "closing_needs_commitment") return "- 締めに今後どう伴走するかが弱い";
    if (issue === "closing_contains_fixed_greeting") return "- 締め段落に定型のあいさつまで入っていて、終わり方が重い";
    if (issue === "closing_is_too_operational") return "- 締めが確認事項の説明になっていて、先生からの言葉として弱い";
    if (issue === "closing_is_repetitive") return "- 締めで同じ約束や同じ言い回しが重なっている";
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
- 本文の4段落は役割を分ける
- 2段落目は科目や教材や学習法の迷いと判断理由
- 3段落目は受験期としての意味づけや、いま大事な段階
- 4段落目は本人の不安や前向きさ、以前との違いなどの成長
- 5段落目は今月の成長として大きかったことと、来月も意識したいこと
- 1段落で話題を詰め込みすぎず、長さに極端なムラを出さない
- 1段落に文を詰め込みすぎず、1段落あたり 3〜4 文を目安にする
- 3段落目では教材名や細かい手順を主役にしない
- 4段落目は「今月特に印象的だったのは、」のように印象が立つ書き出しに寄せる
- 5段落目は「今月の成長として大きかったのは、」のように主題をはっきり立てる
- 締め段落は 1 文だけにして、同じ約束の言い換えを重ねない
- 締め段落に「今後ともどうぞよろしくお願いいたします。」を入れない
- 日本語の文中に不自然な空白を入れない
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
            minItems: 4,
            maxItems: 4,
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
  lines.push("今後ともどうぞよろしくお願いいたします。");

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
      "今月は、ただ勉強量を増やしていくというよりも、自分に合うやり方を見極めながら、焦らず土台を整えていく時間になったと感じています。",
    detailParagraphs: DEFAULT_DETAIL_PARAGRAPHS.map((paragraph) => paragraph),
    closingParagraph:
      "引き続き、安心して前を向き、自分の力をきちんと発揮できるよう、丁寧に見てまいります。",
  };
}

function sanitizeParentReportJson(
  value: ParentReportDraftJson | null | undefined,
  fallbackDraft: ParentReportDraftJson,
  context: ReportContext
): ParentReportJson {
  const rawParagraphs = Array.isArray(value?.detailParagraphs) ? value?.detailParagraphs : [];
  const detailParagraphs = rawParagraphs
    .map((paragraph) => sanitizeReportText(paragraph, 620))
    .filter(Boolean)
    .slice(0, 4);

  while (detailParagraphs.length < 4) {
    detailParagraphs.push(fallbackDraft.detailParagraphs[detailParagraphs.length] ?? fallbackDraft.detailParagraphs.at(-1) ?? "");
  }

  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.date ?? "")) ? String(value?.date) : fallbackDraft.date,
    salutation: context.salutation,
    selfIntroduction: context.selfIntroduction,
    reportLead: context.reportLead,
    openingParagraph: sanitizeReportText(value?.openingParagraph, 220) || fallbackDraft.openingParagraph,
    detailParagraphs,
    closingParagraph: sanitizeReportText(value?.closingParagraph, 160) || fallbackDraft.closingParagraph,
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
見本にしたいのは、今月の印象が最初にすっと伝わり、その後に学習法の判断理由、受験期としての意味づけ、本人の成長、来月に意識したいことが無理なく流れる文章です。

本文の理想像:
- 温度感はやわらかいが、内容は具体的
- ただの要約ではなく、先生が見て感じた現在地と次の方針が伝わる
- 「頑張っていました」で終わらせず、なぜそう見立てたかまで書く
- 学習法の迷い、教材の扱い、気持ちの揺れ、前向きな変化を丁寧につなぐ
- 不安や課題を書くときも、必要以上に煽らず、その意味づけまで書く
- 教材名や手順を細かく説明しすぎず、保護者に届く言葉で整理する
- 「今月特に印象的だったのは」「今月の成長として大きかったのは」のように、印象や成長を言葉にしてよい

絶対ルール:
- 見出し禁止
- 箇条書き禁止
- Markdown 記法禁止
- 「今回の要点」「以下の通り」などの説明口調禁止
- 英語禁止
- 選択ログにない事実を足さない
- structuredArtifact 由来の事実を優先し、derivedMarkdown は補足にだけ使う
- 本文は openingParagraph 1本、detailParagraphs 4本、closingParagraph 1本で返す
- openingParagraph では、その月の全体像を短めに落ち着いた筆致で示す
- 1段落で扱う話題はできるだけ1つに絞り、長すぎる段落を作らない
- 1段落あたり 3〜4 文を目安にし、説明を詰め込みすぎない
- 日本語の文中に不自然な空白を入れない
- detailParagraphs では、次の4つの役割を順番に入れる:
  1) 科目・教材・学習法の迷いと、その判断理由
  2) 受験期としての意味づけや、いま大事な段階の説明
  3) 本人の不安、前向きさ、以前との違い、印象的だった成長
  4) 今月の成長として大きかったことと、来月も意識したいこと
- 3段落目では教材名や細かい手順を主役にしない
- 4段落目は「今月特に印象的だったのは、」のように印象が立つ入り方に寄せる
- 5段落目は「今月の成長として大きかったのは、」のように主題を立てる
- closingParagraph では、今後どう伴走するかを丁寧に伝える
- closingParagraph は 1 文だけにする
- 「引き続き」「見てまいります」「伴走してまいります」などの決まり文句を重ねない
- 「今後ともどうぞよろしくお願いいたします。」は書かない
- 「次回は〜を確認します」のような業務連絡で締めない

目標の雰囲気:
- 「今月は〜と感じています」
- 「〜という話をしました」
- 「〜段階に入ってきているように思います」
- 「引き続き、〜できるよう丁寧に見てまいります」

JSON schema:
{
  "date": "YYYY-MM-DD",
  "openingParagraph": "本文1段落目",
  "detailParagraphs": ["本文2段落目", "本文3段落目", "本文4段落目", "本文5段落目"],
  "closingParagraph": "最後の締め段落"
}`;

  const userPrompt = `固定で差し込まれる行:
- 宛名: ${context.salutation}
- 自己紹介: ${context.selfIntroduction}
- リード: ${context.reportLead}
- 署名: ${context.signatureLines.join(" / ") || "なし"}

生徒フルネーム: ${input.studentName}
本文での呼び方: ${context.studentReferenceName}
対象期間: ${periodFrom}〜${periodTo}
作成日: ${createdAt}

選択中ログの束ね品質:
${buildBundlePreview(bundleQualityEval)}

選択ログ詳細:
${evidencePrompt}

書き方の指示:
- 1段落目では、この期間がどんな時間だったかを先生の見立てとしてまとめる
- 2段落目では、科目や教材や学習法の迷いと、その判断理由を丁寧に書く
- 3段落目では、受験勉強では今どんな段階が大事なのかを、${context.studentReferenceName} の状況に引きつけて書く
- 4段落目では、本人の不安、前向きさ、以前との違いなど、内面の変化を書く
- 5段落目では、今月の成長として大きかったことと、来月も意識したいことを書く
- 最後は、引き続きどう支えるかを 1 文で丁寧に伝える
- 4段落目は「今月特に印象的だったのは、」から始めてもよい
- 5段落目は「今月の成長として大きかったのは、」から始めてもよい
- 本文では ${context.studentReferenceName} という呼び方を優先する
- どの段落も、保護者が読んだときに「ちゃんと見てくれている」と感じる密度にする
- 同じことの言い換えを繰り返さない
- 説明しすぎず、保護者が自然に読み切れるやわらかさを残す
- 段落ごとの長さに極端なムラを出さない
- 締め段落は 1 文だけにして、同じ約束を言い換えて重ねない
- 「今後ともどうぞよろしくお願いいたします。」は書かない`;

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
