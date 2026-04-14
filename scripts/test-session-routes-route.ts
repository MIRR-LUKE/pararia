import assert from "node:assert/strict";
import { ConversationStatus, SessionPartType } from "@prisma/client";
import { prisma } from "../lib/db";
import {
  SESSION_ROUTE_SESSION_ID,
  cleanupSessionRouteSmokeSession,
  isMainModule,
  loginForCriticalPathSmoke,
  prepareSessionRouteSmokeSession,
} from "./lib/critical-path-smoke";

const SMOKE_TRANSCRIPT =
  "今日は模試の振り返りを行い、数学の見直し方法と英単語の復習計画を整理した。次回まで毎日三十分の復習を続ける方針で合意した。";

async function waitForGeneratedConversation(sessionId: string, client: Awaited<ReturnType<typeof loginForCriticalPathSmoke>>) {
  const deadline = Date.now() + 45_000;

  while (Date.now() < deadline) {
    const conversation = await prisma.conversationLog.findUnique({
      where: { sessionId },
      select: {
        id: true,
        status: true,
        summaryMarkdown: true,
        artifactJson: true,
        jobs: {
          select: {
            type: true,
            status: true,
            lastError: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (
      conversation?.status === ConversationStatus.DONE &&
      (Boolean(conversation.summaryMarkdown?.trim()) || Boolean(conversation.artifactJson))
    ) {
      return conversation;
    }

    if (conversation?.status === ConversationStatus.ERROR) {
      throw new Error(
        `conversation generation failed: ${conversation.jobs.map((job) => `${job.type}:${job.status}:${job.lastError ?? ""}`).join(" | ")}`
      );
    }

    await client.requestJson(`/api/sessions/${sessionId}/progress?process=1`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const latestConversation = await prisma.conversationLog.findUnique({
    where: { sessionId },
    select: {
      id: true,
      status: true,
      jobs: {
        select: {
          type: true,
          status: true,
          lastError: true,
        },
      },
    },
  });
  throw new Error(
    `conversation generation timed out: ${JSON.stringify(latestConversation)}`
  );
}

export async function runSessionRoutesRouteTest() {
  await prepareSessionRouteSmokeSession();
  try {
    const client = await loginForCriticalPathSmoke();

    const sessionView = await client.requestJson<{
      session?: { id?: string };
    }>(`/api/sessions/${SESSION_ROUTE_SESSION_ID}`);
    assert.equal(sessionView.response.status, 200, "session detail should load");
    assert.equal(sessionView.body.session?.id, SESSION_ROUTE_SESSION_ID, "session detail should return requested id");

    const initialProgress = await client.requestJson<{
      session?: { id?: string };
      progress?: { stage?: string };
    }>(`/api/sessions/${SESSION_ROUTE_SESSION_ID}/progress`);
    assert.equal(initialProgress.response.status, 200, "session progress should load");
    assert.equal(initialProgress.body.session?.id, SESSION_ROUTE_SESSION_ID, "progress should return requested id");

    const formData = new FormData();
    formData.set("partType", SessionPartType.FULL);
    formData.set("transcript", SMOKE_TRANSCRIPT);

    const submission = await client.requestJson<{
      part?: { id?: string; status?: string };
      session?: { id?: string; status?: string };
      generationDeferred?: boolean;
    }>(`/api/sessions/${SESSION_ROUTE_SESSION_ID}/parts`, {
      method: "POST",
      body: formData,
    });
    assert.equal(submission.response.status, 200, "session parts submission should succeed");
    assert.equal(submission.body.session?.id, SESSION_ROUTE_SESSION_ID, "submission should keep session id");
    assert.equal(submission.body.part?.status, "READY", "manual transcript part should be READY");
    assert.equal(submission.body.generationDeferred, true, "submission should defer generation");

    const persistedPart = await prisma.sessionPart.findUnique({
      where: {
        sessionId_partType: {
          sessionId: SESSION_ROUTE_SESSION_ID,
          partType: SessionPartType.FULL,
        },
      },
      select: {
        id: true,
        status: true,
        rawTextOriginal: true,
        rawTextCleaned: true,
      },
    });
    assert.ok(persistedPart, "session part should persist");
    assert.equal(persistedPart.status, "READY", "persisted part should stay READY");
    assert.match(persistedPart.rawTextOriginal ?? "", /模試の振り返り/);

    const processingProgress = await client.requestJson<{
      session?: { id?: string };
      parts?: Array<{ id?: string; status?: string }>;
      progress?: { stage?: string };
    }>(`/api/sessions/${SESSION_ROUTE_SESSION_ID}/progress?process=1`);
    assert.equal(processingProgress.response.status, 200, "session progress with process=1 should succeed");
    assert.equal(processingProgress.body.session?.id, SESSION_ROUTE_SESSION_ID, "processed progress should keep session id");
    assert.ok(Array.isArray(processingProgress.body.parts), "processed progress should include parts");

    const conversation = await waitForGeneratedConversation(SESSION_ROUTE_SESSION_ID, client);
    assert.equal(conversation.status, ConversationStatus.DONE, "conversation should be generated");
    assert.ok(
      Boolean(conversation.summaryMarkdown?.trim()) || Boolean(conversation.artifactJson),
      "generated conversation should keep rendered output"
    );

    console.log("session routes smoke passed");
  } finally {
    await cleanupSessionRouteSmokeSession();
  }
}

if (isMainModule(import.meta.url)) {
  runSessionRoutesRouteTest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
