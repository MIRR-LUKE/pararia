import {
  buildConversationArtifactFromMarkdown,
  parseConversationArtifact,
  type ConversationArtifact,
  type ConversationArtifactEntry,
} from "@/lib/conversation-artifact";

export const CONVERSATION_LOG_QUALITY_META_VERSION = "conversation-log-quality/v1" as const;

export type ConversationLogQualitySignalKey =
  | "studentState"
  | "teacherInteraction"
  | "specificEpisode"
  | "growth"
  | "nextConversation"
  | "concreteness"
  | "sufficientLength"
  | "parentReportReady";

export type ConversationLogQualitySignalLevel = "strong" | "partial" | "missing";

export type ConversationLogQualitySignal = {
  key: ConversationLogQualitySignalKey;
  label: string;
  level: ConversationLogQualitySignalLevel;
  passed: boolean;
  score: number;
  evidenceCount: number;
  samples: string[];
};

export type ConversationLogQualityMeta = {
  version: typeof CONVERSATION_LOG_QUALITY_META_VERSION;
  evaluatedAt: string;
  source: "artifact" | "summaryMarkdown";
  score: number;
  isThinLog: boolean;
  parentReportUsability: "ready" | "usable_with_caution" | "weak";
  reasons: string[];
  signals: Record<ConversationLogQualitySignalKey, ConversationLogQualitySignal>;
  metrics: {
    summaryCharCount: number;
    contentLineCount: number;
    evidenceEntryCount: number;
    sectionCount: number;
    missingSignalCount: number;
    partialSignalCount: number;
  };
};

export type ConversationLogQualityError = {
  version: typeof CONVERSATION_LOG_QUALITY_META_VERSION;
  failedAt: string;
  message: string;
};

export type ConversationLogQualityMetaPatch = {
  logQuality: ConversationLogQualityMeta | null;
  logQualityError: ConversationLogQualityError | null;
};

export type BuildConversationLogQualityInput = {
  artifactJson?: unknown;
  summaryMarkdown?: string | null;
  generatedAt?: string | Date | null;
  evaluatedAt?: string | Date | null;
};

export type ThinConversationLogRate = {
  totalCount: number;
  evaluatedCount: number;
  missingMetaCount: number;
  thinCount: number;
  thinRate: number;
};

const SIGNAL_LABELS: Record<ConversationLogQualitySignalKey, string> = {
  studentState: "生徒の様子",
  teacherInteraction: "先生とのやり取り",
  specificEpisode: "具体的エピソード",
  growth: "成長",
  nextConversation: "次回につながる話",
  concreteness: "抽象的すぎない",
  sufficientLength: "短すぎない",
  parentReportReady: "保護者レポートに使いやすい",
};

const SIGNAL_WEIGHTS: Record<ConversationLogQualitySignalKey, number> = {
  studentState: 1.2,
  teacherInteraction: 1,
  specificEpisode: 1.2,
  growth: 1,
  nextConversation: 1.1,
  concreteness: 1,
  sufficientLength: 1,
  parentReportReady: 1.3,
};

const MISSING_PATTERN =
  /(話していません|触れていません|確認できません|分かりません|見えません|ありませんでした|不明|なし|特になし|情報が少ない|具体的.{0,8}ない|記載なし|未確認)/;
const CONCRETE_PATTERN =
  /([0-9０-９]+|英語|数学|国語|理科|社会|宿題|テスト|模試|過去問|音読|長文|計算|見直し|時間配分|スマホ|睡眠|部活|志望校|単語|解き直し|ノート|学校|塾|授業|教材|ページ|問|点|分|回|週|日|「[^」]+」)/;
const STUDENT_STATE_PATTERN =
  /(生徒|本人|様子|表情|集中|不安|自信|意欲|モチベ|疲れ|眠|困|安心|前向き|つまず|理解|課題|得意|苦手|反応)/;
const INTERACTION_PATTERN =
  /(講師|先生|チューター|教師|担当).{0,18}(聞|確認|提案|促|説明|伝|相談|声|助言|質問)|(生徒|本人).{0,18}(答|話|相談|質問|反応)|講師[:：]|先生[:：]|生徒[:：]/;
const GROWTH_PATTERN = /(成長|伸び|改善|前より|できるよう|安定|変化|定着|進歩|上が|増え|減り|成果|克服)/;
const NEXT_PATTERN = /(次回|次まで|次の|確認|宿題|課題|話題|フォロー|持ち帰|継続|再確認|テスト|やり直し)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toIsoString(value: string | Date | null | undefined) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizeLine(value: unknown) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/^#+\s*/g, "")
    .replace(/^\s*[-*・•]\s+/g, "")
    .replace(/^\s*\d+\.\s+/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeLines(values: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const line = normalizeLine(value);
    if (!line) continue;
    const key = line.replace(/[。．！？\s]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}

function isUsefulLine(line: string) {
  return line.length >= 10 && !MISSING_PATTERN.test(line);
}

function entryTexts(entries: ConversationArtifactEntry[]) {
  return entries.map((entry) => entry.text);
}

function collectArtifactLines(artifact: ConversationArtifact | null, summaryMarkdown?: string | null) {
  if (!artifact) {
    return dedupeLines(String(summaryMarkdown ?? "").split("\n")).filter(isUsefulLine);
  }

  const entries = [...artifact.summary, ...artifact.claims, ...artifact.nextActions, ...artifact.sharePoints];
  return dedupeLines([
    ...artifact.sections.filter((section) => section.key !== "basic_info").flatMap((section) => section.lines),
    ...entryTexts(entries),
    ...entries.flatMap((entry) => entry.evidence),
    ...artifact.facts,
    ...artifact.changes,
    ...artifact.assessment,
    ...artifact.nextChecks,
  ]).filter(isUsefulLine);
}

function collectEntryEvidence(artifact: ConversationArtifact | null) {
  if (!artifact) return [];
  return dedupeLines(
    [...artifact.summary, ...artifact.claims, ...artifact.nextActions, ...artifact.sharePoints].flatMap(
      (entry) => entry.evidence
    )
  ).filter(isUsefulLine);
}

function findSamples(lines: string[], pattern: RegExp, limit = 3) {
  return lines.filter((line) => pattern.test(line)).slice(0, limit);
}

function buildSignal(
  key: ConversationLogQualitySignalKey,
  evidence: string[],
  level: ConversationLogQualitySignalLevel
): ConversationLogQualitySignal {
  const score = level === "strong" ? 1 : level === "partial" ? 0.5 : 0;
  return {
    key,
    label: SIGNAL_LABELS[key],
    level,
    passed: level !== "missing",
    score,
    evidenceCount: evidence.length,
    samples: evidence.slice(0, 3),
  };
}

function levelByEvidence(evidence: string[], strongCount = 2) {
  if (evidence.length >= strongCount) return "strong";
  if (evidence.length === 1) return "partial";
  return "missing";
}

function resolveArtifact(input: BuildConversationLogQualityInput) {
  const parsed = parseConversationArtifact(input.artifactJson);
  if (parsed) return { artifact: parsed, source: "artifact" as const };
  if (input.summaryMarkdown?.trim()) {
    return {
      artifact: buildConversationArtifactFromMarkdown({
        sessionType: "INTERVIEW",
        summaryMarkdown: input.summaryMarkdown,
        generatedAt: input.generatedAt ? toIsoString(input.generatedAt) : undefined,
      }),
      source: "summaryMarkdown" as const,
    };
  }
  return { artifact: null, source: "summaryMarkdown" as const };
}

export function buildConversationLogQualityMeta(
  input: BuildConversationLogQualityInput
): ConversationLogQualityMeta {
  const { artifact, source } = resolveArtifact(input);
  const lines = collectArtifactLines(artifact, input.summaryMarkdown);
  const evidenceLines = collectEntryEvidence(artifact);
  const summaryText = lines.join("\n");
  const concreteLines = lines.filter((line) => CONCRETE_PATTERN.test(line));
  const teacherSeen = lines.some((line) => /(講師|先生|チューター|教師|担当)/.test(line));
  const studentSeen = lines.some((line) => /(生徒|本人)/.test(line));

  const studentStateEvidence = findSamples(lines, STUDENT_STATE_PATTERN);
  const interactionEvidence = findSamples(lines, INTERACTION_PATTERN);
  const specificEvidence = concreteLines.slice(0, 3);
  const growthEvidence = dedupeLines([
    ...(artifact?.changes.filter((line) => GROWTH_PATTERN.test(line)) ?? []),
    ...findSamples(lines, GROWTH_PATTERN),
  ]).slice(0, 3);
  const nextEvidence = dedupeLines([...(artifact?.nextChecks ?? []), ...findSamples(lines, NEXT_PATTERN)]).slice(0, 3);
  const parentEvidence = dedupeLines([
    ...(artifact?.sharePoints.map((entry) => entry.text) ?? []),
    ...(artifact?.sections.find((section) => section.key === "share")?.lines ?? []),
  ]).filter(isUsefulLine);

  const concreteRatio = lines.length > 0 ? concreteLines.length / lines.length : 0;
  const sufficientLevel =
    summaryText.length >= 700 || lines.length >= 9
      ? "strong"
      : summaryText.length >= 420 || lines.length >= 6
        ? "partial"
        : "missing";
  const concreteLevel =
    concreteLines.length >= 3 && concreteRatio >= 0.35
      ? "strong"
      : concreteLines.length >= 1 && concreteRatio >= 0.2
        ? "partial"
        : "missing";
  const interactionLevel =
    interactionEvidence.length >= 2 || (teacherSeen && studentSeen)
      ? "strong"
      : interactionEvidence.length === 1 || evidenceLines.length >= 1
        ? "partial"
        : "missing";

  const signals: Record<ConversationLogQualitySignalKey, ConversationLogQualitySignal> = {
    studentState: buildSignal("studentState", studentStateEvidence, levelByEvidence(studentStateEvidence)),
    teacherInteraction: buildSignal("teacherInteraction", interactionEvidence, interactionLevel),
    specificEpisode: buildSignal("specificEpisode", specificEvidence, levelByEvidence(specificEvidence)),
    growth: buildSignal("growth", growthEvidence, levelByEvidence(growthEvidence, 1)),
    nextConversation: buildSignal("nextConversation", nextEvidence, levelByEvidence(nextEvidence, 1)),
    concreteness: buildSignal("concreteness", concreteLines, concreteLevel),
    sufficientLength: buildSignal("sufficientLength", lines, sufficientLevel),
    parentReportReady: buildSignal("parentReportReady", parentEvidence, levelByEvidence(parentEvidence, 1)),
  };

  const weightedScore = Object.values(signals).reduce(
    (sum, signal) => sum + signal.score * SIGNAL_WEIGHTS[signal.key],
    0
  );
  const maxScore = Object.values(SIGNAL_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const score = Math.round((weightedScore / maxScore) * 100);
  const missingSignalCount = Object.values(signals).filter((signal) => signal.level === "missing").length;
  const partialSignalCount = Object.values(signals).filter((signal) => signal.level === "partial").length;
  const criticalMissingCount = [
    signals.studentState,
    signals.specificEpisode,
    signals.nextConversation,
    signals.parentReportReady,
  ].filter((signal) => signal.level === "missing").length;
  const isThinLog = score < 62 || missingSignalCount >= 3 || criticalMissingCount >= 2;
  const parentReportUsability =
    score >= 75 && signals.parentReportReady.passed && signals.nextConversation.passed
      ? "ready"
      : score >= 55 && signals.sufficientLength.passed
        ? "usable_with_caution"
        : "weak";

  return {
    version: CONVERSATION_LOG_QUALITY_META_VERSION,
    evaluatedAt: toIsoString(input.evaluatedAt),
    source,
    score,
    isThinLog,
    parentReportUsability,
    reasons: Object.values(signals)
      .filter((signal) => signal.level !== "strong")
      .map((signal) => `${signal.label}: ${signal.level === "partial" ? "弱い" : "不足"}`),
    signals,
    metrics: {
      summaryCharCount: summaryText.length,
      contentLineCount: lines.length,
      evidenceEntryCount: evidenceLines.length,
      sectionCount: artifact?.sections.length ?? 0,
      missingSignalCount,
      partialSignalCount,
    },
  };
}

export function buildConversationLogQualityMetaPatch(
  input: BuildConversationLogQualityInput,
  opts?: { build?: typeof buildConversationLogQualityMeta }
): ConversationLogQualityMetaPatch {
  try {
    return {
      logQuality: (opts?.build ?? buildConversationLogQualityMeta)(input),
      logQualityError: null,
    };
  } catch (error) {
    return {
      logQuality: null,
      logQualityError: {
        version: CONVERSATION_LOG_QUALITY_META_VERSION,
        failedAt: toIsoString(input.evaluatedAt),
        message: error instanceof Error ? error.message : String(error ?? "unknown error"),
      },
    };
  }
}

export function readConversationLogQualityMeta(value: unknown): ConversationLogQualityMeta | null {
  const candidate = isRecord(value) && value.version === CONVERSATION_LOG_QUALITY_META_VERSION ? value : null;
  const nested = isRecord(value) && isRecord(value.logQuality) ? value.logQuality : candidate;
  if (!isRecord(nested)) return null;
  if (nested.version !== CONVERSATION_LOG_QUALITY_META_VERSION) return null;
  if (typeof nested.isThinLog !== "boolean" || typeof nested.score !== "number") return null;
  return nested as ConversationLogQualityMeta;
}

export function calculateThinConversationLogRate(logs: unknown[]): ThinConversationLogRate {
  let evaluatedCount = 0;
  let thinCount = 0;

  for (const log of logs) {
    const metaSource = isRecord(log) && "qualityMetaJson" in log ? log.qualityMetaJson : log;
    const meta = readConversationLogQualityMeta(metaSource);
    if (!meta) continue;
    evaluatedCount += 1;
    if (meta.isThinLog) thinCount += 1;
  }

  return {
    totalCount: logs.length,
    evaluatedCount,
    missingMetaCount: logs.length - evaluatedCount,
    thinCount,
    thinRate: evaluatedCount === 0 ? 0 : thinCount / evaluatedCount,
  };
}
