import { extractMarkdownSectionBody, formatSessionDateLabel, formatStudentLabel, formatTeacherLabel, dedupeKeepOrder, isLikelyNoiseLine, pickInterviewLines, pickLessonLines, transcriptLines } from "./shared";
import { repairSummaryMarkdownFormatting } from "./normalize";

function joinFallbackSentence(lines: string[], fallback: string) {
  const picked = dedupeKeepOrder(lines).slice(0, 4);
  return picked.length > 0 ? `${picked.join("。")}。` : fallback;
}

export function buildInterviewDraftFallbackMarkdown(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
}) {
  const lines = pickInterviewLines(input.transcript);
  const positiveLines = dedupeKeepOrder(lines.slice(0, 6)).slice(0, 4);
  const issueLines = dedupeKeepOrder(lines.slice(6, 12)).slice(0, 4);
  const parentLines = dedupeKeepOrder(lines.slice(12, 16)).slice(0, 3);
  return repairSummaryMarkdownFormatting([
    "■ 基本情報",
    `対象生徒: ${formatStudentLabel(input.studentName)} 様`,
    `面談日: ${formatSessionDateLabel(input.sessionDate) || "未記録"}`,
    "面談時間: 未記録",
    `担当チューター: ${formatTeacherLabel(input.teacherName)}`,
    "面談目的: 学習状況の確認と次回方針の整理",
    "",
    "■ 1. サマリー",
    joinFallbackSentence(lines.slice(0, 5), "今回の面談で確認できた内容を整理した。"),
    joinFallbackSentence(lines.slice(5, 10), "今後の学習方針と次回までの確認事項を整理した。"),
    "",
    "■ 2. ポジティブな話題",
    ...positiveLines.map((line) => `- ${line}。前向きな材料として継続確認したい。`),
    "",
    "■ 3. 改善・対策が必要な話題",
    ...issueLines.map((line) => `- 現状の課題は ${line}。背景には再現性や運用面の詰め不足があるため、次回までに対策を具体化する。`),
    "",
    "■ 4. 保護者への共有ポイント",
    ...parentLines.map((line) => `- ${line}。家庭では進め方と確認ポイントをセットで共有したい。`),
  ].join("\n"));
}

export function buildLessonDraftFallbackMarkdown(input: {
  transcript: string;
  studentName?: string;
  teacherName?: string;
  sessionDate?: string | Date | null;
}) {
  const lines = pickLessonLines(input.transcript);
  const checkInLines = transcriptLines(extractMarkdownSectionBody(input.transcript, "授業前チェックイン"))
    .filter((line) => !isLikelyNoiseLine(line))
    .slice(0, 6);
  const checkOutLines = transcriptLines(extractMarkdownSectionBody(input.transcript, "授業後チェックアウト"))
    .filter((line) => !isLikelyNoiseLine(line))
    .slice(0, 6);
  return repairSummaryMarkdownFormatting([
    "■ 基本情報",
    `対象生徒: ${formatStudentLabel(input.studentName)} 様`,
    `指導日: ${formatSessionDateLabel(input.sessionDate) || "未記録"}`,
    "教科・単元: 文字起こしから確認した内容を整理",
    `担当チューター: ${formatTeacherLabel(input.teacherName)}`,
    "",
    "■ 1. 本日の指導サマリー（室長向け要約）",
    joinFallbackSentence([...checkInLines.slice(0, 2), ...lines.slice(0, 2)], "本日の授業内容と生徒の反応を整理した。"),
    joinFallbackSentence([...checkOutLines.slice(0, 2), ...lines.slice(2, 4)], "理解状況と次回への接続を確認した。"),
    "",
    "■ 2. 課題と指導成果（Before → After）",
    "【授業前の理解状況】",
    `現状（Before）: ${joinFallbackSentence(checkInLines.slice(0, 3), "授業前の理解状況を確認した。")}`,
    `成果（After）: ${joinFallbackSentence(checkOutLines.slice(0, 3), "授業後に理解の手応えを確認した。")}`,
    "※特記事項: 次回も同論点の再現性を確認する。",
    "",
    "【授業中の主要論点】",
    `現状（Before）: ${joinFallbackSentence(lines.slice(3, 6), "授業中に重点確認が必要な論点があった。")}`,
    `成果（After）: ${joinFallbackSentence(lines.slice(6, 10), "授業内で考え方を整理し、次回へつながる状態にした。")}`,
    "※特記事項: 説明できる状態まで演習で固める必要がある。",
    "",
    "■ 3. 学習方針と次回アクション（自学習の設計）",
    "生徒:",
    ...dedupeKeepOrder(lines.slice(10, 13)).map((line) => `- ${line}`),
    "次回までの宿題:",
    ...dedupeKeepOrder(lines.slice(13, 16)).map((line) => `- ${line}`),
    "次回の確認（テスト）事項:",
    ...dedupeKeepOrder(lines.slice(16, 19)).map((line) => `- ${line}`),
    "",
    "■ 4. 室長・他講師への共有・連携事項",
    ...dedupeKeepOrder(lines.slice(19, 23)).map((line) => `- ${line}`),
  ].join("\n"));
}
