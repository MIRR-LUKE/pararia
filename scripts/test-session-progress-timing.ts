import assert from "node:assert/strict";
import { buildSessionProgressTimingSnapshot } from "../lib/session-progress/timing";

const timing = buildSessionProgressTimingSnapshot({
  sessionId: "session-1",
  conversationId: "conversation-1",
  sessionCreatedAt: "2026-04-17T11:00:00.000Z",
  parts: [
    {
      createdAt: "2026-04-17T11:00:01.000Z",
      qualityMetaJson: {
        lastAcceptedAt: "2026-04-17T11:00:01.000Z",
        lastCompletedAt: "2026-04-17T11:00:10.000Z",
        sttSeconds: 9,
        sttPrepareMs: 1800,
        sttTranscribeWorkerMs: 5200,
        sttFinalizeMs: 900,
        audioDurationSeconds: 65,
      },
    },
  ],
  conversation: {
    createdAt: "2026-04-17T11:00:24.000Z",
    qualityMetaJson: {
      jobSecondsFinalize: 12,
      llmApiCallsFinalize: 1,
      llmInputTokensActual: 1200,
      llmCachedInputTokensActual: 300,
      llmOutputTokensActual: 520,
      llmCostUsd: 0.011,
      finalizeJob: {
        durationMs: 12_000,
      },
    },
    jobs: [
      {
        type: "FINALIZE",
        executionId: "exec-finalize-1",
        startedAt: "2026-04-17T11:00:12.000Z",
        finishedAt: "2026-04-17T11:00:24.000Z",
        lastQueueLagMs: 1500,
      },
      {
        type: "GENERATE_NEXT_MEETING_MEMO",
        executionId: "exec-memo-1",
        startedAt: "2026-04-17T11:00:24.000Z",
        finishedAt: "2026-04-17T11:00:30.000Z",
      },
    ],
  },
  nextMeetingMemo: {
    status: "READY",
    updatedAt: "2026-04-17T11:00:30.000Z",
  },
});

assert.equal(timing.traceId, "exec-finalize-1");
assert.equal(timing.pipelineStartedAt, "2026-04-17T11:00:01.000Z");
assert.equal(timing.transcriptReadyAt, "2026-04-17T11:00:10.000Z");
assert.equal(timing.logReadyAt, "2026-04-17T11:00:24.000Z");
assert.equal(timing.nextMeetingMemoReadyAt, "2026-04-17T11:00:30.000Z");
assert.equal(timing.audioSeconds, 65);
assert.equal(timing.sttPrepareSeconds, 1.8);
assert.equal(timing.transcriptionSeconds, 9);
assert.equal(timing.sttWorkerSeconds, 5.2);
assert.equal(timing.sttFinalizeSeconds, 0.9);
assert.equal(timing.acceptedToTranscriptSeconds, 9);
assert.equal(timing.logGenerationSeconds, 12);
assert.equal(timing.transcriptToLogSeconds, 14);
assert.equal(timing.nextMeetingMemoSeconds, 6);
assert.equal(timing.logToNextMeetingMemoSeconds, 6);
assert.equal(timing.totalPipelineSeconds, 29);
assert.equal(timing.finalizeQueueLagSeconds, 1.5);
assert.equal(timing.llmApiCalls, 1);
assert.equal(timing.llmInputTokens, 1200);
assert.equal(timing.llmCachedInputTokens, 300);
assert.equal(timing.llmCachedInputRatio, 0.25);
assert.equal(timing.llmOutputTokens, 520);
assert.equal(timing.llmCostUsd, 0.011);

const fallbackTiming = buildSessionProgressTimingSnapshot({
  sessionId: "session-2",
  conversationId: "conversation-2",
  sessionCreatedAt: "2026-04-17T12:00:00.000Z",
  parts: [
    {
      createdAt: "2026-04-17T12:00:00.000Z",
      qualityMetaJson: {
        lastAcceptedAt: "2026-04-17T12:00:02.000Z",
        lastCompletedAt: "2026-04-17T12:00:12.000Z",
      },
    },
  ],
  conversation: {
    createdAt: "2026-04-17T12:00:25.000Z",
    qualityMetaJson: {},
    jobs: [],
  },
  nextMeetingMemo: null,
});

assert.equal(fallbackTiming.traceId, "conversation-2");
assert.equal(fallbackTiming.sttPrepareSeconds, null);
assert.equal(fallbackTiming.transcriptionSeconds, 10);
assert.equal(fallbackTiming.sttWorkerSeconds, null);
assert.equal(fallbackTiming.sttFinalizeSeconds, null);
assert.equal(fallbackTiming.logGenerationSeconds, null);
assert.equal(fallbackTiming.totalPipelineSeconds, 23);

console.log("session progress timing regression checks passed");
