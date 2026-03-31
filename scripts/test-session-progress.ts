import assert from "node:assert/strict";
import { buildSessionProgressState } from "../lib/session-progress";

const interviewPromotionError = buildSessionProgressState({
  sessionId: "session-interview",
  type: "INTERVIEW",
  parts: [
    {
      id: "part-interview",
      partType: "FULL",
      status: "ERROR",
      rawTextOriginal: "数学の見直しで式変形の途中を飛ばしやすい。",
      rawTextCleaned: "数学の見直しで式変形の途中を飛ばしやすい。",
      qualityMetaJson: {
        lastCompletedAt: new Date("2026-03-26T08:00:00.000Z").toISOString(),
        summaryPreview: "数学の見直しで式変形の途中を飛ばしやすい。",
        lastError:
          "Invalid prisma.conversationJob.upsert() invocation: The column `maxAttempts` does not exist in the current database.",
      },
    },
  ],
  conversation: null,
});

assert.equal(interviewPromotionError.stage, "ERROR");
assert.match(interviewPromotionError.progress.title, /ログ生成の準備/);
assert.match(interviewPromotionError.progress.description, /文字起こしは完了しています/);
assert.equal(interviewPromotionError.progress.steps[1]?.status, "complete");
assert.equal(interviewPromotionError.progress.steps[2]?.status, "error");

const lessonPromotionError = buildSessionProgressState({
  sessionId: "session-lesson",
  type: "LESSON_REPORT",
  parts: [
    {
      id: "part-check-in",
      partType: "CHECK_IN",
      status: "READY",
      rawTextOriginal: "今日は英単語の確認から始めた。",
      rawTextCleaned: "今日は英単語の確認から始めた。",
      qualityMetaJson: {
        lastCompletedAt: new Date("2026-03-26T08:01:00.000Z").toISOString(),
      },
    },
    {
      id: "part-check-out",
      partType: "CHECK_OUT",
      status: "ERROR",
      rawTextOriginal: "宿題のやり直し方を次回までの課題にした。",
      rawTextCleaned: "宿題のやり直し方を次回までの課題にした。",
      qualityMetaJson: {
        errorSource: "PROMOTION",
        lastCompletedAt: new Date("2026-03-26T08:02:00.000Z").toISOString(),
        lastError:
          "Invalid prisma.conversationJob.upsert() invocation: The column `leaseExpiresAt` does not exist in the current database.",
      },
    },
  ],
  conversation: null,
});

assert.equal(lessonPromotionError.stage, "ERROR");
assert.match(lessonPromotionError.progress.title, /ログ生成の準備/);
assert.equal(lessonPromotionError.progress.steps[2]?.status, "error");

const transcriptionError = buildSessionProgressState({
  sessionId: "session-transcription",
  type: "INTERVIEW",
  parts: [
    {
      id: "part-transcription",
      partType: "FULL",
      status: "ERROR",
      rawTextOriginal: null,
      rawTextCleaned: null,
      qualityMetaJson: {
        lastError: "invalid_value",
      },
    },
  ],
  conversation: null,
});

assert.equal(transcriptionError.stage, "ERROR");
assert.match(transcriptionError.progress.title, /文字起こし/);
assert.match(transcriptionError.progress.description, /音声ファイル形式/);
assert.equal(transcriptionError.progress.steps[1]?.status, "error");

const emptyTranscriptError = buildSessionProgressState({
  sessionId: "session-empty-transcription",
  type: "INTERVIEW",
  parts: [
    {
      id: "part-empty-transcription",
      partType: "FULL",
      status: "ERROR",
      rawTextOriginal: null,
      rawTextCleaned: null,
      qualityMetaJson: {
        lastError: "STT returned an empty transcript.",
      },
    },
  ],
  conversation: null,
});

assert.equal(emptyTranscriptError.stage, "ERROR");
assert.match(emptyTranscriptError.progress.title, /再取得/);
assert.match(emptyTranscriptError.progress.description, /別方式/);

const longInterviewSplitting = buildSessionProgressState({
  sessionId: "session-long-splitting",
  type: "INTERVIEW",
  parts: [
    {
      id: "part-long-splitting",
      partType: "FULL",
      status: "TRANSCRIBING",
      rawTextOriginal: null,
      rawTextCleaned: null,
      qualityMetaJson: {
        uploadMode: "file_upload",
        audioDurationSeconds: 3600,
        fileChunkSeconds: 120,
        fileChunkPlannedCount: 30,
        transcriptionPhase: "SPLITTING",
        transcriptionPhaseUpdatedAt: new Date("2026-03-31T10:00:00.000Z").toISOString(),
      },
    },
  ],
  conversation: null,
});

assert.equal(longInterviewSplitting.stage, "TRANSCRIBING");
assert.equal(longInterviewSplitting.statusLabel, "音声分割中");
assert.match(longInterviewSplitting.progress.title, /準備/);
assert.match(longInterviewSplitting.progress.description, /120秒ごと/);

const longInterviewTranscribing = buildSessionProgressState({
  sessionId: "session-long-transcribing",
  type: "INTERVIEW",
  parts: [
    {
      id: "part-long-transcribing",
      partType: "FULL",
      status: "TRANSCRIBING",
      rawTextOriginal: null,
      rawTextCleaned: null,
      qualityMetaJson: {
        uploadMode: "file_upload",
        audioDurationSeconds: 3600,
        fileChunkSeconds: 120,
        fileChunkConcurrency: 8,
        fileChunkPlannedCount: 30,
        fileChunkCompletedCount: 12,
        transcriptionPhase: "TRANSCRIBING_CHUNKS",
      },
    },
  ],
  conversation: null,
});

assert.equal(longInterviewTranscribing.stage, "TRANSCRIBING");
assert.equal(longInterviewTranscribing.statusLabel, "文字起こし中");
assert.match(longInterviewTranscribing.progress.description, /30本中12本完了/);
assert.match(longInterviewTranscribing.progress.description, /8本ずつ並列/);

const longInterviewMerging = buildSessionProgressState({
  sessionId: "session-long-merging",
  type: "INTERVIEW",
  parts: [
    {
      id: "part-long-merging",
      partType: "FULL",
      status: "TRANSCRIBING",
      rawTextOriginal: null,
      rawTextCleaned: null,
      qualityMetaJson: {
        uploadMode: "file_upload",
        audioDurationSeconds: 3600,
        fileChunkSeconds: 120,
        fileChunkPlannedCount: 30,
        fileChunkCompletedCount: 30,
        transcriptionPhase: "MERGING_TRANSCRIPT",
        transcriptionPhaseUpdatedAt: new Date("2026-03-31T10:01:00.000Z").toISOString(),
      },
    },
  ],
  conversation: null,
});

assert.equal(longInterviewMerging.stage, "TRANSCRIBING");
assert.equal(longInterviewMerging.statusLabel, "取りまとめ中");
assert.match(longInterviewMerging.progress.title, /まとめています/);

console.log("session-progress regression checks passed");
