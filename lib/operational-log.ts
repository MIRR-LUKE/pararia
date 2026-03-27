import {
  buildConversationArtifactFromMarkdown,
  parseConversationArtifact,
  splitActionEntries,
} from "@/lib/conversation-artifact";

export type OperationalLogInput = {
  sessionType?: string | null;
  createdAt?: string | Date | null;
  artifactJson?: unknown;
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
  followUpChecks: string[];
  parentPoints: string[];
  warnings: string[];
  suggestedLogIds: string[];
};

function normalizeWhitespace(text: string) {
  return String(text ?? "")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*・•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function firstSentences(values: string[], limit: number) {
  return dedupe(values).slice(0, limit).map(ensureSentence).filter((line) => Boolean(line));
}

export function buildOperationalLog(input: OperationalLogInput): OperationalLog {
  const sessionType = input.sessionType === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW";
  const artifact =
    parseConversationArtifact(input.artifactJson) ??
    (input.summaryMarkdown ? buildConversationArtifactFromMarkdown({ sessionType, summaryMarkdown: input.summaryMarkdown, generatedAt: input.createdAt }) : null);

  if (artifact) {
    const splitActions = splitActionEntries(artifact.nextActions);
    const assessmentTexts =
      artifact.assessment.length > 0 ? artifact.assessment : splitActions.assessment.map((entry) => entry.text);
    const nextCheckTexts =
      artifact.nextChecks.length > 0 ? artifact.nextChecks : splitActions.nextChecks.map((entry) => entry.text);
    const theme = ensureSentence(artifact.summary[0]?.text ?? "");
    return {
      theme,
      facts: firstSentences(artifact.summary.map((entry) => entry.text), 4),
      changes: firstSentences(artifact.claims.map((entry) => entry.text), 4),
      assessment: firstSentences(assessmentTexts, 4),
      nextChecks: firstSentences(nextCheckTexts, 4),
      parentShare: firstSentences(artifact.sharePoints.map((entry) => entry.text), 4),
    };
  }

  return {
    theme: "",
    facts: [],
    changes: [],
    assessment: [],
    nextChecks: [],
    parentShare: [],
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
  const weakElements = distinct(selectedLogs.flatMap((log) => log.operationalLog.assessment)).slice(0, 5);
  const followUpChecks = distinct(selectedLogs.flatMap((log) => log.operationalLog.nextChecks)).slice(0, 5);
  const parentPoints = distinct(selectedLogs.flatMap((log) => log.operationalLog.parentShare)).slice(0, 5);

  const warnings: string[] = [];
  if (selectedLogs.length === 0) warnings.push("ログが未選択です。");
  if (!hasMode(selectedLogs, "INTERVIEW")) warnings.push("面談ログが含まれていません。");
  if (!hasMode(selectedLogs, "LESSON_REPORT")) warnings.push("指導報告ログが含まれていません。");
  if (parentPoints.length === 0) warnings.push("保護者共有に使える明確な要点が少ないです。");
  if (followUpChecks.length === 0) warnings.push("次回確認事項が少なく、次の観察ポイントが見えにくいです。");

  const selectedIds = new Set(selectedLogs.map((log) => log.id));
  const suggestedLogIds = candidateLogs
    .filter((log) => !selectedIds.has(log.id))
    .filter((log) => {
      if (!hasMode(selectedLogs, "INTERVIEW") && log.mode === "INTERVIEW") return true;
      if (!hasMode(selectedLogs, "LESSON_REPORT") && log.mode === "LESSON_REPORT") return true;
      if (parentPoints.length === 0 && log.operationalLog.parentShare.length > 0) return true;
      if (followUpChecks.length === 0 && log.operationalLog.nextChecks.length > 0) return true;
      if (weakElements.length === 0 && log.operationalLog.assessment.length > 0) return true;
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
    followUpChecks,
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
    `今回の判断・補足: ${evalResult.weakElements.join(" / ") || "なし"}`,
    `次回確認: ${evalResult.followUpChecks.join(" / ") || "なし"}`,
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
    operationalLog: buildOperationalLog({
      ...input,
      artifactJson: input.artifactJson,
    }),
  };
}
