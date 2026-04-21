import { emptyLlmTokenUsage } from "@/lib/ai/structured-generation";
import type { BundleQualityEval } from "@/lib/operational-log";
import {
  defaultReportDraft,
  renderParentReportMarkdown,
  sanitizeParentReportJson,
  type ParentReportDraftJson,
  type ParentReportJson,
  type ReportContext,
  type ReportEvidenceLog,
} from "./parentReport.content";

function pickFirst(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const cleaned = String(value ?? "").trim();
    if (cleaned) return cleaned;
  }
  return "";
}

function buildSmokeDraft(params: {
  createdAt: string;
  context: ReportContext;
  evidenceLogs: ReportEvidenceLog[];
}): ParentReportDraftJson {
  const primaryLog = params.evidenceLogs[0];
  const studentReferenceName = params.context.studentReferenceName;
  const mainTheme = pickFirst(
    primaryLog?.theme,
    primaryLog?.facts[0],
    primaryLog?.parentShare[0],
    "学習の進め方を整理すること"
  );
  const learningPoint = pickFirst(
    primaryLog?.assessment[0],
    primaryLog?.facts[0],
    primaryLog?.parentShare[0],
    "今の時期に大事にしたいやり方を一つずつ整理すること"
  );
  const phasePoint = pickFirst(
    primaryLog?.parentShare[0],
    primaryLog?.assessment[0],
    primaryLog?.facts[0],
    "目先の不安でやり方を増やしすぎず、土台を整えること"
  );
  const growthPoint = pickFirst(
    primaryLog?.changes[0],
    primaryLog?.facts[0],
    "自分の状況を以前より言葉にしながら考えられていること"
  );
  const nextPoint = pickFirst(
    primaryLog?.nextChecks[0],
    primaryLog?.assessment[0],
    primaryLog?.parentShare[0],
    "次に確認したい観点を一つずつ積み上げること"
  );

  return {
    date: params.createdAt,
    openingParagraph: `今月は、${mainTheme}を軸に、${studentReferenceName}の現在地と次の進め方を落ち着いて整理していく時間になったと感じています。`,
    detailParagraphs: [
      `${studentReferenceName}の学習面では、${learningPoint}という点を特に大切にしながら、いまのやり方を途中で広げすぎずに進める方針を確認しました。`,
      `受験勉強としても、${phasePoint}という現在地を踏まえ、いま何を優先して積み上げるべきかを丁寧にそろえていくことが大事な段階だと見ています。`,
      `今月特に印象的だったのは、${growthPoint}という変化が見えてきたことです。`,
      `今月の成長として大きかったのは、今の課題を受け止めたうえで次に確認したいことを整理できている点であり、来月も${nextPoint}を意識しながら丁寧に見ていきたいと考えています。`,
    ],
    closingParagraph: `引き続き、${studentReferenceName}が焦らず自分に合う形で積み上げていけるよう、丁寧に見てまいります。`,
  };
}

export function isSmokeParentReportEnabled() {
  return process.env.PARARIA_SMOKE_PARENT_REPORT_FIXTURE === "1";
}

export function generateSmokeParentReport(params: {
  createdAt: string;
  context: ReportContext;
  evidenceLogs: ReportEvidenceLog[];
  bundleQualityEval: BundleQualityEval;
}): {
  markdown: string;
  reportJson: ParentReportJson;
  bundleQualityEval: BundleQualityEval;
  generationMeta: {
    model: string;
    apiCalls: number;
    retried: boolean;
    tokenUsage: ReturnType<typeof emptyLlmTokenUsage>;
  };
} {
  const fallbackDraft = defaultReportDraft(params.createdAt);
  const draft = buildSmokeDraft(params);
  const reportJson = sanitizeParentReportJson(draft, fallbackDraft, params.context);

  return {
    markdown: renderParentReportMarkdown(reportJson),
    reportJson,
    bundleQualityEval: params.bundleQualityEval,
    generationMeta: {
      model: "smoke-fixture:parent-report",
      apiCalls: 0,
      retried: false,
      tokenUsage: emptyLlmTokenUsage(),
    },
  };
}
