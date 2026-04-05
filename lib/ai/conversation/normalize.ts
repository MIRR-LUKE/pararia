import type { SessionMode } from "./types";

export function cleanupSummaryMarkdown(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[•・*]\s+/gm, "- ")
    .trim();
}

export function repairSummaryMarkdownFormatting(text: string) {
  return cleanupSummaryMarkdown(text)
    .replace(/\*\*(生徒:|次回までの宿題:|次回の確認（テスト）事項:)\*\*/g, "$1")
    .replace(/^\*\*\s*$/gm, "")
    .replace(/対象\s*\n\s*生徒:/g, "対象生徒:")
    .replace(/(■ 基本情報)\s*(対象生徒:)/, "$1\n$2")
    .replace(/([^\n])(面談日:|指導日:|面談時間:|教科・単元:|担当チューター:|面談目的:|テーマ:)/g, "$1\n$2")
    .replace(/([^\n])(■ \d+\.)/g, "$1\n$2")
    .replace(/([^\n])(【)/g, "$1\n$2")
    .replace(/([^\n])(現状（Before）:|成果（After）:|※特記事項:|(?<!対象)生徒:|次回までの宿題:|次回の確認（テスト）事項:)/g, "$1\n$2")
    .replace(/([^\n])(観察:|推測:|不足:|判断:|次回確認:)/g, "$1\n$2")
    .replace(/([^\n])(根拠:|evidence:|basis:|humanCheckNeeded:)/g, "$1\n$2")
    .replace(/^- \n(観察:|推測:|不足:|判断:|次回確認:)/gm, "- $1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function comparableText(text: string) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[・･\-ー_]/g, "")
    .replace(/[()（）「」『』【】\[\]、。，．！？!?:：;；]/g, "")
    .trim()
    .toLowerCase();
}

function extractGeneratedContentLines(markdown: string) {
  return repairSummaryMarkdownFormatting(markdown)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^■\s+/.test(line))
    .filter((line) => !/^(対象生徒|生徒名|生徒|講師|講師名|担当講師|担当チューター|面談日|指導日|面談時間|教科・単元|面談目的)[:：]/.test(line))
    .filter((line) => !/^(根拠|evidence|basis)[:：]/i.test(line))
    .map((line) => line.replace(/^[-*・•]\s+/, ""))
    .map((line) => line.replace(/^(観察|推測|不足|判断|次回確認|現状（Before）|成果（After）|※特記事項)[:：]\s*/, ""))
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasCopyHeavyOutput(markdown: string, transcript?: string | null) {
  const contentLines = extractGeneratedContentLines(markdown);
  const comparableLines = contentLines
    .map((line) => ({ raw: line, comparable: comparableText(line) }))
    .filter((line) => line.comparable.length >= 28);

  const oversizedCount = comparableLines.filter((line) => line.raw.length >= 100).length;
  const uniqueCount = new Set(comparableLines.map((line) => line.comparable)).size;
  const duplicateCount = comparableLines.length - uniqueCount;

  if (!transcript) {
    return oversizedCount >= 3 || duplicateCount >= 2;
  }

  const transcriptLines = String(transcript)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => comparableText(line))
    .filter((line) => line.length >= 28);

  const copiedCount = comparableLines.filter((line) =>
    transcriptLines.some((sourceLine) => sourceLine.includes(line.comparable) || line.comparable.includes(sourceLine))
  ).length;

  return oversizedCount >= 3 || duplicateCount >= 2 || copiedCount >= 3 || (copiedCount >= 2 && oversizedCount >= 1);
}

export function isValidDraftMarkdown(markdown: string | null | undefined, sessionType: SessionMode, minChars: number) {
  const trimmed = repairSummaryMarkdownFormatting(String(markdown ?? ""));
  if (!trimmed.includes("■ 基本情報")) return false;
  if (sessionType === "LESSON_REPORT" && !trimmed.includes("■ 4. 室長・他講師への共有・連携事項")) return false;
  if (sessionType !== "LESSON_REPORT" && !trimmed.includes("■ 5. 次回のお勧め話題")) return false;
  return trimmed.length >= Math.min(Math.max(Math.floor(minChars * 0.72), 260), 900);
}

export function isWeakDraftMarkdown(
  markdown: string | null | undefined,
  sessionType: SessionMode,
  minChars: number,
  sourceTranscript?: string | null
) {
  const trimmed = repairSummaryMarkdownFormatting(String(markdown ?? ""));
  if (!isValidDraftMarkdown(trimmed, sessionType, minChars)) return true;
  if (sessionType === "LESSON_REPORT" && !/(?:^|\n)\s*(?:- |\* |・ )?(?:根拠|evidence|basis)[:：]/.test(trimmed)) return true;
  if (/##\s*授業前チェックイン|##\s*授業後チェックアウト|録音始めた|何喋ろうか忘れちゃった|質問もありますか|以上です。お疲れ/.test(trimmed)) {
    return true;
  }
  if (hasCopyHeavyOutput(trimmed, sourceTranscript)) return true;
  if (sessionType === "LESSON_REPORT") {
    if ((trimmed.match(/現状（Before）:/g) ?? []).length < 2) return true;
    if ((trimmed.match(/成果（After）:/g) ?? []).length < 2) return true;
    if (!trimmed.includes("次回までの宿題:")) return true;
    if (!trimmed.includes("次回の確認（テスト）事項:")) return true;
    if (!trimmed.includes("【")) return true;
    return false;
  }
  if (!trimmed.includes("■ 2. 学習状況と課題分析")) return true;
  if (!trimmed.includes("■ 3. 今後の対策・指導内容")) return true;
  if (!trimmed.includes("■ 4. 志望校に関する検討事項")) return true;
  if (!trimmed.includes("■ 5. 次回のお勧め話題")) return true;
  if ((trimmed.match(/\n- /g) ?? []).length < 7) return true;
  if (/面談日:[^\n]+面談時間:/.test(trimmed)) return true;
  if (trimmed.includes("根拠:")) return true;
  return false;
}
