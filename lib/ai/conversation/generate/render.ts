import {
  splitActionEntries,
  type ConversationArtifact,
  type ConversationArtifactEntry,
  type ConversationArtifactSection,
} from "@/lib/conversation-artifact";
import { formatSessionDateLabel, formatStudentLabel, formatTeacherLabel } from "../shared";
import type { DraftGenerationInput, SessionMode } from "../types";
import {
  ensureMinimum,
  formatInterviewDateLabel,
  formatDurationLabel,
  normalizeEntryList,
  normalizeText,
  ensureSentenceEnding,
  stripEntryLabelPrefix,
  wrapJapaneseParagraph,
} from "./normalize";

function renderEntryLines(entries: ConversationArtifactEntry[], options?: { forceLabel?: string }) {
  const lines: string[] = [];
  for (const entry of entries) {
    const prefix =
      options?.forceLabel
        ? `${options.forceLabel}: `
        : entry.claimType === "observed"
          ? "観察: "
          : entry.claimType === "inferred"
            ? "推測: "
            : entry.claimType === "missing"
              ? "不足: "
              : entry.actionType === "nextCheck"
                ? "次回確認: "
                : entry.actionType === "assessment"
                  ? "判断: "
                  : "";
    lines.push(`- ${prefix}${entry.text}`);
    for (const evidence of entry.evidence.slice(0, 2)) {
      lines.push(`根拠: ${evidence}`);
    }
  }
  return lines;
}

function renderInterviewSummaryLines(entries: ConversationArtifactEntry[]) {
  const lines: string[] = [];
  for (const entry of entries) {
    const paragraph = ensureSentenceEnding(stripEntryLabelPrefix(entry.text));
    if (!paragraph) continue;
    lines.push(...wrapJapaneseParagraph(paragraph));
    lines.push("");
  }
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function renderInterviewBulletLines(entries: ConversationArtifactEntry[]) {
  return entries
    .map((entry) => ensureSentenceEnding(stripEntryLabelPrefix(entry.text)))
    .filter(Boolean)
    .map((text) => `- ${text}`);
}

function renderInterviewOptionalSectionLines(entries: ConversationArtifactEntry[], emptyMessage: string) {
  const lines = renderInterviewBulletLines(entries);
  return lines.length > 0 ? lines : [emptyMessage];
}

function buildBasicInfoLines(sessionType: SessionMode, input: DraftGenerationInput, basicInfo?: Record<string, unknown> | null) {
  return [
    `対象生徒: ${normalizeText(basicInfo?.student, 40) || formatStudentLabel(input.studentName)} 様`,
    `面談日: ${formatInterviewDateLabel(typeof basicInfo?.date === "string" ? basicInfo.date : null) || normalizeText(basicInfo?.date, 32) || formatSessionDateLabel(input.sessionDate) || "未記録"}`,
    `面談時間: ${formatDurationLabel(input.durationMinutes)}`,
    `担当チューター: ${normalizeText(basicInfo?.teacher, 40) || formatTeacherLabel(input.teacherName)}`,
    `テーマ: ${normalizeText(basicInfo?.purpose, 64) || "学習状況の確認と次回方針の整理"}`,
  ];
}

function buildSectionsFromEntries(
  sessionType: SessionMode,
  basicInfoLines: string[],
  summary: ConversationArtifactEntry[],
  claims: ConversationArtifactEntry[],
  nextActions: ConversationArtifactEntry[],
  sharePoints: ConversationArtifactEntry[]
) {
  const actionSplit = splitActionEntries(nextActions);
  const strategyEntries = actionSplit.assessment;
  const nextTopicEntries = actionSplit.nextChecks;
  return [
    { key: "basic_info", title: "基本情報", lines: basicInfoLines },
    { key: "summary", title: "1. サマリー", lines: renderInterviewSummaryLines(summary) },
    {
      key: "details",
      title: "2. 学習状況と課題分析",
      lines: renderInterviewOptionalSectionLines(claims, "今回の面談では、学習状況や課題として追加で整理できる話はしていませんでした。"),
    },
    {
      key: "actions",
      title: "3. 今後の対策・指導内容",
      lines: renderInterviewOptionalSectionLines(strategyEntries, "今回の面談では、具体的な対策や指導方針までは話していませんでした。"),
    },
    {
      key: "share",
      title: "4. 志望校に関する検討事項",
      lines: renderInterviewOptionalSectionLines(sharePoints, "今回の面談では、志望校や進路の具体的な話はしていませんでした。"),
    },
    {
      key: "unknown",
      title: "5. 次回のお勧め話題",
      lines: renderInterviewOptionalSectionLines(nextTopicEntries, "今回の面談では、次回に向けた具体的な確認項目までは話していませんでした。"),
    },
  ] satisfies ConversationArtifactSection[];
}

export function buildArtifactFromStructuredPayload(
  sessionType: SessionMode,
  input: DraftGenerationInput,
  payload: {
    basicInfo?: Record<string, unknown> | null;
    summary?: unknown;
    claims?: unknown;
    nextActions?: unknown;
    sharePoints?: unknown;
  }
) {
  const basicInfo = payload.basicInfo ?? null;
  const summary = ensureMinimum(
    normalizeEntryList(
      payload.summary,
      { maxTextChars: 360, includeLabelInText: false },
      4
    ),
    [],
    2
  );

  const claims = ensureMinimum(
    normalizeEntryList(payload.claims, { defaultClaimType: "observed", maxTextChars: 220, includeLabelInText: false }, 8),
    [],
    3
  );

  const nextActions = ensureMinimum(
    normalizeEntryList(
      payload.nextActions,
      {
        defaultClaimType: "missing",
        defaultActionType: "assessment",
        maxTextChars: 220,
        includeLabelInText: false,
      },
      8
    ),
    [],
    3
  );

  const sharePoints = ensureMinimum(
    normalizeEntryList(payload.sharePoints, { maxTextChars: 220, includeLabelInText: false }, 6),
    [],
    1
  );

  const interviewSignalCount = claims.length + nextActions.length + sharePoints.length;
  if (summary.length < 1 || interviewSignalCount < 2) {
    return null;
  }

  const sections = buildSectionsFromEntries(
    sessionType,
    buildBasicInfoLines(sessionType, input, basicInfo),
    summary,
    claims,
    nextActions,
    sharePoints
  );
  const actionSplit = splitActionEntries(nextActions);

  return {
    version: "conversation-artifact/v1",
    sessionType,
    generatedAt: new Date().toISOString(),
    summary,
    claims,
    nextActions,
    sharePoints,
    facts: summary.map((entry) => entry.text).slice(0, 8),
    changes: claims.map((entry) => entry.text).slice(0, 8),
    assessment: actionSplit.assessment.map((entry) => entry.text).slice(0, 8),
    nextChecks: actionSplit.nextChecks.map((entry) => entry.text).slice(0, 8),
    sections,
  } satisfies ConversationArtifact;
}
