import { extractMarkdownSectionBody, formatSessionDateLabel, formatStudentLabel, formatTeacherLabel, dedupeKeepOrder, isLikelyNoiseLine, pickInterviewLines, pickLessonLines, transcriptLines } from "./shared";
import { repairSummaryMarkdownFormatting } from "./normalize";

function quoteEvidenceLine(line: string, label?: string) {
  const cleaned = dedupeKeepOrder([line])[0];
  if (!cleaned) return [];
  const prefix = label ? `${label}: ` : "";
  return [`- ${prefix}${cleaned}`, `  根拠: ${cleaned}`];
}

function renderQuotedLines(lines: string[], fallback: string, limit = 4, label?: string) {
  const picked = dedupeKeepOrder(lines).slice(0, limit);
  if (picked.length === 0) {
    return quoteEvidenceLine(fallback, label);
  }
  return picked.flatMap((line) => quoteEvidenceLine(line, label));
}

function sectionWithQuotedLines(title: string, lines: string[], fallback: string, limit = 4, label?: string) {
  return [title, ...renderQuotedLines(lines, fallback, limit, label)];
}

function filterEvidenceLines(lines: string[]) {
  return dedupeKeepOrder(lines).filter((line) => !isLikelyNoiseLine(line)).slice(0, 12);
}

export function buildInterviewDraftFallbackMarkdown(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
}) {
  const lines = filterEvidenceLines(pickInterviewLines(input.transcript));
  const positiveLines = lines.slice(0, 4);
  const issueLines = lines.slice(4, 8);
  const parentLines = lines.slice(8, 12);
  return repairSummaryMarkdownFormatting(
    [
      "■ 基本情報",
      `対象生徒: ${formatStudentLabel(input.studentName)} 様`,
      `面談日: ${formatSessionDateLabel(input.sessionDate) || "未記録"}`,
      "面談時間: 未記録",
      `担当チューター: ${formatTeacherLabel(input.teacherName)}`,
      "面談目的: 学習状況の確認と次回方針の整理",
      "",
      "■ 1. サマリー",
      ...renderQuotedLines(lines.slice(0, 4), "今回の面談で確認できた内容は限定的だった。", 2, "観察"),
      ...renderQuotedLines(lines.slice(4, 8), "次回までの確認事項は transcript から拾えた範囲に限る。", 2, "不足"),
      "",
      "■ 2. ポジティブな話題",
      ...positiveLines.flatMap((line) => quoteEvidenceLine(line, "観察")),
      "",
      "■ 3. 改善・対策が必要な話題",
      ...issueLines.flatMap((line) => quoteEvidenceLine(line, "不足")),
      "",
      "■ 4. 保護者への共有ポイント",
      ...parentLines.flatMap((line) => quoteEvidenceLine(line, "共有")),
    ].join("\n")
  );
}

export function buildLessonDraftFallbackMarkdown(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
}) {
  const lines = filterEvidenceLines(pickLessonLines(input.transcript));
  const checkInLines = transcriptLines(extractMarkdownSectionBody(input.transcript, "授業前チェックイン"))
    .filter((line) => !isLikelyNoiseLine(line))
    .slice(0, 6);
  const checkOutLines = transcriptLines(extractMarkdownSectionBody(input.transcript, "授業後チェックアウト"))
    .filter((line) => !isLikelyNoiseLine(line))
    .slice(0, 6);
  return repairSummaryMarkdownFormatting(
    [
      "■ 基本情報",
      `対象生徒: ${formatStudentLabel(input.studentName)} 様`,
      `指導日: ${formatSessionDateLabel(input.sessionDate) || "未記録"}`,
      "教科・単元: 文字起こしから確認した内容を整理",
      `担当チューター: ${formatTeacherLabel(input.teacherName)}`,
      "",
      "■ 1. 本日の指導サマリー（室長向け要約）",
      ...renderQuotedLines([...checkInLines.slice(0, 2), ...lines.slice(0, 2)], "授業内容の確認範囲は限定的だった。", 2, "観察"),
      ...renderQuotedLines([...checkOutLines.slice(0, 2), ...lines.slice(2, 4)], "理解状況と次回への接続は transcript から拾えた範囲に限る。", 2, "不足"),
      "",
      "■ 2. 課題と指導成果（Before → After）",
      "【授業前の理解状況】",
      ...renderQuotedLines(checkInLines.slice(0, 3), "授業前の確認内容は限定的だった。", 3, "観察"),
      "【授業後の理解状況】",
      ...renderQuotedLines(checkOutLines.slice(0, 3), "授業後の確認内容は限定的だった。", 3, "観察"),
      "",
      "■ 3. 学習方針と次回アクション（自学習の設計）",
      "生徒:",
      ...dedupeKeepOrder(lines.slice(10, 13)).flatMap((line) => quoteEvidenceLine(line, "判断")),
      "次回までの宿題:",
      ...dedupeKeepOrder(lines.slice(13, 16)).flatMap((line) => quoteEvidenceLine(line, "次回確認")),
      "次回の確認（テスト）事項:",
      ...dedupeKeepOrder(lines.slice(16, 19)).flatMap((line) => quoteEvidenceLine(line, "次回確認")),
      "",
      "■ 4. 室長・他講師への共有・連携事項",
      ...dedupeKeepOrder(lines.slice(19, 23)).flatMap((line) => quoteEvidenceLine(line, "共有")),
    ].join("\n")
  );
}
