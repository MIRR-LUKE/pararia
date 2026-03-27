import {
  dedupeKeepOrder,
  formatSessionDateLabel,
  formatStudentLabel,
  formatTeacherLabel,
  isLikelyNoiseLine,
  pickInterviewLines,
  pickLessonLines,
} from "./shared";
import { repairSummaryMarkdownFormatting } from "./normalize";

function stripSpeakerPrefix(line: string) {
  return line.replace(/^(講師|生徒)\s*[:：]\s*/, "").trim();
}

function isQuestionLike(line: string) {
  const body = stripSpeakerPrefix(line);
  if (!body) return false;
  if (/[?？]$/.test(body)) return true;
  return /(どうですか|どうでしたか|ましたか|どこが|何を|伝えたいですか|次回はどうしますか)$/.test(body);
}

function quoteEvidenceLine(displayText: string, evidenceLine: string, label?: string) {
  const text = stripSpeakerPrefix(displayText || evidenceLine);
  const evidence = dedupeKeepOrder([evidenceLine])[0];
  if (!text || !evidence) return [];
  const prefix = label ? `${label}: ` : "";
  return [`- ${prefix}${text}`, `  根拠: ${evidence}`];
}

function renderQuotedLines(lines: string[], fallback: string, limit = 4, label?: string) {
  const picked = dedupeKeepOrder(lines).slice(0, limit);
  if (picked.length === 0) {
    return quoteEvidenceLine(fallback, fallback, label);
  }
  return picked.flatMap((line) => quoteEvidenceLine(line, line, label));
}

function filterEvidenceLines(lines: string[]) {
  return dedupeKeepOrder(lines).filter((line) => !isLikelyNoiseLine(line)).slice(0, 16);
}

function filterDeclarativeLines(lines: string[]) {
  return filterEvidenceLines(lines).filter((line) => !isQuestionLike(line));
}

function pickLinesByPattern(lines: string[], pattern: RegExp, limit: number) {
  return dedupeKeepOrder(lines.filter((line) => pattern.test(stripSpeakerPrefix(line)))).slice(0, limit);
}

function extractLessonPartLines(transcript: string, label: "授業前チェックイン" | "授業後チェックアウト") {
  const lines = transcript.replace(/\r/g, "").split("\n");
  const collected: string[] = [];
  let capturing = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const normalizedHeading = trimmed.replace(/^##\s*/, "");
    if (normalizedHeading === label) {
      capturing = true;
      continue;
    }
    if (normalizedHeading === "授業前チェックイン" || normalizedHeading === "授業後チェックアウト") {
      if (capturing) break;
      continue;
    }
    if (capturing) {
      collected.push(trimmed);
    }
  }

  return filterDeclarativeLines(collected).slice(0, 6);
}

function buildParagraph(text: string, evidenceLines: string[]) {
  const cleaned = text.trim();
  if (!cleaned) return [];
  return [cleaned, ...dedupeKeepOrder(evidenceLines).slice(0, 2).map((line) => `根拠: ${line}`)];
}

export function buildInterviewDraftFallbackMarkdown(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
}) {
  const lines = filterDeclarativeLines(pickInterviewLines(input.transcript));
  const sleepLine =
    pickLinesByPattern(lines, /(睡眠|寝る|集中|英語|音読)/, 2)[0] ??
    lines[0] ??
    "今回の面談で確認できた内容は限定的だった。";
  const studyLine =
    pickLinesByPattern(lines, /(宿題|スマホ|ベクトル|受験|基礎)/, 3)[0] ??
    lines[1] ??
    "次回までの確認事項は transcript から拾えた範囲に限る。";
  const supportLine =
    pickLinesByPattern(lines, /(宿題|英語|睡眠|保護者|続けやすい)/, 3)[1] ??
    lines[2] ??
    studyLine;

  const positiveLines = dedupeKeepOrder([
    ...pickLinesByPattern(lines, /(読みやすい|短く|続けやすい|整う|早くな)/, 3),
    ...lines.slice(0, 5),
  ]).slice(0, 4);
  const issueLines = dedupeKeepOrder([
    ...pickLinesByPattern(lines, /(落ちる|時間がかかる|まだ先|迷う|不安|止ま)/, 4),
    ...lines.slice(1, 6),
  ]).slice(0, 4);
  const parentLines = dedupeKeepOrder([
    ...pickLinesByPattern(lines, /(睡眠|宿題|英語|受験|続けやすい)/, 3),
    ...lines.slice(0, 5),
  ]).slice(0, 3);

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
      ...buildParagraph(stripSpeakerPrefix(sleepLine), [sleepLine]),
      "",
      ...buildParagraph(`${stripSpeakerPrefix(studyLine)} ${stripSpeakerPrefix(supportLine)}`.trim(), [studyLine, supportLine]),
      "",
      "■ 2. ポジティブな話題",
      ...positiveLines.flatMap((line) => quoteEvidenceLine(line, line, "観察")),
      "",
      "■ 3. 改善・対策が必要な話題",
      ...issueLines.flatMap((line) => quoteEvidenceLine(line, line, "不足")),
      "",
      "■ 4. 保護者への共有ポイント",
      ...parentLines.flatMap((line) => quoteEvidenceLine(line, line, "共有")),
    ].join("\n")
  );
}

export function buildLessonDraftFallbackMarkdown(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
}) {
  const lines = filterDeclarativeLines(pickLessonLines(input.transcript));
  const checkInLines = extractLessonPartLines(input.transcript, "授業前チェックイン");
  const checkOutLines = extractLessonPartLines(input.transcript, "授業後チェックアウト");
  const beforeLine =
    pickLinesByPattern(checkInLines, /(最初の式|場合分け|焦る|止ま)/, 2)[0] ??
    checkInLines[0] ??
    "授業前の理解状況は限定的だった。";
  const afterLine =
    pickLinesByPattern(checkOutLines, /(固定できた|順番が見え|再現|図にすると)/, 2)[0] ??
    checkOutLines[0] ??
    "授業後の理解状況は限定的だった。";
  const methodLine =
    pickLinesByPattern([...checkInLines, ...lines], /(条件整理|図|順番)/, 2)[0] ??
    lines[0] ??
    beforeLine;
  const homeworkLine =
    pickLinesByPattern([...checkOutLines, ...lines], /(宿題|再現)/, 2)[0] ??
    lines[1] ??
    "宿題の確認は transcript から拾えた範囲に限る。";
  const nextCheckLine =
    pickLinesByPattern([...checkOutLines, ...lines], /(最初の式|条件|順番|再現)/, 3)[1] ??
    afterLine;
  const shareLines = dedupeKeepOrder([
    methodLine,
    afterLine,
    homeworkLine,
    ...checkOutLines,
    ...lines,
  ]).slice(0, 3);

  return repairSummaryMarkdownFormatting(
    [
      "■ 基本情報",
      `対象生徒: ${formatStudentLabel(input.studentName)} 様`,
      `指導日: ${formatSessionDateLabel(input.sessionDate) || "未記録"}`,
      "教科・単元: 文字起こしから確認した内容を整理",
      `担当チューター: ${formatTeacherLabel(input.teacherName)}`,
      "",
      "■ 1. 本日の指導サマリー（室長向け要約）",
      ...buildParagraph(`${stripSpeakerPrefix(methodLine)} ${stripSpeakerPrefix(beforeLine)}`.trim(), [methodLine, beforeLine]),
      "",
      ...buildParagraph(`${stripSpeakerPrefix(afterLine)} ${stripSpeakerPrefix(homeworkLine)}`.trim(), [afterLine, homeworkLine]),
      "",
      "■ 2. 課題と指導成果（Before → After）",
      "【条件整理】",
      `現状（Before）: ${stripSpeakerPrefix(beforeLine)}`,
      `根拠: ${beforeLine}`,
      `成果（After）: ${stripSpeakerPrefix(afterLine)}`,
      `根拠: ${afterLine}`,
      `※特記事項: ${stripSpeakerPrefix(methodLine)}`,
      `根拠: ${methodLine}`,
      "",
      "【再現確認】",
      `現状（Before）: ${stripSpeakerPrefix(homeworkLine)}`,
      `根拠: ${homeworkLine}`,
      `成果（After）: ${stripSpeakerPrefix(nextCheckLine)}`,
      `根拠: ${nextCheckLine}`,
      `※特記事項: ${stripSpeakerPrefix(afterLine)}`,
      `根拠: ${afterLine}`,
      "",
      "■ 3. 学習方針と次回アクション（自学習の設計）",
      "生徒:",
      ...quoteEvidenceLine(methodLine, methodLine, "判断"),
      "次回までの宿題:",
      ...quoteEvidenceLine(homeworkLine, homeworkLine, "判断"),
      "次回の確認（テスト）事項:",
      ...quoteEvidenceLine(nextCheckLine, nextCheckLine, "次回確認"),
      "",
      "■ 4. 室長・他講師への共有・連携事項",
      ...shareLines.flatMap((line) => quoteEvidenceLine(line, line, "共有")),
    ].join("\n")
  );
}
