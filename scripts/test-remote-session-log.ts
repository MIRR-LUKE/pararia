import assert from "node:assert/strict";
import { loginForCriticalPathSmoke } from "./lib/critical-path-smoke";

const BASE_URL = process.argv[2]?.trim() || process.env.CRITICAL_PATH_BASE_URL?.trim() || "http://127.0.0.1:3000";
const BOOTSTRAP_URL = process.argv[3]?.trim() || process.env.CRITICAL_PATH_BOOTSTRAP_URL?.trim() || "";
const SMOKE_TRANSCRIPT =
  "今日は模試の振り返りを行い、数学の途中式を飛ばさないことと、英単語の復習時間を毎日確保することを確認した。次回までの行動が本人の言葉で整理できている。";

type ProgressResponse = {
  session?: { id?: string; status?: string };
  conversation?: {
    id?: string;
    status?: string;
    summaryMarkdown?: string | null;
    jobs?: Array<{
      type?: string;
      status?: string;
      lastError?: string | null;
    }>;
  } | null;
  progress?: {
    stage?: string;
    statusLabel?: string;
  };
};

type ProgressJob = {
  type?: string;
  status?: string;
  lastError?: string | null;
};

async function main() {
  const client = await loginForCriticalPathSmoke(BASE_URL, {
    bootstrapUrl: BOOTSTRAP_URL,
  });
  const uniqueSuffix = `${Date.now()}`;

  let studentId: string | null = null;
  let sessionId: string | null = null;

  try {
    const createdStudent = await client.requestJson<{ student?: { id?: string } }>("/api/students", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: `Remote Smoke ${uniqueSuffix}`,
        grade: "高2",
        course: "smoke",
        guardianNames: "Smoke Guardian",
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
        title: `Remote Smoke ${uniqueSuffix}`,
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

    const deadline = Date.now() + 240_000;
    let lastProgress: ProgressResponse | null = null;

    while (Date.now() < deadline) {
      await client.requestJson(`/api/sessions/${sessionId}/progress`, {
        method: "POST",
      });
      const progressResult = (await client.requestJson(
        `/api/sessions/${sessionId}/progress`
      )) as {
        response: Response;
        body: ProgressResponse;
      };
      assert.equal(progressResult.response.status, 200, `progress failed: ${progressResult.response.status}`);
      lastProgress = progressResult.body;

      const conversation = progressResult.body.conversation;
      if (conversation?.status === "DONE" && conversation.id && conversation.summaryMarkdown?.trim()) {
        console.log(
          JSON.stringify(
            {
              baseUrl: BASE_URL,
              sessionId,
              conversationId: conversation.id,
              stage: progressResult.body.progress?.stage ?? null,
              statusLabel: progressResult.body.progress?.statusLabel ?? null,
            },
            null,
            2
          )
        );
        console.log("remote session log smoke passed");
        return;
      }

      if (conversation?.status === "ERROR") {
        throw new Error(
          `conversation generation failed: ${
            conversation.jobs?.map((job: ProgressJob) => `${job.type}:${job.status}:${job.lastError ?? ""}`).join(" | ") ?? "unknown"
          }`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error(`conversation generation timed out: ${JSON.stringify(lastProgress)}`);
  } finally {
    if (studentId) {
      await client.requestJson(`/api/students/${studentId}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "remote_smoke_cleanup" }),
      }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
