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
    .replace(/([^\n])(面談日:|指導日:|面談時間:|教科・単元:|担当チューター:|面談目的:)/g, "$1\n$2")
    .replace(/([^\n])(■ \d+\.)/g, "$1\n$2")
    .replace(/([^\n])(【)/g, "$1\n$2")
    .replace(/([^\n])(現状（Before）:|成果（After）:|※特記事項:|生徒:|次回までの宿題:|次回の確認（テスト）事項:)/g, "$1\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isValidDraftMarkdown(markdown: string | null | undefined, sessionType: SessionMode, minChars: number) {
  const trimmed = repairSummaryMarkdownFormatting(String(markdown ?? ""));
  if (!trimmed.includes("■ 基本情報")) return false;
  if (sessionType === "LESSON_REPORT" && !trimmed.includes("■ 4. 室長・他講師への共有・連携事項")) return false;
  if (sessionType !== "LESSON_REPORT" && !trimmed.includes("■ 4. 保護者への共有ポイント")) return false;
  return trimmed.length >= Math.min(Math.max(minChars, 260), 1000);
}

export function isWeakDraftMarkdown(markdown: string | null | undefined, sessionType: SessionMode, minChars: number) {
  const trimmed = repairSummaryMarkdownFormatting(String(markdown ?? ""));
  if (!isValidDraftMarkdown(trimmed, sessionType, minChars)) return true;
  if (/##\s*授業前チェックイン|##\s*授業後チェックアウト|録音始めた|何喋ろうか忘れちゃった|質問もありますか|以上です。お疲れ/.test(trimmed)) {
    return true;
  }
  if (sessionType === "LESSON_REPORT") {
    if ((trimmed.match(/現状（Before）:/g) ?? []).length < 2) return true;
    if ((trimmed.match(/成果（After）:/g) ?? []).length < 2) return true;
    if (!trimmed.includes("次回までの宿題:")) return true;
    if (!trimmed.includes("次回の確認（テスト）事項:")) return true;
    if (!trimmed.includes("【")) return true;
    return false;
  }
  if ((trimmed.match(/\n- /g) ?? []).length < 6) return true;
  if (/面談日:[^\n]+面談時間:/.test(trimmed)) return true;
  return false;
}
