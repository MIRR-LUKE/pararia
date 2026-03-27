import { normalizeRawTranscriptText } from "@/lib/transcript/source";

export const CANDIDATE_STOP_WORDS = new Set([
  "先生",
  "講師",
  "生徒",
  "学校",
  "宿題",
  "授業",
  "面談",
  "今回",
  "次回",
  "確認",
  "共有",
  "保護者",
  "学習",
  "数学",
  "英語",
  "国語",
  "理科",
  "社会",
  "チェックイン",
  "チェックアウト",
]);

export function normalizeCompareText(text: string) {
  return normalizeRawTranscriptText(text)
    .normalize("NFKC")
    .replace(/[ 　\t\r\n]/g, "")
    .replace(/[・･\\-ー_]/g, "")
    .replace(/[()（）「」『』【】\[\]]/g, "")
    .toLowerCase();
}

export function normalizeTokenText(text: string) {
  return normalizeRawTranscriptText(text).replace(/\s+/g, " ").trim();
}

export function countMeaningfulChars(text: string) {
  return normalizeRawTranscriptText(text).replace(/[\s、。，．！？!?:：;；・\\-]/g, "").length;
}
