import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";
import type { SessionMode } from "./types";

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function estimateTokens(text: string) {
  return Math.ceil(String(text ?? "").length / 2);
}

export function normalizeWhitespace(text: string) {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

const TRANSCRIPT_BREAK_HINT_RE =
  /\s+(?=(?:講師|生徒)\s*[:：]|次回は|次回まで|宿題は|今日は|本日は|まず|ただ|それで|確認事項|授業前|授業後|挟み打ち|極限|三角関数|条件整理|再現|LEAP|YouTube|MARCH)/g;

const TRANSCRIPT_NOISE_RE =
  /(録音を始|では録音|録音開始|オッケー|OK\b|質問もありますか|分からなかったことはない|特にない|お疲れ|以上です|じゃあ特にない)/i;

function splitTranscriptFragments(line: string) {
  const normalized = normalizeWhitespace(line);
  if (!normalized) return [];

  let parts = [normalized]
    .flatMap((part) => part.split(/(?=(?:講師|生徒)\s*[:：])/))
    .flatMap((part) => part.split(/(?<=[。！？?])\s*/))
    .flatMap((part) => (part.length > 88 ? part.split(TRANSCRIPT_BREAK_HINT_RE) : [part]))
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  if (parts.length === 0) return [];

  const merged: string[] = [];
  for (const part of parts) {
    if (merged.length > 0 && part.length < 10) {
      merged[merged.length - 1] = normalizeWhitespace(`${merged[merged.length - 1]} ${part}`);
      continue;
    }
    merged.push(part);
  }
  return merged;
}

export function transcriptLines(transcript: string) {
  return transcript
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((line) => splitTranscriptFragments(line))
    .filter(Boolean)
    .filter((line) => !/^##\s+/.test(line))
    .filter((line) => !/^授業前チェックイン$/.test(line))
    .filter((line) => !/^授業後チェックアウト$/.test(line));
}

export function extractMarkdownSectionBody(markdown: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`##\\s+${escaped}\\n([\\s\\S]*?)(?=\\n##\\s+|$)`));
  return match?.[1]?.trim() ?? "";
}

export function dedupeKeepOrder(lines: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = normalizeWhitespace(line);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

const INTERVIEW_KEYWORD_RE =
  /学習|学校|生活|睡眠|宿題|部活|進路|志望|志望校|不安|課題|目標|復習|模試|受験|成績|提出|習慣|過去問|共通テスト|私大|数学|英語|国語|理科|社会|ベクトル|数列|微分|積分|長文|読解|語彙|単語|LEAP|スマホ|YouTube|就寝|帰宅|MARCH|時間配分|見直し|ケアレスミス|ルール|学校選択|学力検査|越ヶ谷|越谷南|春日部東|指定校|推薦|国立/;
const LESSON_KEYWORD_RE =
  /宿題|授業|演習|理解|つまず|復習|次回|課題|単元|解説|確認|極限|三角関数|ベクトル|数列|微分|積分|学校|講習|化学|英語|数学/;

function countJapaneseChars(text: string) {
  return (text.match(/[一-龯ぁ-んァ-ヶー]/g) ?? []).length;
}

function countAsciiLetters(text: string) {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

export function isLikelyNoiseLine(line: string) {
  const normalized = normalizeWhitespace(line);
  if (!normalized) return true;
  if (TRANSCRIPT_NOISE_RE.test(normalized)) return true;
  if (/^(はい|ええ|うん|了解|わかりました|オッケー|OK|ないです|特にない|大丈夫|以上です|お疲れさま)[。！!？?]*$/i.test(normalized)) {
    return true;
  }
  const japaneseChars = countJapaneseChars(normalized);
  const asciiLetters = countAsciiLetters(normalized);
  if (asciiLetters >= 10 && japaneseChars < asciiLetters) return true;
  if (/^[\s,，、。.・!?？！-]+$/.test(normalized)) return true;
  if (japaneseChars < 5 && normalized.length < 10) return true;
  return false;
}

function scoreEvidenceLine(line: string, keywordRegex: RegExp) {
  const normalized = normalizeWhitespace(line);
  const keywordBoost = keywordRegex.test(normalized) ? 30 : 0;
  const japaneseScore = Math.min(countJapaneseChars(normalized), 60);
  const lengthScore = Math.min(normalized.length, 90);
  const asciiPenalty = countAsciiLetters(normalized) > 8 ? 16 : 0;
  const fillerPenalty = /^(はい|ええ|うん|そう|なるほど|たしかに)/.test(normalized) ? 18 : 0;
  return japaneseScore + lengthScore + keywordBoost - asciiPenalty - fillerPenalty;
}

function pickInformativeLines(lines: string[], keywordRegex: RegExp, limit: number) {
  return lines
    .map((line, index) => ({
      line,
      index,
      score: isLikelyNoiseLine(line) ? -999 : scoreEvidenceLine(line, keywordRegex),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.line);
}

export function pickInterviewLines(transcript: string) {
  const lines = transcriptLines(transcript).filter((line) => !isLikelyNoiseLine(line));
  const keywordLines = lines.filter((line) => INTERVIEW_KEYWORD_RE.test(line));
  const informativeLines = pickInformativeLines(lines, INTERVIEW_KEYWORD_RE, 20);
  return dedupeKeepOrder([
    ...lines.slice(0, 14),
    ...keywordLines.slice(0, 28),
    ...informativeLines,
    ...lines.slice(-14),
  ]).slice(0, 72);
}

export function pickLessonLines(transcript: string) {
  const checkIn = transcriptLines(extractMarkdownSectionBody(transcript, "授業前チェックイン"))
    .filter((line) => !isLikelyNoiseLine(line))
    .slice(0, 10);
  const checkOut = transcriptLines(extractMarkdownSectionBody(transcript, "授業後チェックアウト"))
    .filter((line) => !isLikelyNoiseLine(line))
    .slice(0, 12);
  const all = transcriptLines(transcript).filter((line) => !isLikelyNoiseLine(line));
  const keywordLines = all.filter((line) => LESSON_KEYWORD_RE.test(line));
  const informativeLines = pickInformativeLines(all, LESSON_KEYWORD_RE, 14);
  return dedupeKeepOrder([
    ...checkIn,
    ...checkOut,
    ...keywordLines.slice(0, 18),
    ...informativeLines,
    ...all.slice(-6),
  ]).slice(0, 42);
}

function buildFastDraftEvidenceText(sessionType: SessionMode, transcript: string) {
  if (sessionType === "LESSON_REPORT") {
    const lines = pickLessonLines(transcript);
    return [
      "### 抽出済みの重要発話",
      ...lines.map((line) => `- ${line}`),
    ].join("\n");
  }
  const lines = pickInterviewLines(transcript);
  return [
    "### 抽出済みの重要発話",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}

export function buildDraftInputBlock(sessionType: SessionMode, transcript: string) {
  const normalizedTranscript = String(transcript ?? "").replace(/\r/g, "").trim();
  const evidenceBlock = buildFastDraftEvidenceText(sessionType, normalizedTranscript);
  const transcriptTokenEstimate = estimateTokens(normalizedTranscript);
  // Keep raw/reviewed transcript as the source of truth. This block only shapes
  // what the LLM sees for long inputs; it never overwrites stored transcript data.
  if (sessionType === "INTERVIEW" && transcriptTokenEstimate <= 9000) {
    return {
      label: "抽出済み重要発話 + 文字起こし全文",
      content: [evidenceBlock, "", "### 文字起こし全文", normalizedTranscript].join("\n"),
    };
  }
  if (transcriptTokenEstimate <= 3500) {
    return {
      label: "抽出済み重要発話 + 文字起こし全文",
      content: [evidenceBlock, "", "### 文字起こし全文", normalizedTranscript].join("\n"),
    };
  }
  return {
    label: "圧縮済み証拠",
    content: evidenceBlock,
  };
}

export function formatStudentLabel(studentName?: string | null) {
  const trimmed = String(studentName ?? "").trim();
  return trimmed || "未設定";
}

export function formatTeacherLabel(teacherName?: string | null) {
  const trimmed = String(teacherName ?? "").trim();
  return trimmed || DEFAULT_TEACHER_FULL_NAME;
}

export function formatSessionDateLabel(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
