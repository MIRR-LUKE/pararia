#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  createCriticalPathSmokeApi,
  createStudentRoomFixture,
  loadCriticalPathSmokeEnv,
} from "./lib/critical-path-smoke";

type ConversationRouteSmokeResult = {
  studentId: string;
  sessionId: string;
  conversationId: string;
  reportId: string;
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

export async function runConversationRouteSmoke(baseUrl: string): Promise<ConversationRouteSmokeResult> {
  await loadCriticalPathSmokeEnv();
  process.env.CRITICAL_PATH_BASE_URL = baseUrl;
  const fixture = await createStudentRoomFixture();
  const { api, close } = await createCriticalPathSmokeApi(baseUrl);

  try {
    const conversationResponse = await api.get(`/api/conversations/${fixture.conversationId}`);
    assert.equal(conversationResponse.ok(), true, `conversation GET failed: ${conversationResponse.status()}`);
    const conversationBody = await conversationResponse.json();
    assert.equal(conversationBody.conversation?.id, fixture.conversationId);
    assert.equal(conversationBody.conversation?.student?.id, fixture.studentId);
    assert.match(String(conversationBody.conversation?.summaryMarkdown ?? ""), /数学は丁寧に取り組めて/);
    assert.match(String(conversationBody.conversation?.formattedTranscript ?? ""), /^## 面談/m);
    assert.match(String(conversationBody.conversation?.rawTextOriginal ?? ""), /smoke transcript/);

    const briefResponse = await api.get(`/api/conversations/${fixture.conversationId}?brief=1`);
    assert.equal(briefResponse.ok(), true, `conversation brief GET failed: ${briefResponse.status()}`);
    const briefBody = await briefResponse.json();
    assert.equal(briefBody.conversation?.id, fixture.conversationId);
    assert.equal(briefBody.conversation?.sessionId, fixture.sessionId);

    const reportResponse = await api.get(`/api/reports/${fixture.reportId}`);
    assert.equal(reportResponse.ok(), true, `report GET failed: ${reportResponse.status()}`);
    const reportBody = await reportResponse.json();
    assert.equal(reportBody.report?.id, fixture.reportId);
    assert.deepEqual(reportBody.report?.sourceLogIds ?? [], [fixture.conversationId]);

    const sessionResponse = await api.get(`/api/sessions/${fixture.sessionId}`);
    assert.equal(sessionResponse.ok(), true, `session GET failed: ${sessionResponse.status()}`);
    const sessionBody = await sessionResponse.json();
    assert.equal(sessionBody.session?.id, fixture.sessionId);
    assert.equal(sessionBody.session?.conversation?.id, fixture.conversationId);
    assert.equal(sessionBody.session?.student?.id, fixture.studentId);

    return {
      studentId: fixture.studentId,
      sessionId: fixture.sessionId,
      conversationId: fixture.conversationId,
      reportId: fixture.reportId,
    };
  } finally {
    await fixture.cleanup().catch(() => {});
    await close().catch(() => {});
  }
}

async function main() {
  const baseUrl = argValue("--base-url") || process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000";
  const result = await runConversationRouteSmoke(baseUrl);
  console.log(JSON.stringify({ label: "conversation-route", baseUrl, result }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
