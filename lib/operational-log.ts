export type OperationalLogInput = {
  sessionType?: string | null;
  createdAt?: string | Date | null;
  summaryMarkdown?: string | null;
};

export type OperationalLog = {
  theme: string;
  facts: string[];
  changes: string[];
  assessment: string[];
  nextChecks: string[];
  parentShare: string[];
};

export type ReportBundleLog = {
  id: string;
  sessionId?: string | null;
  date: string;
  mode: "INTERVIEW" | "LESSON_REPORT";
  subType?: string | null;
  operationalLog: OperationalLog;
};

export type BundleQualityEval = {
  periodLabel: string;
  logCount: number;
  mainThemes: string[];
  strongElements: string[];
  weakElements: string[];
  parentPoints: string[];
  warnings: string[];
  suggestedLogIds: string[];
};

type SectionKey = keyof OperationalLog;

const SECTION_ALIASES: Record<SectionKey, string[]> = {
  theme: ["1. サマリー", "本日の指導サマリー", "本日の指導サマリー（室長向け要約）"],
  facts: ["1. サマリー", "本日の指導サマリー", "本日の指導サマリー（室長向け要約）"],
  changes: ["2. ポジティブな話題", "2. 課題と指導成果", "2. 課題と指導成果（Before → After）"],
  assessment: ["3. 改善・対策が必要な話題", "3. 学習方針と次回アクション", "3. 学習方針と次回アクション（自学習の設計）"],
  nextChecks: ["3. 改善・対策が必要な話題", "3. 学習方針と次回アクション", "3. 学習方針と次回アクション（自学習の設計）"],
  parentShare: ["4. 保護者への共有ポイント", "4. 室長・他講師への共有・連携事項"],
};

function stripMarkdown(text: string) {
  return text
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*・•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\r/g, "")
    .trim();
}

function normalizeWhitespace(text: string) {
  return stripMarkdown(text).replace(/\s+/g, " ").trim();
}

function normalizeHeading(text: string) {
  return normalizeWhitespace(text).replace(/[：:]/g, "");
}

function ensureSentence(text: string) {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) return cleaned;
  return /[。．！？]$/.test(cleaned) ? cleaned : `${cleaned}。`;
}

function dedupe(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = normalizeWhitespace(String(value ?? ""));
    if (!cleaned) continue;
    const key = cleaned.replace(/[。．！？\s]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function extractLines(markdown?: string | null) {
  return String(markdown ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseSummarySections(markdown?: string | null) {
  const buckets = new Map<SectionKey, string[]>();
  let currentKey: SectionKey | null = null;

  for (const line of extractLines(markdown)) {
    if (line.startsWith("■ ") || line.startsWith("## ")) {
      const heading = normalizeHeading(line.slice(2));
      currentKey =
        (Object.entries(SECTION_ALIASES).find(([, aliases]) =>
          aliases.some((alias) => normalizeHeading(alias) === heading)
        )?.[0] as SectionKey | undefined) ?? null;
      continue;
    }
    if (!currentKey) continue;
    const next = buckets.get(currentKey) ?? [];
    next.push(line);
    buckets.set(currentKey, next);
  }

  return {
    theme: buckets.get("theme") ?? [],
    facts: buckets.get("facts") ?? [],
    changes: buckets.get("changes") ?? [],
    assessment: buckets.get("assessment") ?? [],
    nextChecks: buckets.get("nextChecks") ?? [],
    parentShare: buckets.get("parentShare") ?? [],
  };
}

function fallbackTheme(markdown?: string | null) {
  const lines = extractLines(markdown).filter((line) => !line.startsWith("■ ") && !line.startsWith("## "));
  return ensureSentence(lines[0] ?? "今回のログ要点を整理した");
}

function firstSentences(values: string[], limit: number, fallback: string[]) {
  const lines = dedupe(values).slice(0, limit);
  if (lines.length > 0) return lines.map(ensureSentence);
  return fallback.map(ensureSentence);
}

export function buildOperationalLog(input: OperationalLogInput): OperationalLog {
  const parsed = parseSummarySections(input.summaryMarkdown);
  const theme = parsed.theme.length > 0 ? ensureSentence(parsed.theme[0]) : fallbackTheme(input.summaryMarkdown);

  return {
    theme,
    facts: firstSentences(parsed.facts, 4, [theme]),
    changes: firstSentences(parsed.changes, 4, ["今回の変化はログ本文から確認できる。"]),
    assessment: firstSentences(parsed.assessment, 4, ["次回に向けた判断材料を整理した。"]),
    nextChecks: firstSentences(parsed.nextChecks, 4, ["次回までの実行状況を確認する。"]),
    parentShare: firstSentences(parsed.parentShare, 4, ["保護者共有に必要なポイントをログ本文から整理する。"]),
  };
}

function distinct(values: string[]) {
  return Array.from(new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean)));
}

function formatPeriodLabel(selectedLogs: ReportBundleLog[]) {
  if (selectedLogs.length === 0) return "対象ログなし";
  const sorted = [...selectedLogs]
    .map((log) => log.date)
    .filter(Boolean)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
  if (sorted.length === 0) return "日付未設定";
  if (sorted.length === 1) return sorted[0];
  return `${sorted[0]}〜${sorted[sorted.length - 1]}`;
}

function hasMode(logs: ReportBundleLog[], mode: ReportBundleLog["mode"]) {
  return logs.some((log) => log.mode === mode);
}

export function buildBundleQualityEval(
  selectedLogs: ReportBundleLog[],
  candidateLogs: ReportBundleLog[] = selectedLogs
): BundleQualityEval {
  const mainThemes = distinct(selectedLogs.map((log) => log.operationalLog.theme)).slice(0, 3);
  const strongElements = distinct(
    selectedLogs.flatMap((log) => [...log.operationalLog.facts, ...log.operationalLog.changes])
  ).slice(0, 5);
  const weakElements = distinct(
    selectedLogs.flatMap((log) => [...log.operationalLog.assessment, ...log.operationalLog.nextChecks])
  ).slice(0, 5);
  const parentPoints = distinct(selectedLogs.flatMap((log) => log.operationalLog.parentShare)).slice(0, 5);

  const warnings: string[] = [];
  if (selectedLogs.length === 0) warnings.push("ログが未選択です。");
  if (!hasMode(selectedLogs, "INTERVIEW")) warnings.push("面談ログが含まれていません。");
  if (!hasMode(selectedLogs, "LESSON_REPORT")) warnings.push("指導報告ログが含まれていません。");
  if (parentPoints.length === 0) warnings.push("保護者共有に使える明確な要点が少ないです。");

  const selectedIds = new Set(selectedLogs.map((log) => log.id));
  const suggestedLogIds = candidateLogs
    .filter((log) => !selectedIds.has(log.id))
    .filter((log) => {
      if (!hasMode(selectedLogs, "INTERVIEW") && log.mode === "INTERVIEW") return true;
      if (!hasMode(selectedLogs, "LESSON_REPORT") && log.mode === "LESSON_REPORT") return true;
      if (parentPoints.length === 0 && log.operationalLog.parentShare.length > 0) return true;
      const knownThemes = new Set(mainThemes);
      return !knownThemes.has(log.operationalLog.theme);
    })
    .map((log) => log.id)
    .slice(0, 4);

  return {
    periodLabel: formatPeriodLabel(selectedLogs),
    logCount: selectedLogs.length,
    mainThemes,
    strongElements,
    weakElements,
    parentPoints,
    warnings,
    suggestedLogIds,
  };
}

export function buildBundlePreview(evalResult: BundleQualityEval) {
  const lines = [
    `対象期間: ${evalResult.periodLabel}`,
    `ログ件数: ${evalResult.logCount}件`,
    `主要テーマ: ${evalResult.mainThemes.join(" / ") || "なし"}`,
    `強い材料: ${evalResult.strongElements.join(" / ") || "なし"}`,
    `補いたい観点: ${evalResult.weakElements.join(" / ") || "なし"}`,
    `保護者共有ポイント: ${evalResult.parentPoints.join(" / ") || "なし"}`,
  ];
  if (evalResult.warnings.length > 0) {
    lines.push(`注意: ${evalResult.warnings.join(" / ")}`);
  }
  return lines.join("\n");
}

export function buildReportBundleLog(
  input: OperationalLogInput & {
    id: string;
    sessionId?: string | null;
    date: string;
    mode: "INTERVIEW" | "LESSON_REPORT";
    subType?: string | null;
  }
): ReportBundleLog {
  return {
    id: input.id,
    sessionId: input.sessionId ?? null,
    date: input.date,
    mode: input.mode,
    subType: input.subType ?? null,
    operationalLog: buildOperationalLog(input),
  };
}
