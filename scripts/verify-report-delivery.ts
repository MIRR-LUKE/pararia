import assert from "node:assert/strict";
import {
  buildReportDeliverySummary,
  deriveReportDeliveryState,
  reportDeliveryEventLabel,
  reportDeliveryStateLabel,
  reportStatusLabel,
  serializeReportDeliveryHistoryItem,
} from "../lib/report-delivery";

type Case = {
  name: string;
  input: Parameters<typeof buildReportDeliverySummary>[0];
  expected: {
    state: ReturnType<typeof deriveReportDeliveryState>;
    stateLabel: string;
    statusLabel: string;
    historyLabels: string[];
    latestEventLabel?: string;
  };
};

const cases: Case[] = [
  {
    name: "draft_only",
    input: { status: "DRAFT", deliveryEvents: [] },
    expected: {
      state: "draft",
      stateLabel: "レビュー待ち",
      statusLabel: "下書き",
      historyLabels: [],
    },
  },
  {
    name: "reviewed_then_manual_share",
    input: {
      status: "REVIEWED",
      reviewedAt: "2026-03-22T01:00:00.000Z",
      deliveryChannel: "manual",
      deliveryEvents: [
        { eventType: "DRAFT_CREATED", createdAt: "2026-03-22T00:00:00.000Z" },
        { eventType: "REVIEWED", createdAt: "2026-03-22T01:00:00.000Z" },
        { eventType: "MANUAL_SHARED", createdAt: "2026-03-22T02:00:00.000Z", deliveryChannel: "manual" },
      ],
    },
    expected: {
      state: "manual_shared",
      stateLabel: "手動共有",
      statusLabel: "確認済み",
      historyLabels: ["ドラフト生成", "レビュー完了", "手動共有"],
      latestEventLabel: "手動共有",
    },
  },
  {
    name: "sent_then_delivered",
    input: {
      status: "SENT",
      sentAt: "2026-03-22T03:00:00.000Z",
      deliveryChannel: "email",
      deliveryEvents: [
        { eventType: "DRAFT_CREATED", createdAt: "2026-03-22T00:00:00.000Z" },
        { eventType: "REVIEWED", createdAt: "2026-03-22T01:00:00.000Z" },
        { eventType: "SENT", createdAt: "2026-03-22T03:00:00.000Z", deliveryChannel: "email" },
        { eventType: "DELIVERED", createdAt: "2026-03-22T03:05:00.000Z", deliveryChannel: "email" },
      ],
    },
    expected: {
      state: "delivered",
      stateLabel: "配達済み",
      statusLabel: "共有済み",
      historyLabels: ["ドラフト生成", "レビュー完了", "送信済み", "配達済み"],
      latestEventLabel: "配達済み",
    },
  },
  {
    name: "resent_after_failure",
    input: {
      status: "SENT",
      sentAt: "2026-03-22T03:00:00.000Z",
      deliveryChannel: "email",
      deliveryEvents: [
        { eventType: "DRAFT_CREATED", createdAt: "2026-03-22T00:00:00.000Z" },
        { eventType: "REVIEWED", createdAt: "2026-03-22T01:00:00.000Z" },
        { eventType: "FAILED", createdAt: "2026-03-22T03:00:00.000Z", deliveryChannel: "email" },
        { eventType: "RESENT", createdAt: "2026-03-22T03:10:00.000Z", deliveryChannel: "email" },
      ],
    },
    expected: {
      state: "resent",
      stateLabel: "再送済み",
      statusLabel: "共有済み",
      historyLabels: ["ドラフト生成", "レビュー完了", "送信失敗", "再送"],
      latestEventLabel: "再送",
    },
  },
];

for (const testCase of cases) {
  const summary = buildReportDeliverySummary(testCase.input);

  assert.equal(deriveReportDeliveryState(testCase.input), testCase.expected.state, `${testCase.name}: derived state`);
  assert.equal(summary.deliveryStateLabel, testCase.expected.stateLabel, `${testCase.name}: state label`);
  assert.equal(summary.workflowStatusLabel, testCase.expected.statusLabel, `${testCase.name}: workflow label`);
  assert.deepEqual(summary.history.map((item) => item.label), testCase.expected.historyLabels, `${testCase.name}: history labels`);
  if (typeof testCase.expected.latestEventLabel !== "undefined") {
    assert.equal(summary.latestEvent?.label, testCase.expected.latestEventLabel, `${testCase.name}: latest event label`);
  }
}

assert.equal(reportStatusLabel("DRAFT"), "下書き");
assert.equal(reportStatusLabel("REVIEWED"), "確認済み");
assert.equal(reportStatusLabel("SENT"), "共有済み");
assert.equal(reportDeliveryStateLabel("manual_shared"), "手動共有");
assert.equal(reportDeliveryEventLabel("BOUNCED"), "宛先エラー");
assert.equal(
  serializeReportDeliveryHistoryItem({
    eventType: "MANUAL_SHARED",
    createdAt: "2026-03-22T02:00:00.000Z",
    deliveryChannel: "manual",
  }).label,
  "手動共有"
);

console.log("report-delivery smoke check passed");
