import type { ActionType, ArtifactSectionKey, ArtifactSessionType, ClaimType, ConversationArtifactEntry } from "./types";

export const INTERVIEW_TITLES: Record<Exclude<ArtifactSectionKey, "unknown">, string[]> = {
  basic_info: ["基本情報"],
  summary: ["1. サマリー"],
  details: ["2. 学習状況と課題分析", "2. ポジティブな話題"],
  actions: ["3. 今後の対策・指導内容", "3. 改善・対策が必要な話題"],
  share: ["4. 志望校に関する検討事項", "4. 保護者への共有ポイント"],
};

export const LESSON_TITLES: Record<Exclude<ArtifactSectionKey, "unknown">, string[]> = {
  basic_info: ["基本情報"],
  summary: ["1. 本日の指導サマリー", "1. 本日の指導サマリー（室長向け要約）"],
  details: ["2. 課題と指導成果", "2. 課題と指導成果（Before → After）"],
  actions: ["3. 学習方針と次回アクション", "3. 学習方針と次回アクション（自学習の設計）"],
  share: ["4. 室長・他講師への共有・連携事項"],
};

const CLAIM_PREFIXES = new Map<string, ClaimType>([
  ["観察", "observed"],
  ["observed", "observed"],
  ["推測", "inferred"],
  ["inferred", "inferred"],
  ["不足", "missing"],
  ["missing", "missing"],
]);

const ACTION_PREFIXES = new Map<string, ActionType>([
  ["判断", "assessment"],
  ["assessment", "assessment"],
  ["次回確認", "nextCheck"],
  ["nextcheck", "nextCheck"],
]);

export function normalizeText(text: string) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeHeading(text: string) {
  return normalizeText(text).replace(/[：:]/g, "");
}

export function dedupeLines(lines: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const cleaned = normalizeText(line);
    if (!cleaned) continue;
    const key = cleaned.replace(/[。．！？\s]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

export function stripBulletPrefix(line: string) {
  return line.replace(/^[-*・•]\s+/, "").trim();
}

export function parseBooleanish(value: string) {
  return /^(true|1|yes|y|はい|必要|要)$/i.test(normalizeText(value));
}

export function normalizeClaimType(value: unknown): ClaimType | undefined {
  if (value === "observed" || value === "inferred" || value === "missing") {
    return value;
  }
  if (typeof value !== "string") return undefined;
  const normalized = normalizeText(value).toLowerCase();
  return CLAIM_PREFIXES.get(normalized);
}

export function normalizeActionType(value: unknown): ActionType | undefined {
  if (value === "assessment" || value === "nextCheck") {
    return value;
  }
  if (typeof value !== "string") return undefined;
  const normalized = normalizeText(value).toLowerCase();
  return ACTION_PREFIXES.get(normalized);
}

export function parseTypedEntryPrefix(line: string) {
  const normalized = normalizeText(line);
  const match = normalized.match(/^(観察|observed|推測|inferred|不足|missing|判断|assessment|次回確認|nextCheck)[:：]\s*(.+)$/i);
  if (!match) return null;
  const prefix = normalizeText(match[1]).toLowerCase();
  const value = normalizeText(match[2]);
  if (!value) return null;
  const claimType = CLAIM_PREFIXES.get(prefix);
  const actionType = ACTION_PREFIXES.get(prefix);
  return {
    value,
    claimType,
    actionType,
  };
}

export function classifyActionType(text: string, explicit?: ActionType | null): ActionType {
  const normalized = normalizeText(text).toLowerCase();
  if (explicit === "assessment" || explicit === "nextCheck") return explicit;
  if (/^(次回|宿題|確認|テスト|課題|再確認|振り返り|持ち帰り|フォロー)/.test(normalized)) {
    return "nextCheck";
  }
  return "assessment";
}

export function formatClaimPrefix(claimType?: ClaimType) {
  if (claimType === "observed") return "観察: ";
  if (claimType === "inferred") return "推測: ";
  if (claimType === "missing") return "不足: ";
  return "";
}

export function formatActionPrefix(actionType?: ActionType) {
  if (actionType === "assessment") return "判断: ";
  if (actionType === "nextCheck") return "次回確認: ";
  return "";
}

export function isSectionKey(value: unknown): value is ArtifactSectionKey {
  return (
    value === "basic_info" ||
    value === "summary" ||
    value === "details" ||
    value === "actions" ||
    value === "share" ||
    value === "unknown"
  );
}

export function titleMapForSessionType(sessionType: ArtifactSessionType) {
  return sessionType === "LESSON_REPORT" ? LESSON_TITLES : INTERVIEW_TITLES;
}
