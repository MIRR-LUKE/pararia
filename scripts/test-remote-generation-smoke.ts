#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { loginForCriticalPathSmoke } from "./lib/critical-path-smoke";
import { assertRemoteGenerationSmokeAllowed } from "./lib/environment-safety";

const DEFAULT_BASE_URL = process.env.CRITICAL_PATH_BASE_URL?.trim() || "https://pararia.vercel.app";
const SMOKE_TRANSCRIPT =
  "今日は模試の振り返りを行い、数学は途中式を飛ばさずに解き切ること、英語は毎日音読を続けること、世界史は使っている教材を最後までやり切ることを確認した。次回までの行動を本人の言葉で整理できている。";

type ProgressJob = {
  type?: string;
  status?: string;
  lastError?: string | null;
};

type ProgressResponse = {
  session?: { id?: string; status?: string };
  conversation?: {
    id?: string;
    status?: string;
    summaryMarkdown?: string | null;
    jobs?: ProgressJob[];
  } | null;
  progress?: {
    stage?: string;
    statusLabel?: string;
  };
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForConversationDone(
  client: Awaited<ReturnType<typeof loginForCriticalPathSmoke>>,
  sessionId: string
) {
  const startedAt = Date.now();
  const deadline = startedAt + 240_000;
  let lastProgress: ProgressResponse | null = null;

  while (Date.now() < deadline) {
    await client.requestJson(`/api/sessions/${sessionId}/progress`, {
      method: "POST",
    });
    const progressResult = (await client.requestJson(
      `/api/sessions/${sessionId}/progress`
    )) as {
      response: { status: number };
      body: ProgressResponse;
    };
    assert.equal(progressResult.response.status, 200, `progress failed: ${progressResult.response.status}`);
    lastProgress = progressResult.body;

    const conversation = progressResult.body.conversation;
    if (conversation?.status === "DONE" && conversation.id && conversation.summaryMarkdown?.trim()) {
      return {
        conversationId: conversation.id,
        waitMs: Date.now() - startedAt,
        statusLabel: progressResult.body.progress?.statusLabel ?? null,
      };
    }

    if (conversation?.status === "ERROR") {
      throw new Error(
        `conversation generation failed: ${
          conversation.jobs?.map((job) => `${job.type}:${job.status}:${job.lastError ?? ""}`).join(" | ") ?? "unknown"
        }`
      );
    }

    await sleep(2_000);
  }

  throw new Error(`conversation generation timed out: ${JSON.stringify(lastProgress)}`);
}

async function main() {
  const baseUrl = argValue("--base-url") || DEFAULT_BASE_URL;
  assertRemoteGenerationSmokeAllowed(baseUrl, "remote-generation-smoke");

  const client = await loginForCriticalPathSmoke(baseUrl);
  const uniqueSuffix = `${Date.now()}`;
  let studentId: string | null = null;
  let sessionId: string | null = null;
  let reportId: string | null = null;

  try {
    const setupStartedAt = Date.now();
    const createdStudent = await client.requestJson<{ student?: { id?: string } }>("/api/students", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: `保全smoke ${uniqueSuffix}`,
        grade: "検証用",
        course: "generation-smoke",
        guardianNames: "保全確認 保護者",
      }),
    });
    assert.equal(createdStudent.response.status, 201, `student create failed: ${createdStudent.response.status}`);
    studentId = createdStudent.body.student?.id ?? null;
    assert.ok(studentId, "student id is required");

    const createdSession = await client.requestJson<{ session?: { id?: string } }>("/api/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        studentId,
        type: "INTERVIEW",
        title: `保全smoke ${uniqueSuffix}`,
      }),
    });
    assert.equal(createdSession.response.status, 201, `session create failed: ${createdSession.response.status}`);
    sessionId = createdSession.body.session?.id ?? null;
    assert.ok(sessionId, "session id is required");

    const formData = new FormData();
    formData.set("partType", "FULL");
    formData.set("transcript", SMOKE_TRANSCRIPT);
    const submission = await client.requestJson<{ part?: { id?: string; status?: string } }>(
      `/api/sessions/${sessionId}/parts`,
      {
        method: "POST",
        body: formData,
      }
    );
    assert.equal(submission.response.status, 200, `part submission failed: ${submission.response.status}`);
    assert.equal(submission.body.part?.status, "READY", "manual transcript part should be READY");

    const conversationResult = await waitForConversationDone(client, sessionId);

    const conversationDetail = await client.requestJson<{
      conversation?: {
        id?: string;
        summaryMarkdown?: string | null;
        artifactJson?: unknown;
      };
    }>(`/api/conversations/${conversationResult.conversationId}`);
    assert.equal(conversationDetail.response.status, 200, `conversation detail failed: ${conversationDetail.response.status}`);
    assert.ok(conversationDetail.body.conversation?.summaryMarkdown?.trim(), "conversation summary should be present");
    assert.ok(conversationDetail.body.conversation?.artifactJson, "conversation artifact should be present");

    const reportStartedAt = Date.now();
    const createdReport = await client.requestJson<{ report?: { id?: string } }>("/api/ai/generate-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": `remote-generation-smoke-${uniqueSuffix}`,
      },
      body: JSON.stringify({
        studentId,
        sessionIds: [sessionId],
      }),
    });
    assert.equal(createdReport.response.status, 200, `report generate failed: ${createdReport.response.status}`);
    reportId = createdReport.body.report?.id ?? null;
    assert.ok(reportId, "report id is required");

    const reportDetail = await client.requestJson<{
      report?: {
        id?: string;
        reportMarkdown?: string | null;
        sourceLogIds?: string[];
      };
    }>(`/api/reports/${reportId}`);
    assert.equal(reportDetail.response.status, 200, `report detail failed: ${reportDetail.response.status}`);
    assert.equal(reportDetail.body.report?.id, reportId, "report detail should return requested id");
    assert.ok(reportDetail.body.report?.reportMarkdown?.includes("いつも大変お世話になっております。"), "report should include greeting");
    assert.ok(
      reportDetail.body.report?.sourceLogIds?.includes(conversationResult.conversationId),
      "report should reference the generated conversation log"
    );

    const now = Date.now();
    console.log(
      JSON.stringify(
        {
          label: "remote-generation-smoke",
          baseUrl,
          studentId,
          sessionId,
          conversationId: conversationResult.conversationId,
          reportId,
          metrics: {
            totalMs: now - setupStartedAt,
            conversationWaitMs: conversationResult.waitMs,
            reportGenerationMs: now - reportStartedAt,
          },
          statusLabel: conversationResult.statusLabel,
        },
        null,
        2
      )
    );
    console.log("remote generation smoke passed");
  } finally {
    if (reportId) {
      await client.requestJson(`/api/reports/${reportId}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "remote_generation_smoke_cleanup" }),
      }).catch(() => {});
    }
    if (studentId) {
      await client.requestJson(`/api/students/${studentId}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "remote_generation_smoke_cleanup" }),
      }).catch(() => {});
    }
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
