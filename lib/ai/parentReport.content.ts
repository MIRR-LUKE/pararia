import { renderConversationArtifactMarkdown } from "@/lib/conversation-artifact";
import { normalizeGeneratedText } from "@/lib/ai/structured-generation";
import { buildStrictReportBundleLog } from "@/lib/operational-log";

export type ReportInput = {
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

export type ParentReportDraftJson = {
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

export type ReportContext = {
  createdAt: string;
  periodFrom: string;
  periodTo: string;
  studentReferenceName: string;
  salutation: string;
  selfIntroduction: string;
  reportLead: string;
  signatureLines: string[];
};

export type ReportEvidenceLog = {
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

export function normalizeForCompare(text: string) {
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

export function buildReportContext(input: ReportInput, createdAt: string, periodFrom: string, periodTo: string): ReportContext {
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

export function buildReportEvidenceLogs(input: ReportInput): ReportEvidenceLog[] {
  return input.logs.map((log) => {
    const bundleLog = buildStrictReportBundleLog({
      id: log.id,
      sessionId: log.sessionId ?? null,
      date: log.date,
      mode: log.mode,
      subType: log.subType ?? null,
      sessionType: log.mode,
      artifactJson: log.artifactJson,
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
      derivedMarkdown: normalizeGeneratedText(renderConversationArtifactMarkdown(log.artifactJson).trim(), 420),
    };
  });
}

export function buildEvidencePrompt(logs: ReportEvidenceLog[]) {
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

export function reportBodyCharCount(report: ParentReportJson) {
  return [report.openingParagraph, ...report.detailParagraphs, report.closingParagraph]
    .join("")
    .replace(/\s+/g, "")
    .length;
}

export function containsGenericPhrase(text: string) {
  return GENERIC_REPORT_PHRASES.some((phrase) => normalizeForCompare(text).includes(normalizeForCompare(phrase)));
}

export function renderParentReportMarkdown(report: ParentReportJson) {
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

  return lines.join("\n").trim();
}

export function defaultReportDraft(createdAt: string): ParentReportDraftJson {
  return {
    date: createdAt,
    openingParagraph:
      "今月は、ただ勉強量を増やしていくというよりも、自分に合うやり方を見極めながら、焦らず土台を整えていく時間になったと感じています。",
    detailParagraphs: DEFAULT_DETAIL_PARAGRAPHS.map((paragraph) => paragraph),
    closingParagraph:
      "引き続き、安心して前を向き、自分の力をきちんと発揮できるよう、丁寧に見てまいります。",
  };
}

export function sanitizeParentReportJson(
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
