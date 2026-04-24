export type NextMeetingMemoStatusValue = "QUEUED" | "GENERATING" | "READY" | "FAILED";

export type NextMeetingMemoLike = {
  id: string;
  status: NextMeetingMemoStatusValue;
  previousSummary?: string | null;
  suggestedTopics?: string | null;
  errorMessage?: string | null;
  updatedAt?: string | Date | null;
  sessionId?: string | null;
  conversationId?: string | null;
};

export type NextMeetingMemoSessionLike = {
  id: string;
  type: "INTERVIEW";
  sessionDate: string | Date;
  conversation?: { id: string; status: string } | null;
  nextMeetingMemo?: NextMeetingMemoLike | null;
};

const FORBIDDEN_PATTERNS = [
  /論点/,
  /観点/,
  /粒度/,
  /切り分け/,
  /示唆/,
  /進捗確認/,
  /という整理になった/,
  /整理になった/,
];

export function sanitizeNextMeetingMemoText(value: unknown, maxChars = 220) {
  const text = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[•●■・]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!text) return "";

  let normalized = text;
  normalized = normalized.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars).trim()}…` : normalized;
}

export function countJapaneseSentences(text: string) {
  return text
    .split(/(?<=[。！？])/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

export function isValidNextMeetingMemoText(text: string) {
  const normalized = sanitizeNextMeetingMemoText(text, 240);
  if (!normalized) return false;
  if (normalized.length < 70 || normalized.length > 240) return false;
  if (/[-*]\s/.test(normalized)) return false;
  if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  const sentenceCount = countJapaneseSentences(normalized);
  return sentenceCount >= 2 && sentenceCount <= 4;
}

export function pickLatestInterviewMemoSession<T extends NextMeetingMemoSessionLike>(sessions: T[] = []) {
  return [...sessions]
    .filter((session) => session.type === "INTERVIEW" && Boolean(session.conversation?.id))
    .sort((left, right) => new Date(right.sessionDate).getTime() - new Date(left.sessionDate).getTime())[0] ?? null;
}
