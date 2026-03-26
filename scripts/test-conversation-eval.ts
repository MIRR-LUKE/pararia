import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Mode = "INTERVIEW" | "LESSON_REPORT";

type EvalCase = {
  id: string;
  mode: Mode;
  title: string;
  studentName: string;
  teacherName: string;
  sessionDate: string;
  minSummaryChars: number;
  transcript: string;
};

type SectionRule = {
  heading: string;
  kind: "bullets" | "paragraphs" | "contains";
  minCount?: number;
  mustInclude?: string[];
};

type EvalRubricCase = {
  id: string;
  modeLabel: string;
  requiredHeadings: string[];
  requiredKeywords: string[];
  forbiddenPhrases: string[];
  sectionRules: SectionRule[];
};

type EvalRubric = {
  scoreThreshold: number;
  cases: EvalRubricCase[];
};

type EvalResult = {
  case: EvalCase;
  rubric: EvalRubricCase;
  summaryMarkdown: string;
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
};

const ROOT = process.cwd();
const FIXTURE_DIR = path.join(ROOT, "fixtures", "conversation-eval");
const CASES_PATH = path.join(FIXTURE_DIR, "cases.json");
const RUBRIC_PATH = path.join(FIXTURE_DIR, "rubric.json");

function loadEnvFile(filePath: string) {
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

function readJsonFile<T>(filePath: string): Promise<T> {
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

function evaluateCase(summaryMarkdown: string, rubric: EvalRubricCase, config: EvalRubric, meta: {
  model: string;
  apiCalls: number;
  evidenceChars: number;
  usedFallback: boolean;
  inputTokensEstimate: number;
  case: EvalCase;
}): EvalResult {
  const normalized = normalizeLine(summaryMarkdown);
  const sections = extractSections(summaryMarkdown);
  const sectionMap = sections;
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
  score -= sectionReports.filter((report) => !report.passed).length * 8;
  if (meta.usedFallback) score -= 10;
  if (normalized.length < meta.case.minSummaryChars) score -= 5;
  score = Math.max(0, Math.min(100, score));

  return {
    case: meta.case,
    rubric,
    summaryMarkdown,
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
  for (const section of result.sectionReports) {
    lines.push(`- ${section.heading}: ${section.passed ? "OK" : "NG"}`);
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

async function main() {
  loadEnvFile(path.join(ROOT, ".env"));
  loadEnvFile(path.join(ROOT, ".env.local"));

  const args = process.argv.slice(2);
  let outPath: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--out") {
      outPath = args[index + 1] ?? null;
      index += 1;
    }
  }

  const [cases, rubric, pipeline] = await Promise.all([
    readJsonFile<EvalCase[]>(CASES_PATH),
    readJsonFile<EvalRubric>(RUBRIC_PATH),
    import("../lib/ai/conversationPipeline"),
  ]);

  const { generateConversationDraftFast, getPromptVersion } = pipeline;
  const rubricById = new Map(rubric.cases.map((item) => [item.id, item]));

  const results: EvalResult[] = [];
  for (const testCase of cases) {
    const caseRubric = rubricById.get(testCase.id);
    if (!caseRubric) {
      throw new Error(`Rubric not found for case: ${testCase.id}`);
    }

    const output = await generateConversationDraftFast({
      transcript: testCase.transcript,
      studentName: testCase.studentName,
      teacherName: testCase.teacherName,
      sessionDate: testCase.sessionDate,
      minSummaryChars: testCase.minSummaryChars,
      sessionType: testCase.mode,
    });

    results.push(
      evaluateCase(output.summaryMarkdown, caseRubric, rubric, {
        model: output.model,
        apiCalls: output.apiCalls,
        evidenceChars: output.evidenceChars,
        usedFallback: output.usedFallback,
        inputTokensEstimate: output.inputTokensEstimate,
        case: testCase,
      })
    );
  }

  const report = [
    `Prompt version: ${getPromptVersion()}`,
    renderReport(results, rubric.scoreThreshold),
  ].join("\n\n");

  if (outPath) {
    const target = path.resolve(outPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, report, "utf8");
    console.log(`conversation eval report written to ${target}`);
  } else {
    process.stdout.write(`${report}\n`);
  }

  const failed = results.some((result) => !result.passed);
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
