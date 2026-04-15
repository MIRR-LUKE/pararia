import type { ParentReportJson, ReportContext } from "./parentReport.content";
import { containsGenericPhrase, normalizeForCompare, reportBodyCharCount } from "./parentReport.content";

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

function hasOddJapaneseSpacing(text: string) {
  return /[ぁ-んァ-ヶ一-龠]\s+[ぁ-んァ-ヶ一-龠]/.test(text);
}

function countSentences(text: string) {
  return String(text ?? "")
    .split(/[。！？]/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

export function evaluateParentReportQuality(report: ParentReportJson, fallback: ParentReportJson) {
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

export function buildParentReportRepairPrompt(input: {
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
- 2段落目は科目や教材の迷いと判断理由
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

