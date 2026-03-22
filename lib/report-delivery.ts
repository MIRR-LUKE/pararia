export type ReportStatusValue = "DRAFT" | "REVIEWED" | "SENT";

export type ReportDeliveryEventTypeValue =
  | "DRAFT_CREATED"
  | "REVIEWED"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "BOUNCED"
  | "MANUAL_SHARED"
  | "RESENT";

type EventActor = {
  id?: string;
  name?: string | null;
  email?: string | null;
};

export type ReportDeliveryEventLike = {
  id?: string;
  eventType: ReportDeliveryEventTypeValue | string;
  deliveryChannel?: string | null;
  note?: string | null;
  createdAt: Date | string;
  actor?: EventActor | null;
};

export type ReportDeliveryHistoryItem = {
  id?: string;
  eventType: ReportDeliveryEventTypeValue | string;
  label: string;
  deliveryChannel?: string | null;
  note?: string | null;
  createdAt: string;
  actor?: EventActor | null;
};

export type ReportWithDeliveryLike = {
  status: ReportStatusValue | string;
  reviewedAt?: Date | string | null;
  sentAt?: Date | string | null;
  deliveryChannel?: string | null;
  deliveryEvents?: ReportDeliveryEventLike[] | null;
};

export type ReportDeliveryState =
  | "draft"
  | "reviewed"
  | "sent"
  | "resent"
  | "delivered"
  | "failed"
  | "bounced"
  | "manual_shared";

const EVENT_LABELS: Record<ReportDeliveryEventTypeValue, string> = {
  DRAFT_CREATED: "ドラフト生成",
  REVIEWED: "レビュー完了",
  SENT: "送信済み",
  DELIVERED: "配達済み",
  FAILED: "送信失敗",
  BOUNCED: "宛先エラー",
  MANUAL_SHARED: "手動共有",
  RESENT: "再送",
};

const EVENT_STATE_MAP: Record<ReportDeliveryEventTypeValue, ReportDeliveryState> = {
  DRAFT_CREATED: "draft",
  REVIEWED: "reviewed",
  SENT: "sent",
  DELIVERED: "delivered",
  FAILED: "failed",
  BOUNCED: "bounced",
  MANUAL_SHARED: "manual_shared",
  RESENT: "resent",
};

const STATE_LABELS: Record<ReportDeliveryState, string> = {
  draft: "レビュー待ち",
  reviewed: "送信可能",
  sent: "送信済み",
  resent: "再送済み",
  delivered: "配達済み",
  failed: "送信失敗",
  bounced: "宛先エラー",
  manual_shared: "手動共有",
};

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compareCreatedAtAsc(
  left: Pick<ReportDeliveryEventLike, "createdAt">,
  right: Pick<ReportDeliveryEventLike, "createdAt">
) {
  return (toDate(left.createdAt)?.getTime() ?? 0) - (toDate(right.createdAt)?.getTime() ?? 0);
}

export function reportStatusLabel(status?: ReportStatusValue | string | null) {
  if (status === "SENT") return "共有済み";
  if (status === "REVIEWED") return "確認済み";
  if (status === "DRAFT") return "下書き";
  return "未生成";
}

export function reportDeliveryEventLabel(eventType: ReportDeliveryEventTypeValue | string) {
  return EVENT_LABELS[eventType as ReportDeliveryEventTypeValue] ?? "状態更新";
}

export function sortReportDeliveryEvents(events?: ReportDeliveryEventLike[] | null) {
  return [...(events ?? [])].sort(compareCreatedAtAsc);
}

export function serializeReportDeliveryHistoryItem(
  event: ReportDeliveryEventLike
): ReportDeliveryHistoryItem {
  return {
    id: event.id,
    eventType: event.eventType,
    label: reportDeliveryEventLabel(event.eventType),
    deliveryChannel: event.deliveryChannel ?? null,
    note: event.note ?? null,
    createdAt: toDate(event.createdAt)?.toISOString() ?? new Date(0).toISOString(),
    actor: event.actor ?? null,
  };
}

export function deriveReportDeliveryState(report: ReportWithDeliveryLike): ReportDeliveryState {
  const latestEvent = sortReportDeliveryEvents(report.deliveryEvents).at(-1);
  if (latestEvent) {
    return EVENT_STATE_MAP[latestEvent.eventType as ReportDeliveryEventTypeValue] ?? "draft";
  }
  if (report.status === "SENT") return "sent";
  if (report.status === "REVIEWED") return "reviewed";
  return "draft";
}

export function reportDeliveryStateLabel(state: ReportDeliveryState) {
  return STATE_LABELS[state];
}

export function buildReportDeliverySummary(report: ReportWithDeliveryLike) {
  const history = sortReportDeliveryEvents(report.deliveryEvents).map(serializeReportDeliveryHistoryItem);
  const deliveryState = deriveReportDeliveryState(report);

  return {
    workflowStatusLabel: reportStatusLabel(report.status),
    deliveryState,
    deliveryStateLabel: reportDeliveryStateLabel(deliveryState),
    history,
    latestEvent: history.at(-1) ?? null,
    isShareCompleted:
      deliveryState === "sent" ||
      deliveryState === "resent" ||
      deliveryState === "delivered" ||
      deliveryState === "manual_shared",
    needsReview: report.status === "DRAFT",
    needsShare: report.status === "REVIEWED" || deliveryState === "failed" || deliveryState === "bounced",
  };
}
