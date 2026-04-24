import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type EvalMode = "INTERVIEW";

export type EvalCase = {
  id: string;
  mode: EvalMode;
  title: string;
  studentName: string;
  teacherName: string;
  sessionDate: string;
  minSummaryChars: number;
  transcript: string;
  reviewedTranscript?: string;
  reviewedMinScoreDelta?: number;
};

export type SectionRule = {
  heading: string;
  kind: "bullets" | "paragraphs" | "contains";
  minCount?: number;
  mustInclude?: string[];
};

export type EvalRubricCase = {
  id: string;
  modeLabel: string;
  requiredHeadings: string[];
  requiredKeywords: string[];
  forbiddenPhrases: string[];
  sectionRules: SectionRule[];
};

export type EvalRubric = {
  scoreThreshold: number;
  cases: EvalRubricCase[];
};

type EvalResult = {
  case: EvalCase;
  rubric: EvalRubricCase;
  summaryMarkdown: string;
  sourceLabel: "raw" | "reviewed";
  model: string;
  apiCalls: number;
  evidenceChars: number;
  usedFallback: boolean;
  inputTokensEstimate: number;
  score: number;
  passed: boolean;
  headingMatches: string[];
  missingHeadings: string[];
  keywordHits: string[];
  missingKeywords: string[];
  forbiddenHits: string[];
  unsupportedHits: string[];
  sectionReports: Array<{
    heading: string;
    present: boolean;
    kind: SectionRule["kind"];
    lineCount: number;
    bulletCount: number;
    paragraphCount: number;
    missingMustInclude: string[];
    passed: boolean;
  }>;
  sectionMap: Array<{
    heading: string;
    body: string;
  }>;
  comparison?: {
    rawScore: number;
    reviewedScore: number;
    scoreDelta: number;
    minScoreDelta: number;
    passed: boolean;
  };
};

const ROOT = process.cwd();
const FIXTURE_DIR = path.join(ROOT, "fixtures", "conversation-eval");
const CASES_PATH = path.join(FIXTURE_DIR, "cases.json");
const RUBRIC_PATH = path.join(FIXTURE_DIR, "rubric.json");

export function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (typeof process.env[key] === "undefined" || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return readFile(filePath, "utf8").then((raw) => JSON.parse(raw) as T);
}

function normalizeLine(text: string) {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function normalizeHeading(text: string) {
  return normalizeLine(text).replace(/[■#]/g, "").replace(/[：:]+$/g, "").trim();
}

function splitNonEmptyLines(text: string) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractSections(markdown: string) {
  const sections: Array<{ heading: string; body: string }> = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of markdown.replace(/\r/g, "").split("\n")) {
    const trimmed = line.trimEnd();
    const headingMatch = trimmed.match(/^(?:■|##)\s+(.+)$/);
    if (headingMatch) {
      if (current) {
        sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
      }
      current = { heading: normalizeHeading(headingMatch[1]), lines: [] };
      continue;
    }
    if (current) {
      current.lines.push(trimmed);
    }
  }

  if (current) {
    sections.push({ heading: current.heading, body: current.lines.join("\n").trim() });
  }

  return sections;
}

function countBulletLines(body: string) {
  return splitNonEmptyLines(body).filter((line) => /^[-*・•]\s+/.test(line)).length;
}

function countParagraphs(body: string) {
  return body
    .replace(/\r/g, "")
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function countTextMatches(text: string, needles: string[]) {
  const hits = needles.filter((needle) => normalizeLine(text).includes(normalizeLine(needle)));
  return { hits, missing: needles.filter((needle) => !hits.includes(needle)) };
}

const DEFAULT_ALLOWED_TERMS = new Set([
  "基本情報",
  "サマリー",
  "指導サマリー",
  "ポジティブ",
  "改善",
  "対策",
  "必要",
  "話題",
  "保護者",
  "共有",
  "ポイント",
  "本日の",
  "指導",
  "要約",
  "課題",
  "成果",
  "設計",
  "次回",
  "宿題",
  "確認",
  "連携",
  "室長",
  "講師",
  "生徒",
  "理解",
  "状況",
  "学習",
  "方針",
  "整理",
  "具体",
  "安心",
  "注意",
  "特記事項",
  "現状",
  "背景",
  "指導成果",
  "学習方針",
  "共有連携事項",
  "授業前",
  "授業中",
  "授業後",
  "理解状況",
  "残課題",
  "英語長文",
  "再現確認",
  "学校名修正",
  "過去問",
  "条件整理",
  "数列",
  "ベクトル",
  "再現",
  "判断",
  "対象生徒",
  "面談日",
  "指導日",
  "面談時間",
  "教科単元",
  "担当チューター",
  "面談目的",
  "教務責任者",
  "室長向け要約",
  "課題と指導成果",
  "学習方針と次回アクション",
  "室長他講師への共有連携事項",
]);

const GENERIC_UNSUPPORTED_TERM_RE =
  /^(?:生徒名|担当講師|講師名|対象生徒|面談日|実施日|面談時間|教科・単元|主な扱い科目|扱った単元|学習内容|進路方針|生活面|確認事項|到達点|方針|共有ポイント|連携事項|自学習|テスト|現時点|短期的|基礎事項|確認対象|改善確認|授業内|授業前|授業後|授業冒頭|授業冒頭時点|前回宿題|宿題対応時|生徒本人|本記録内)$/;

function comparableTerm(text: string) {
  return normalizeLine(text)
    .replace(/[ 　\t]/g, "")
    .replace(/[・･\-ー_]/g, "")
    .replace(/[()（）「」『』【】\[\]、。，．！？!?:：;；]/g, "")
    .toLowerCase();
}

function isMetaOrEvidenceLine(line: string) {
  const normalized = normalizeLine(line);
  if (!normalized) return true;
  if (/^(■|##)\s+/.test(normalized)) return true;
  if (/^根拠[:：]/.test(normalized)) return true;
  if (/^(生徒名|担当講師|講師名|対象生徒|面談日|実施日|面談時間|教科・単元|面談目的|主な扱い科目|扱った単元|生活面で確認した事項)[:：]/.test(normalized)) {
    return true;
  }
  if (/^---+$/.test(normalized)) return true;
  return false;
}

function extractCandidateTerms(text: string) {
  const candidates: string[] = [];
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    const line = normalizeLine(rawLine);
    if (!line || isMetaOrEvidenceLine(line)) continue;
    const body = line.replace(/^(現状（Before）|成果（After）|※特記事項|生徒|次回までの宿題|次回の確認（テスト）事項)[:：]\s*/, "");
    for (const match of body.match(/[一-龯ァ-ヶーA-Za-z0-9]{3,}/g) ?? []) {
      candidates.push(match);
    }
  }
  return Array.from(new Set(candidates.map(normalizeLine).filter(Boolean)));
}

function looksLikeConcreteNamedTerm(term: string) {
  if (/\d/.test(term)) return true;
  if (/[ァ-ヶー]{4,}/.test(term)) return true;
  return /(学校|学園|学院|高校|中学|大学|模試|試験|過去問|校舎|先生|くん|さん|塾|英検|TOEIC|共通テスト|数列|ベクトル|微分|積分|長文)/.test(term);
}

function collectUnsupportedHits(summaryMarkdown: string, sourceTranscript: string, allowedTerms: string[]) {
  const normalizedSource = comparableTerm(sourceTranscript);
  const sourceTerms = extractCandidateTerms(sourceTranscript).map(comparableTerm).filter(Boolean);
  const allowed = new Set<string>([
    ...DEFAULT_ALLOWED_TERMS,
    ...allowedTerms.map((term) => normalizeLine(term)),
  ]);
  const seen = new Set<string>();
  const hits: string[] = [];
  for (const match of extractCandidateTerms(summaryMarkdown)) {
    const term = normalizeLine(match);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    if (allowed.has(term)) continue;
    if (GENERIC_UNSUPPORTED_TERM_RE.test(term)) continue;
    if (!looksLikeConcreteNamedTerm(term)) continue;
    const comparable = comparableTerm(term);
    if (!comparable) continue;
    if (normalizedSource.includes(comparable)) continue;
    const roughlySupported = sourceTerms.some((sourceTerm) => {
      if (!sourceTerm) return false;
      if (sourceTerm.includes(comparable) || comparable.includes(sourceTerm)) return true;
      return sourceTerm.length >= 2 && comparable.length >= 2 && (
        sourceTerm.slice(0, 2) === comparable.slice(0, 2) ||
        sourceTerm.slice(-2) === comparable.slice(-2)
      );
    });
    if (roughlySupported) continue;
    hits.push(term);
  }
  return hits;
}

function buildAllowedMetadataTerms(testCase: EvalCase) {
  const terms = [testCase.studentName, testCase.teacherName, testCase.sessionDate];
  if (testCase.sessionDate) {
    const date = new Date(testCase.sessionDate);
    if (!Number.isNaN(date.getTime())) {
      terms.push(String(date.getFullYear()));
      terms.push(String(date.getMonth() + 1));
      terms.push(String(date.getDate()));
      terms.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
    }
  }
  return terms.filter((term): term is string => typeof term === "string" && term.trim().length > 0);
}

function evaluateCase(summaryMarkdown: string, rubric: EvalRubricCase, config: EvalRubric, meta: {
  model: string;
  apiCalls: number;
  evidenceChars: number;
  usedFallback: boolean;
  inputTokensEstimate: number;
  case: EvalCase;
  sourceTranscript: string;
  sourceLabel: "raw" | "reviewed";
}): EvalResult {
  const normalized = normalizeLine(summaryMarkdown);
  const sections = extractSections(summaryMarkdown);
  const sectionMap = sections;
  const unsupportedHits = collectUnsupportedHits(summaryMarkdown, meta.sourceTranscript, [
    ...rubric.requiredHeadings,
    ...rubric.requiredKeywords,
    ...rubric.forbiddenPhrases,
    ...buildAllowedMetadataTerms(meta.case),
  ]);
  const headingMatches = rubric.requiredHeadings.filter((heading) =>
    sections.some((section) => normalizeHeading(section.heading) === normalizeHeading(heading))
  );
  const missingHeadings = rubric.requiredHeadings.filter((heading) => !headingMatches.includes(heading));

  const keywordHits = rubric.requiredKeywords.filter((keyword) => normalized.includes(keyword));
  const missingKeywords = rubric.requiredKeywords.filter((keyword) => !keywordHits.includes(keyword));
  const forbiddenHits = rubric.forbiddenPhrases.filter((phrase) => normalized.includes(phrase));

  const sectionReports = rubric.sectionRules.map((rule) => {
    const section = sections.find((item) => normalizeHeading(item.heading) === normalizeHeading(rule.heading));
    const body = section?.body ?? "";
    const lineCount = splitNonEmptyLines(body).length;
    const bulletCount = countBulletLines(body);
    const paragraphCount = countParagraphs(body);
    const includeCheck = rule.mustInclude ? countTextMatches(body, rule.mustInclude) : { hits: [], missing: [] };
    let passed = Boolean(section);
    if (rule.kind === "bullets") passed = passed && bulletCount >= (rule.minCount ?? 1);
    if (rule.kind === "paragraphs") passed = passed && paragraphCount >= (rule.minCount ?? 1);
    if (rule.kind === "contains") passed = passed && (rule.mustInclude ?? []).every((needle) => body.includes(needle));
    if (rule.mustInclude && includeCheck.missing.length > 0) passed = false;
    return {
      heading: rule.heading,
      present: Boolean(section),
      kind: rule.kind,
      lineCount,
      bulletCount,
      paragraphCount,
      missingMustInclude: includeCheck.missing,
      passed,
    };
  });

  let score = 100;
  score -= missingHeadings.length * 10;
  score -= missingKeywords.length * 5;
  score -= forbiddenHits.length * 10;
  score -= unsupportedHits.length * 8;
  if (meta.usedFallback && unsupportedHits.length > 0) score -= 6;
  score -= sectionReports.filter((report) => !report.passed).length * 8;
  if (meta.usedFallback) score -= 10;
  if (normalized.length < meta.case.minSummaryChars) score -= 5;
  score = Math.max(0, Math.min(100, score));

  return {
    case: meta.case,
    rubric,
    summaryMarkdown,
    sourceLabel: meta.sourceLabel,
    model: meta.model,
    apiCalls: meta.apiCalls,
    evidenceChars: meta.evidenceChars,
    usedFallback: meta.usedFallback,
    inputTokensEstimate: meta.inputTokensEstimate,
    score,
    passed: score >= config.scoreThreshold,
    headingMatches,
    missingHeadings,
    keywordHits,
    missingKeywords,
    forbiddenHits,
    unsupportedHits,
    sectionReports,
    sectionMap,
  };
}

function renderSectionBody(body: string) {
  const trimmed = body.trim();
  return trimmed || "（空）";
}

function renderCaseReport(result: EvalResult) {
  const lines: string[] = [];
  lines.push(`## ${result.rubric.modeLabel} / ${result.case.id}`);
  lines.push(`- タイトル: ${result.case.title}`);
  lines.push(`- 判定: ${result.passed ? "PASS" : "FAIL"} (${result.score}/100)`);
  lines.push(`- モデル: ${result.model}`);
  lines.push(`- API 呼び出し回数: ${result.apiCalls}`);
  lines.push(`- フォールバック使用: ${result.usedFallback ? "あり" : "なし"}`);
  lines.push(`- 入力ソース: ${result.sourceLabel === "reviewed" ? "reviewed transcript" : "raw transcript"}`);
  lines.push(`- 事前推定トークン: ${result.inputTokensEstimate}`);
  lines.push(`- 証拠文字数: ${result.evidenceChars}`);
  lines.push("");
  lines.push("### 入力");
  lines.push(`- 生徒: ${result.case.studentName}`);
  lines.push(`- 講師: ${result.case.teacherName}`);
  lines.push(`- 日付: ${result.case.sessionDate}`);
  lines.push(`- 最低文字数目安: ${result.case.minSummaryChars}`);
  lines.push("```text");
  lines.push(result.case.transcript.trim());
  lines.push("```");
  lines.push("");
  lines.push("### 判定基準");
  lines.push(`- 必須見出し: ${result.rubric.requiredHeadings.join(" / ")}`);
  lines.push(`- 必須キーワード: ${result.rubric.requiredKeywords.join(" / ")}`);
  lines.push(`- 禁止語: ${result.rubric.forbiddenPhrases.join(" / ") || "なし"}`);
  lines.push("");
  lines.push("### チェック");
  lines.push(`- 見出し: ${result.missingHeadings.length === 0 ? "OK" : `NG (${result.missingHeadings.join(", ")})`}`);
  lines.push(`- キーワード: ${result.missingKeywords.length === 0 ? "OK" : `NG (${result.missingKeywords.join(", ")})`}`);
  lines.push(`- 禁止語: ${result.forbiddenHits.length === 0 ? "OK" : `NG (${result.forbiddenHits.join(", ")})`}`);
  lines.push(`- unsupported claim: ${result.unsupportedHits.length === 0 ? "OK" : `NG (${result.unsupportedHits.join(", ")})`}`);
  for (const section of result.sectionReports) {
    lines.push(`- ${section.heading}: ${section.passed ? "OK" : "NG"}`);
  }
  if (result.comparison) {
    lines.push("");
    lines.push("### reviewed transcript 比較");
    lines.push(`- raw score: ${result.comparison.rawScore}`);
    lines.push(`- reviewed score: ${result.comparison.reviewedScore}`);
    lines.push(`- score delta: ${result.comparison.scoreDelta >= 0 ? "+" : ""}${result.comparison.scoreDelta}`);
    lines.push(`- required delta: ${result.comparison.minScoreDelta}`);
    lines.push(`- 判定: ${result.comparison.passed ? "OK" : "NG"}`);
  }
  lines.push("");
  lines.push("### セクション");
  for (const section of result.sectionMap) {
    lines.push(`#### ${section.heading}`);
    lines.push("```md");
    lines.push(renderSectionBody(section.body));
    lines.push("```");
  }
  lines.push("");
  return lines.join("\n");
}

function renderReport(results: EvalResult[], threshold: number) {
  const passedCount = results.filter((result) => result.passed).length;
  const lines: string[] = [];
  lines.push("# 会話ログ生成評価");
  lines.push(`- 判定しきい値: ${threshold}`);
  lines.push(`- 合格件数: ${passedCount}/${results.length}`);
  lines.push("");
  for (const result of results) {
    lines.push(renderCaseReport(result));
  }
  return lines.join("\n");
}

export async function loadConversationEvalFixtures() {
  loadEnvFile(path.join(ROOT, ".env"));
  loadEnvFile(path.join(ROOT, ".env.local"));
  const [cases, rubric, pipeline] = await Promise.all([
    readJsonFile<EvalCase[]>(CASES_PATH),
    readJsonFile<EvalRubric>(RUBRIC_PATH),
    import("../../lib/ai/conversationPipeline"),
  ]);
  return { cases, rubric, pipeline };
}

export async function runConversationEval(outPath?: string | null) {
  const { cases, rubric, pipeline } = await loadConversationEvalFixtures();
  const { generateConversationDraftFast, getPromptVersion } = pipeline;
  const rubricById = new Map(rubric.cases.map((item) => [item.id, item]));

  const results: EvalResult[] = [];
  for (const testCase of cases.filter((item) => item.mode === "INTERVIEW")) {
    const caseRubric = rubricById.get(testCase.id);
    if (!caseRubric) {
      throw new Error(`Rubric not found for case: ${testCase.id}`);
    }

    const rawOutput = await generateConversationDraftFast({
      transcript: testCase.transcript,
      studentName: testCase.studentName,
      teacherName: testCase.teacherName,
      sessionDate: testCase.sessionDate,
      minSummaryChars: testCase.minSummaryChars,
      sessionType: testCase.mode,
    });

    const rawResult = evaluateCase(rawOutput.summaryMarkdown, caseRubric, rubric, {
      model: rawOutput.model,
      apiCalls: rawOutput.apiCalls,
      evidenceChars: rawOutput.evidenceChars,
      usedFallback: rawOutput.usedFallback,
      inputTokensEstimate: rawOutput.inputTokensEstimate,
      case: testCase,
      sourceTranscript: testCase.transcript,
      sourceLabel: "raw",
    });

    if (!testCase.reviewedTranscript) {
      results.push(rawResult);
      continue;
    }

    const reviewedOutput = await generateConversationDraftFast({
      transcript: testCase.reviewedTranscript,
      studentName: testCase.studentName,
      teacherName: testCase.teacherName,
      sessionDate: testCase.sessionDate,
      minSummaryChars: testCase.minSummaryChars,
      sessionType: testCase.mode,
    });

    const reviewedResult = evaluateCase(reviewedOutput.summaryMarkdown, caseRubric, rubric, {
      model: reviewedOutput.model,
      apiCalls: reviewedOutput.apiCalls,
      evidenceChars: reviewedOutput.evidenceChars,
      usedFallback: reviewedOutput.usedFallback,
      inputTokensEstimate: reviewedOutput.inputTokensEstimate,
      case: testCase,
      sourceTranscript: testCase.reviewedTranscript,
      sourceLabel: "reviewed",
    });

    const minScoreDelta = testCase.reviewedMinScoreDelta ?? 0;
    const scoreDelta = reviewedResult.score - rawResult.score;
    const comparisonPassed = scoreDelta >= minScoreDelta;

    results.push({
      ...reviewedResult,
      passed: reviewedResult.passed && comparisonPassed,
      comparison: {
        rawScore: rawResult.score,
        reviewedScore: reviewedResult.score,
        scoreDelta,
        minScoreDelta,
        passed: comparisonPassed,
      },
    });
  }

  const report = [
    `Prompt version: ${getPromptVersion()}`,
    renderReport(results, rubric.scoreThreshold),
  ].join("\n\n");

  if (outPath) {
    const target = path.resolve(outPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, report, "utf8");
  }

  return {
    report,
    failed: results.some((result) => !result.passed),
  };
}
