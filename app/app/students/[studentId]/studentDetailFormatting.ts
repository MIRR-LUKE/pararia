import type { SessionItem } from "./roomTypes";

export function formatUpdated(value?: string | null) {
  if (!value) return "未更新";
  const diff = Date.now() - new Date(value).getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days <= 0) return "今日";
  if (days === 1) return "1日前";
  return `${days}日前`;
}

export function formatReportDate(value?: string | null) {
  if (!value) return "未生成";
  const date = new Date(value);
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

export function formatSessionLabel(session: SessionItem) {
  const date = new Date(session.sessionDate);
  const base = `${date.getMonth() + 1}月${date.getDate()}日`;
  return session.type === "INTERVIEW" ? `${base}の面談` : `${base}の指導報告`;
}

export function lessonSummaryLabel(session: SessionItem) {
  if (session.pipeline?.stage === "WAITING_COUNTERPART") {
    return session.pipeline.waitingForPart === "CHECK_IN"
      ? "チェックアウト保存済み → チェックイン待ち"
      : "チェックイン保存済み → チェックアウト待ち";
  }
  if (session.pipeline?.stage === "TRANSCRIBING") return session.pipeline.progress.title;
  if (session.pipeline?.stage === "GENERATING") return "チェックインとチェックアウトを統合して指導報告ログを生成中";
  const types = session.parts.map((part) => part.partType);
  if (types.includes("CHECK_IN") && types.includes("CHECK_OUT")) return "チェックイン + チェックアウト";
  if (types.includes("CHECK_OUT")) return "チェックアウト";
  if (types.includes("CHECK_IN")) return "チェックイン";
  return "指導報告";
}

export function userBadge(name?: string | null) {
  if (!name) return "担当";
  const compact = name.replace(/\s+/g, "");
  return compact.length > 4 ? compact.slice(0, 2) : compact;
}
