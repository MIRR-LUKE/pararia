import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { buildOperationalLog } from "../lib/operational-log";
import { normalizeLessonReportForView, normalizeNextActionsForView } from "../lib/conversation-artifacts-view";
import { toPrismaJson } from "../lib/prisma-json";

const operationalLog = buildOperationalLog({
  sessionType: "LESSON_REPORT",
  summaryMarkdown: "## 本日の指導サマリー\n授業の要点を整理した",
  timeline: {
    title: "一次関数",
    what_happened: "傾きの読み取りを確認した",
  } as any,
  nextActions: {
    owner: "STUDENT",
    action: "ワークを2ページ解く",
    metric: "2日以内に完了",
    why: "理解を定着させるため",
  } as any,
  lessonReport: {
    todayGoal: "一次関数の傾きを理解する",
    covered: "グラフの読み取り" as any,
    blockers: { note: "符号ミスがあった" } as any,
    nextLessonFocus: "式とグラフの対応" as any,
    parentShareDraft: "宿題の見守りをお願いしたい",
  },
});

assert.ok(operationalLog.theme.length > 0);
assert.ok(operationalLog.facts.length > 0);
assert.ok(operationalLog.nextChecks.length > 0);
assert.ok(operationalLog.parentShare.length > 0);

const nextActions = normalizeNextActionsForView({
  owner: "COACH",
  action: "宿題の解き直しを確認する",
  metric: "次回冒頭5分で確認",
  why: "理解の抜けを早めに見つける",
} as any);

assert.equal(nextActions.length, 1);
assert.equal(nextActions[0]?.owner, "COACH");

const lessonReport = normalizeLessonReportForView({
  todayGoal: "一次関数の理解",
  covered: ["傾き", "切片"],
  blockers: ["符号ミス"],
  parentShareDraft: "宿題の声かけがあると進みやすい",
});

assert.equal(lessonReport?.goal, "一次関数の理解");
assert.deepEqual(lessonReport?.did, ["傾き", "切片"]);
assert.deepEqual(lessonReport?.blocked, ["符号ミス"]);
assert.equal(lessonReport?.coachMemo, "宿題の声かけがあると進みやすい");

const dbNull = toPrismaJson(null);
assert.equal(dbNull, Prisma.DbNull);

const cleanedSegments = toPrismaJson([
  { start: 0, end: undefined, text: "こんにちは" },
  { start: 2, end: 4, text: "よろしくお願いします" },
]) as any[];

assert.equal(cleanedSegments[0]?.start, 0);
assert.equal("end" in cleanedSegments[0], false);
assert.equal(cleanedSegments[1]?.end, 4);

console.log("artifact-guards smoke check passed");
