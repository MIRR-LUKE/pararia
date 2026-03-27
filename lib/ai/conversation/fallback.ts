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

function countJapaneseChars(text: string) {
  return (text.match(/[一-龯ぁ-んァ-ヶー]/g) ?? []).length;
}

function isQuestionLike(line: string) {
  const body = stripSpeakerPrefix(line);
  if (!body) return false;
  if (/[?？]$/.test(body)) return true;
  return /(どうですか|どうでしたか|ましたか|どこが|何を|伝えたいですか|次回はどうしますか)$/.test(body);
}

function pickBestClause(text: string) {
  const clauses = stripSpeakerPrefix(text)
    .replace(/\r/g, "")
    .split(/(?<=[。！？?])\s*|\s+(?=(?:次回は|次回まで|宿題は|今日は|本日は|まず|ただ|確認事項|挟み打ち|条件整理|再現))/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  const candidates = clauses.filter((clause) => !isQuestionLike(clause) && !isLikelyNoiseLine(clause));
  const pool = candidates.length > 0 ? candidates : clauses;
  return (
    [...pool].sort((left, right) => {
      const rightScore = countJapaneseChars(right) + Math.min(right.length, 80);
      const leftScore = countJapaneseChars(left) + Math.min(left.length, 80);
      return rightScore - leftScore;
    })[0] ?? stripSpeakerPrefix(text)
  );
}

function compactText(text: string, maxChars = 72) {
  const base = pickBestClause(text)
    .replace(/^(はい|えっと|えーと|ええと|うん|まあ|なんか|あの|その)\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "";
  if (base.length <= maxChars) return base;
  const slice = base.slice(0, maxChars);
  const punctuationIndex = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("、"), slice.lastIndexOf("?"), slice.lastIndexOf("？"));
  if (punctuationIndex >= 18) return slice.slice(0, punctuationIndex + 1).trim();
  const spaceIndex = slice.lastIndexOf(" ");
  if (spaceIndex >= 18) return slice.slice(0, spaceIndex).trim();
  return `${slice.trim()}…`;
}

function quoteEvidenceLine(displayText: string, evidenceLine: string, label?: string) {
  const text = compactText(displayText || evidenceLine, 68);
  const evidence = compactText(dedupeKeepOrder([evidenceLine])[0] ?? evidenceLine, 92);
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
  const cleaned = compactText(text.trim(), 110);
  if (!cleaned) return [];
  return [cleaned, ...dedupeKeepOrder(evidenceLines).slice(0, 2).map((line) => `根拠: ${compactText(line, 92)}`)];
}

function extractTopicTerms(lines: string[], regex: RegExp, limit: number) {
  const terms: string[] = [];
  for (const line of lines) {
    for (const match of stripSpeakerPrefix(line).match(regex) ?? []) {
      if (!terms.includes(match)) terms.push(match);
      if (terms.length >= limit) return terms;
    }
  }
  return terms;
}

function joinTopicTerms(terms: string[]) {
  if (terms.length === 0) return "";
  if (terms.length === 1) return terms[0];
  if (terms.length === 2) return `${terms[0]}と${terms[1]}`;
  return `${terms.slice(0, -1).join("・")}と${terms[terms.length - 1]}`;
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
  const focusTerms = extractTopicTerms(lines, /(睡眠|英語|音読|宿題|スマホ|ベクトル|受験|基礎)/g, 4);
  const summaryLead =
    focusTerms.length > 0
      ? `面談では${joinTopicTerms(focusTerms)}について確認した。`
      : "面談では学習状況と次回方針を確認した。";
  const issueTerms = extractTopicTerms(lines, /(睡眠|宿題|スマホ|ベクトル|受験|基礎)/g, 4);
  const summaryFollow =
    issueTerms.length > 0
      ? `${joinTopicTerms(issueTerms.slice(0, 3))}は、次回までの確認事項として残した。`
      : "次回までの確認事項は transcript から拾えた範囲に限って整理した。";

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
      ...buildParagraph(summaryLead, [sleepLine]),
      "",
      ...buildParagraph(summaryFollow, [studyLine, supportLine]),
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
  const lessonTopics = extractTopicTerms(
    dedupeKeepOrder([...checkInLines, ...checkOutLines, ...lines]),
    /(三角関数|極限|数列|ベクトル|条件整理|最初の式|図|順番|再現|宿題|挟み打ちの原理|証明)/g,
    5
  );
  const lessonSummary =
    lessonTopics.length > 0
      ? `今回の指導では${joinTopicTerms(lessonTopics.slice(0, 4))}に関する発話を確認した。`
      : "今回の指導では、文字起こしから確認できた範囲で要点を整理した。";
  const beforeSummary =
    lessonTopics.length > 0
      ? `${joinTopicTerms(lessonTopics.slice(0, 3))}について、授業前時点の理解状況を確認した。`
      : "授業前時点の理解状況を transcript から確認した。";
  const afterSummary =
    lessonTopics.length > 0
      ? `${joinTopicTerms(lessonTopics.slice(0, 3))}について、授業後の説明内容と理解の変化を確認した。`
      : "授業後の説明内容と理解の変化を transcript から確認した。";
  const methodSummary =
    lessonTopics.length > 0
      ? `${joinTopicTerms(lessonTopics.slice(0, 3))}の扱い方を、講師側で整理していたことが確認できた。`
      : "講師側で扱い方を整理していたことが確認できた。";
  const nextSummary =
    lessonTopics.length > 1
      ? `次回に向けて${joinTopicTerms(lessonTopics.slice(1, 4))}を再確認する流れが見えた。`
      : "次回確認事項は transcript から拾えた範囲に限って残した。";
  const studentPlanSummary =
    lessonTopics.length > 0
      ? `${joinTopicTerms(lessonTopics.slice(0, 2))}の理解を、自分で再現できる状態に近づける方針を確認した。`
      : "自分で再現できる状態に近づける方針を確認した。";
  const homeworkSummary =
    lessonTopics.length > 0
      ? `${joinTopicTerms(lessonTopics.slice(0, 2))}の復習と宿題の進め方を次回までの課題にした。`
      : "宿題の進め方を次回までの課題にした。";
  const shareDisplayLines = [lessonSummary, afterSummary, nextSummary];

  return repairSummaryMarkdownFormatting(
    [
      "■ 基本情報",
      `対象生徒: ${formatStudentLabel(input.studentName)} 様`,
      `指導日: ${formatSessionDateLabel(input.sessionDate) || "未記録"}`,
      "教科・単元: 文字起こしから確認した内容を整理",
      `担当チューター: ${formatTeacherLabel(input.teacherName)}`,
      "",
      "■ 1. 本日の指導サマリー（室長向け要約）",
      ...buildParagraph(lessonSummary, [methodLine, beforeLine]),
      "",
      ...buildParagraph(nextSummary, [afterLine, homeworkLine]),
      "",
      "■ 2. 課題と指導成果（Before → After）",
      "【条件整理】",
      `現状（Before）: ${beforeSummary}`,
      `根拠: ${beforeLine}`,
      `成果（After）: ${afterSummary}`,
      `根拠: ${afterLine}`,
      `※特記事項: ${methodSummary}`,
      `根拠: ${methodLine}`,
      "",
      "【再現確認】",
      `現状（Before）: ${homeworkSummary}`,
      `根拠: ${homeworkLine}`,
      `成果（After）: ${nextSummary}`,
      `根拠: ${nextCheckLine}`,
      `※特記事項: ${afterSummary}`,
      `根拠: ${afterLine}`,
      "",
      "■ 3. 学習方針と次回アクション（自学習の設計）",
      "生徒:",
      ...quoteEvidenceLine(studentPlanSummary, methodLine, "判断"),
      "次回までの宿題:",
      ...quoteEvidenceLine(homeworkSummary, homeworkLine, "判断"),
      "次回の確認（テスト）事項:",
      ...quoteEvidenceLine(nextSummary, nextCheckLine, "次回確認"),
      "",
      "■ 4. 室長・他講師への共有・連携事項",
      ...shareDisplayLines.flatMap((line, index) => quoteEvidenceLine(line, shareLines[index] ?? shareLines[0] ?? line, "共有")),
    ].join("\n")
  );
}
