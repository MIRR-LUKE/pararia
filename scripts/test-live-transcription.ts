#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { SessionPartType } from "@prisma/client";
import { buildFinalizedLivePartFromManifest } from "../lib/live-session-transcription";

async function main() {
  const finalized = buildFinalizedLivePartFromManifest({
    sessionId: "session-live-test",
    partType: SessionPartType.FULL,
    mimeType: "audio/webm",
    totalDurationMs: 12000,
    chunks: [
      {
        sequence: 1,
        fileName: "chunk-1.webm",
        mimeType: "audio/webm",
        byteSize: 1200,
        storageUrl: "chunk-1.webm",
        startedAtMs: 6000,
        durationMs: 6000,
        status: "READY",
        rawTextOriginal: "次回までに英語の音読を五回やる。",
        rawTextCleaned: "次回までに英語の音読を五回やる。",
        rawSegments: [{ start: 0.2, end: 1.4, text: "次回までに英語の音読を五回やる。", speaker: "B" }],
        meta: {
          sttSeconds: 2,
          sttModel: "gpt-4o-transcribe-diarize",
          sttResponseFormat: "diarized_json",
          sttRecoveryUsed: false,
          sttAttemptCount: 1,
          sttSegmentCount: 1,
          sttSpeakerCount: 1,
          sttQualityWarnings: [],
        },
      },
      {
        sequence: 0,
        fileName: "chunk-0.webm",
        mimeType: "audio/webm",
        byteSize: 1100,
        storageUrl: "chunk-0.webm",
        startedAtMs: 0,
        durationMs: 6000,
        status: "READY",
        rawTextOriginal: "模試の数学で最初の一手が出ずに止まりやすい。",
        rawTextCleaned: "模試の数学で最初の一手が出ずに止まりやすい。",
        rawSegments: [{ start: 0.1, end: 1.1, text: "模試の数学で最初の一手が出ずに止まりやすい。", speaker: "A" }],
        meta: {
          sttSeconds: 1,
          sttModel: "gpt-4o-transcribe-diarize",
          sttResponseFormat: "diarized_json",
          sttRecoveryUsed: true,
          sttAttemptCount: 2,
          sttSegmentCount: 1,
          sttSpeakerCount: 1,
          sttQualityWarnings: [],
        },
      },
    ],
  });

  assert.match(finalized.rawTextOriginal, /模試の数学/);
  assert.match(finalized.rawTextOriginal, /英語の音読/);
  assert.ok(finalized.rawTextOriginal.indexOf("模試の数学") < finalized.rawTextOriginal.indexOf("英語の音読"));
  assert.equal(finalized.rawSegments.length, 2);
  assert.equal(finalized.rawSegments[0]?.start, 0.1);
  assert.equal(finalized.rawSegments[1]?.start, 6.2);
  assert.equal(finalized.qualityMeta.liveChunkCount, 2);
  assert.equal(finalized.qualityMeta.sttRecoveryUsed, true);
  assert.equal(finalized.qualityMeta.liveRecoveredChunkCount, 1);

  console.log("test-live-transcription: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
