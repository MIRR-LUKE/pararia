import assert from "node:assert/strict";
import { prisma } from "../lib/db";
import {
  NEXT_MEETING_CONVERSATION_ID,
  NEXT_MEETING_SESSION_ID,
  cleanupNextMeetingMemo,
  isMainModule,
  loginForCriticalPathSmoke,
} from "./lib/critical-path-smoke";

export async function runNextMeetingMemoRouteTest() {
  await cleanupNextMeetingMemo(NEXT_MEETING_SESSION_ID, NEXT_MEETING_CONVERSATION_ID);
  const client = await loginForCriticalPathSmoke();

  const regenerate = await client.requestJson(`/api/sessions/${NEXT_MEETING_SESSION_ID}/next-meeting-memo/regenerate`, {
    method: "POST",
  });
  assert.equal(regenerate.response.status, 200, "next-meeting-memo regenerate should succeed");
  assert.equal(regenerate.body.ok, true, "route should return ok");
  assert.equal(regenerate.body.sessionId, NEXT_MEETING_SESSION_ID, "route should echo sessionId");

  const job = await prisma.conversationJob.findUnique({
    where: {
      conversationId_type: {
        conversationId: NEXT_MEETING_CONVERSATION_ID,
        type: "GENERATE_NEXT_MEETING_MEMO",
      },
    },
  });
  assert.ok(job, "conversation job should exist");

  const memo = await prisma.nextMeetingMemo.findUnique({
    where: { sessionId: NEXT_MEETING_SESSION_ID },
  });
  assert.ok(memo, "next meeting memo should exist");
  assert.ok(["QUEUED", "GENERATING", "READY"].includes(memo.status), `unexpected memo status: ${memo.status}`);

  await cleanupNextMeetingMemo(NEXT_MEETING_SESSION_ID, NEXT_MEETING_CONVERSATION_ID);
  console.log("next-meeting-memo route smoke passed");
}

if (isMainModule(import.meta.url)) {
  runNextMeetingMemoRouteTest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
