#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  createCriticalPathSmokeApi,
  createStudentRoomFixture,
  loadCriticalPathSmokeEnv,
} from "./lib/critical-path-smoke";

type SessionProgressRouteSmokeResult = {
  sessionId: string;
  conversationId: string | null;
  stage: string;
  canOpenLog: boolean;
  stepStatuses: string[];
  totalPipelineSeconds: number | null;
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

export async function runSessionProgressRouteSmoke(baseUrl: string): Promise<SessionProgressRouteSmokeResult> {
  await loadCriticalPathSmokeEnv();
  process.env.CRITICAL_PATH_BASE_URL = baseUrl;
  const fixture = await createStudentRoomFixture();
  const { api, close } = await createCriticalPathSmokeApi(baseUrl);

  try {
    const processResponse = await api.post(`/api/sessions/${fixture.sessionId}/progress`);
    assert.equal(processResponse.ok(), true, `session progress POST failed: ${processResponse.status()}`);

    const response = await api.get(`/api/sessions/${fixture.sessionId}/progress`);
    assert.equal(response.ok(), true, `session progress GET failed: ${response.status()}`);

    const body = await response.json();
    assert.equal(body.session?.id, fixture.sessionId);
    assert.equal(body.conversation?.id ?? null, fixture.conversationId);
    assert.equal(body.conversation?.status, "DONE");
    assert.equal(body.progress?.stage, "READY");
    assert.equal(body.progress?.canOpenLog, true);
    assert.ok(Array.isArray(body.parts), "parts should be an array");
    assert.equal(body.parts.length, 0);
    assert.ok(body.timing && typeof body.timing === "object", "timing should be returned");
    assert.equal(typeof body.timing.traceId, "string");
    assert.equal(typeof body.timing.totalPipelineSeconds, "number");
    assert.deepEqual(
      body.progress?.progress?.steps?.map((step: { status: string }) => step.status),
      ["complete", "complete", "complete", "complete"]
    );

    return {
      sessionId: body.session.id,
      conversationId: body.conversation?.id ?? null,
      stage: body.progress.stage,
      canOpenLog: body.progress.canOpenLog,
      stepStatuses: body.progress.progress.steps.map((step: { status: string }) => step.status),
      totalPipelineSeconds: body.timing?.totalPipelineSeconds ?? null,
    };
  } finally {
    await fixture.cleanup().catch(() => {});
    await close().catch(() => {});
  }
}

async function main() {
  const baseUrl = argValue("--base-url") || process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000";
  const result = await runSessionProgressRouteSmoke(baseUrl);
  console.log(JSON.stringify({ label: "session-progress-route", baseUrl, result }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
