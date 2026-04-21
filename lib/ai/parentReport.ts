import {
  buildBundlePreview,
  buildBundleQualityEval,
  buildStrictReportBundleLog,
  type BundleQualityEval,
} from "@/lib/operational-log";
import {
  addLlmTokenUsage,
  emptyLlmTokenUsage,
  generateJsonObject,
  readGeneratedJson,
  type LlmTokenUsage,
} from "@/lib/ai/structured-generation";
import {
  buildEvidencePrompt,
  buildReportContext,
  buildReportEvidenceLogs,
  defaultReportDraft,
  type ParentReportDraftJson,
  type ParentReportJson,
  type ReportInput,
  renderParentReportMarkdown,
  sanitizeParentReportJson,
} from "./parentReport.content";
import { buildParentReportRepairPrompt, evaluateParentReportQuality } from "./parentReport.quality";
import { generateSmokeParentReport, isSmokeParentReportEnabled } from "./parentReport.smoke";

const REPORT_PRIMARY_MODEL =
  process.env.LLM_MODEL_REPORT ||
  process.env.LLM_MODEL_REPORT_PRIMARY ||
  "gpt-4o-mini";

const REPORT_REPAIR_MODEL =
  process.env.LLM_MODEL_REPORT_REPAIR ||
  process.env.LLM_MODEL_FINAL ||
  process.env.LLM_MODEL ||
  "gpt-5.4";

const REPORT_PRIMARY_TIMEOUT_MS = Number(process.env.LLM_REPORT_TIMEOUT_MS ?? 20000);
const REPORT_REPAIR_TIMEOUT_MS = Number(process.env.LLM_REPORT_REPAIR_TIMEOUT_MS ?? 30000);
const REPORT_PRIMARY_MAX_OUTPUT_TOKENS = 2200;
const REPORT_REPAIR_MAX_OUTPUT_TOKENS = 2600;

const REPORT_REPAIR_REQUIRED_ISSUES = new Set([
  "opening_is_generic",
  "body_is_too_generic",
  "generic_phrases_remain",
  "report_is_too_short",
  "too_few_paragraphs",
  "paragraphs_are_repetitive",
  "contains_headings_or_bullets",
  "body_has_checklist_tone",
  "phase_paragraph_is_too_operational",
  "growth_impression_needs_anchor",
  "growth_summary_needs_anchor",
  "closing_needs_commitment",
  "closing_contains_fixed_greeting",
  "closing_is_too_operational",
  "closing_is_repetitive",
]);

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

export function buildReportBundle(input: ReportInput) {
  const selected = input.logs.map((log) =>
    buildStrictReportBundleLog({
      id: log.id,
      sessionId: log.sessionId ?? null,
      date: log.date,
      mode: log.mode,
      subType: log.subType ?? null,
      sessionType: log.mode,
      artifactJson: log.artifactJson,
    })
  );

  return {
    selected,
    bundleQualityEval: buildBundleQualityEval(selected, selected),
  };
}

function shouldRepairReport(issues: string[]) {
  return issues.some((issue) => REPORT_REPAIR_REQUIRED_ISSUES.has(issue));
}

async function callReportModel(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
  maxOutputTokens: number;
}) {
  return generateJsonObject({
    model: params.model,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    temperature: 0.3,
    timeoutMs: params.timeoutMs,
    max_output_tokens: params.maxOutputTokens,
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

export async function generateParentReport(input: ReportInput): Promise<ParentReportResult> {
  const createdAt = new Date().toISOString().slice(0, 10);
  const periodFrom = input.periodFrom ?? createdAt;
  const periodTo = input.periodTo ?? createdAt;
  const context = buildReportContext(input, createdAt, periodFrom, periodTo);
  const evidenceLogs = buildReportEvidenceLogs(input);
  const evidencePrompt = buildEvidencePrompt(evidenceLogs);
  const { bundleQualityEval } = buildReportBundle(input);

  if (isSmokeParentReportEnabled()) {
    return generateSmokeParentReport({
      createdAt,
      context,
      evidenceLogs,
      bundleQualityEval,
    });
  }

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

  const firstCall = await callReportModel({
    model: REPORT_PRIMARY_MODEL,
    systemPrompt,
    userPrompt,
    timeoutMs: REPORT_PRIMARY_TIMEOUT_MS,
    maxOutputTokens: REPORT_PRIMARY_MAX_OUTPUT_TOKENS,
  });
  const fallbackDraft = defaultReportDraft(createdAt);
  const fallbackReport = sanitizeParentReportJson(fallbackDraft, fallbackDraft, context);
  let reportJson = sanitizeParentReportJson(readGeneratedJson<ParentReportDraftJson>(firstCall), fallbackDraft, context);
  let apiCalls = 1;
  let tokenUsage = firstCall.usage ?? emptyLlmTokenUsage();
  const qualityIssues = evaluateParentReportQuality(reportJson, fallbackReport);

  if (qualityIssues.length > 0 && shouldRepairReport(qualityIssues)) {
    const retryCall = await callReportModel({
      model: REPORT_REPAIR_MODEL,
      systemPrompt,
      userPrompt: buildParentReportRepairPrompt({
        context,
        bundlePreview: buildBundlePreview(bundleQualityEval),
        evidencePrompt,
        previousReport: reportJson,
        issues: qualityIssues,
      }),
      timeoutMs: REPORT_REPAIR_TIMEOUT_MS,
      maxOutputTokens: REPORT_REPAIR_MAX_OUTPUT_TOKENS,
    });
    const retryReportJson = sanitizeParentReportJson(readGeneratedJson<ParentReportDraftJson>(retryCall), fallbackDraft, context);
    const retryIssues = evaluateParentReportQuality(retryReportJson, fallbackReport);

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
      model: apiCalls > 1 ? REPORT_REPAIR_MODEL : REPORT_PRIMARY_MODEL,
      apiCalls,
      retried: apiCalls > 1,
      tokenUsage,
    },
  };
}
