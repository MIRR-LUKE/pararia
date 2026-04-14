#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { ConversationJobType, NextMeetingMemoStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  createNextMeetingMemoFixture,
  createCriticalPathSmokeApi,
  loadCriticalPathSmokeEnv,
  resetNextMeetingMemoFixture,
} from "./lib/critical-path-smoke";

type NextMeetingMemoRouteSmokeResult = {
  sessionId: string;
  conversationId: string;
  queuedJobStatus: string;
  memoStatus: string;
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

export async function runNextMeetingMemoRouteSmoke(baseUrl: string): Promise<NextMeetingMemoRouteSmokeResult> {
  await loadCriticalPathSmokeEnv();
  process.env.CRITICAL_PATH_BASE_URL = baseUrl;
  const fixture = await createNextMeetingMemoFixture();
  await resetNextMeetingMemoFixture(fixture.sessionId, fixture.conversationId);

  const { api, close } = await createCriticalPathSmokeApi(baseUrl);
  try {
    const response = await api.post(`/api/sessions/${fixture.sessionId}/next-meeting-memo/regenerate`);
    assert.equal(response.ok(), true, `next-meeting-memo route failed: ${response.status()}`);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.sessionId, fixture.sessionId);
    assert.equal(body.conversationId, fixture.conversationId);

    const queuedJob = await prisma.conversationJob.findUnique({
      where: {
        conversationId_type: {
          conversationId: fixture.conversationId,
          type: ConversationJobType.GENERATE_NEXT_MEETING_MEMO,
        },
      },
      select: {
        status: true,
        attempts: true,
        maxAttempts: true,
      },
    });
    assert.ok(queuedJob, "next meeting memo job should be queued");
    assert.equal(queuedJob?.status, "QUEUED");
    assert.equal(queuedJob?.attempts, 0);
    assert.ok((queuedJob?.maxAttempts ?? 0) >= 1);

    const memo = await prisma.nextMeetingMemo.findUnique({
      where: { sessionId: fixture.sessionId },
      select: {
        status: true,
        conversationId: true,
        previousSummary: true,
        suggestedTopics: true,
        errorMessage: true,
      },
    });
    assert.ok(memo, "next meeting memo row should exist");
    assert.equal(memo?.status, NextMeetingMemoStatus.QUEUED);
    assert.equal(memo?.conversationId, fixture.conversationId);
    assert.equal(memo?.previousSummary, null);
    assert.equal(memo?.suggestedTopics, null);
    assert.equal(memo?.errorMessage, null);

    return {
      sessionId: body.sessionId,
      conversationId: body.conversationId,
      queuedJobStatus: queuedJob.status,
      memoStatus: memo.status,
    };
  } finally {
    await resetNextMeetingMemoFixture(fixture.sessionId, fixture.conversationId).catch(() => {});
    await fixture.cleanup().catch(() => {});
    await close().catch(() => {});
  }
}

async function main() {
  const baseUrl = argValue("--base-url") || process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000";
  const result = await runNextMeetingMemoRouteSmoke(baseUrl);
  console.log(JSON.stringify({ label: "next-meeting-memo-route", baseUrl, result }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
