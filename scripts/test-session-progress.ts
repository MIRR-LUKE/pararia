import assert from "node:assert/strict";
import { buildSessionProgressState } from "../lib/session-progress";

function expectProgress(
  name: string,
  input: Parameters<typeof buildSessionProgressState>[0],
  expectations: {
    stage: ReturnType<typeof buildSessionProgressState>["stage"];
    statusLabel?: string;
    waitingForPart?: "CHECK_IN" | "CHECK_OUT" | null;
    canOpenLog?: boolean;
    progressTitle?: RegExp;
    progressDescription?: RegExp;
    stepLabels?: string[];
    stepStatuses?: Array<"complete" | "active" | "pending" | "error">;
  }
) {
  const state = buildSessionProgressState(input);
  assert.equal(state.stage, expectations.stage, `${name}: stage`);
  if (expectations.statusLabel) assert.equal(state.statusLabel, expectations.statusLabel, `${name}: statusLabel`);
  if (typeof expectations.waitingForPart !== "undefined") {
    assert.equal(state.waitingForPart, expectations.waitingForPart, `${name}: waitingForPart`);
  }
  if (typeof expectations.canOpenLog !== "undefined") {
    assert.equal(state.canOpenLog, expectations.canOpenLog, `${name}: canOpenLog`);
  }
  if (expectations.progressTitle) assert.match(state.progress.title, expectations.progressTitle, `${name}: title`);
  if (expectations.progressDescription) {
    assert.match(state.progress.description, expectations.progressDescription, `${name}: description`);
  }
  if (expectations.stepLabels) {
    assert.deepEqual(
      state.progress.steps.map((step) => step.label),
      expectations.stepLabels,
      `${name}: step labels`
    );
  }
  if (expectations.stepStatuses) {
    assert.deepEqual(
      state.progress.steps.map((step) => step.status),
      expectations.stepStatuses,
      `${name}: step statuses`
    );
  }
  return state;
}

const interviewIdle = expectProgress(
  "interview idle",
  {
    sessionId: "session-interview-idle",
    type: "INTERVIEW",
    parts: [],
    conversation: null,
  },
  {
    stage: "IDLE",
    statusLabel: "未開始",
    waitingForPart: null,
    canOpenLog: false,
    progressTitle: /録音またはアップロード/,
    stepLabels: ["保存受付", "文字起こし", "ログ生成", "完了"],
    stepStatuses: ["active", "pending", "pending", "pending"],
  }
);
assert.equal(interviewIdle.progress.value > 0, true);

const interviewReceived = expectProgress(
  "interview received",
  {
    sessionId: "session-interview-received",
    type: "INTERVIEW",
    parts: [
      {
        id: "part-interview-received",
        partType: "FULL",
        status: "UPLOADED",
        rawTextOriginal: null,
        rawTextCleaned: null,
        qualityMetaJson: {},
      },
    ],
    conversation: null,
  },
  {
    stage: "RECEIVED",
    statusLabel: "保存済み",
    waitingForPart: null,
    canOpenLog: false,
    progressTitle: /保存を受け付けました/,
    stepStatuses: ["active", "pending", "pending", "pending"],
  }
);
assert.equal(interviewReceived.progress.value, 16);

const interviewTranscribing = expectProgress(
  "interview transcribing",
  {
    sessionId: "session-interview-transcribing",
    type: "INTERVIEW",
    parts: [
      {
        id: "part-interview-transcribing",
        partType: "FULL",
        status: "TRANSCRIBING",
        rawTextOriginal: null,
        rawTextCleaned: null,
        qualityMetaJson: {
          audioDurationSeconds: 600,
          transcriptionPhase: "PREPARING_STT",
          transcriptionPhaseUpdatedAt: new Date("2026-03-31T10:00:00.000Z").toISOString(),
        },
      },
    ],
    conversation: null,
  },
  {
    stage: "TRANSCRIBING",
    statusLabel: "起動中",
    waitingForPart: null,
    canOpenLog: false,
    progressTitle: /準備中/,
    progressDescription: /STT worker/,
    stepStatuses: ["complete", "active", "pending", "pending"],
  }
);
assert.equal(interviewTranscribing.progress.steps[1]?.status, "active");

const interviewGenerating = expectProgress(
  "interview generating",
  {
    sessionId: "session-interview-generating",
    type: "INTERVIEW",
    parts: [
      {
        id: "part-interview-ready",
        partType: "FULL",
        status: "READY",
        rawTextOriginal: "数学の見直しで式変形の途中を飛ばしやすい。",
        rawTextCleaned: "数学の見直しで式変形の途中を飛ばしやすい。",
        qualityMetaJson: {
          lastCompletedAt: new Date("2026-03-26T08:00:00.000Z").toISOString(),
          summaryPreview: "数学の見直しで式変形の途中を飛ばしやすい。",
        },
      },
    ],
    conversation: null,
  },
  {
    stage: "GENERATING",
    statusLabel: "ログ生成中",
    waitingForPart: null,
    canOpenLog: false,
    progressTitle: /面談の要点/,
    stepStatuses: ["complete", "complete", "active", "pending"],
  }
);
assert.equal(interviewGenerating.progress.steps[2]?.status, "active");

const interviewReady = expectProgress(
  "interview ready",
  {
    sessionId: "session-interview-ready",
    type: "INTERVIEW",
    parts: [],
    conversation: {
      id: "conversation-interview",
      status: "DONE",
      summaryMarkdown: "面談ログ",
      createdAt: new Date("2026-03-26T08:10:00.000Z").toISOString(),
      jobs: [],
    },
  },
  {
    stage: "READY",
    statusLabel: "完了",
    waitingForPart: null,
    canOpenLog: true,
    progressTitle: /面談ログが完成しました/,
    stepStatuses: ["complete", "complete", "complete", "complete"],
  }
);
assert.equal(interviewReady.progress.value, 100);

const lessonWaitingCheckOut = expectProgress(
  "lesson waiting check-out",
  {
    sessionId: "session-lesson-waiting-checkout",
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
    ],
    conversation: null,
  },
  {
    stage: "WAITING_COUNTERPART",
    statusLabel: "チェックアウト待ち",
    waitingForPart: "CHECK_OUT",
    canOpenLog: false,
    progressTitle: /チェックインを保存しました/,
    stepStatuses: ["complete", "active", "pending", "pending"],
  }
);
assert.equal(lessonWaitingCheckOut.progress.value, 52);

const lessonTranscribingCheckOut = expectProgress(
  "lesson transcribing check-out",
  {
    sessionId: "session-lesson-transcribing-checkout",
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
        status: "TRANSCRIBING",
        rawTextOriginal: null,
        rawTextCleaned: null,
        qualityMetaJson: {
          transcriptionPhase: "FINALIZING_TRANSCRIPT",
          transcriptionPhaseUpdatedAt: new Date("2026-03-26T08:02:00.000Z").toISOString(),
        },
      },
    ],
    conversation: null,
  },
  {
    stage: "TRANSCRIBING",
    statusLabel: "取りまとめ中",
    waitingForPart: null,
    canOpenLog: false,
    progressTitle: /整えています/,
    progressDescription: /保存用 transcript/,
    stepStatuses: ["complete", "active", "pending", "pending"],
  }
);
assert.equal(lessonTranscribingCheckOut.progress.steps[1]?.status, "active");

const lessonGenerating = expectProgress(
  "lesson generating",
  {
    sessionId: "session-lesson-generating",
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
        status: "READY",
        rawTextOriginal: "宿題のやり直し方を次回までの課題にした。",
        rawTextCleaned: "宿題のやり直し方を次回までの課題にした。",
        qualityMetaJson: {
          lastCompletedAt: new Date("2026-03-26T08:02:00.000Z").toISOString(),
        },
      },
    ],
    conversation: null,
  },
  {
    stage: "GENERATING",
    statusLabel: "ログ生成中",
    waitingForPart: null,
    canOpenLog: false,
    progressTitle: /統合しています/,
    stepStatuses: ["complete", "complete", "active", "pending"],
  }
);
assert.equal(lessonGenerating.progress.steps[2]?.status, "active");

const lessonReady = expectProgress(
  "lesson ready",
  {
    sessionId: "session-lesson-ready",
    type: "LESSON_REPORT",
    parts: [],
    conversation: {
      id: "conversation-lesson",
      status: "DONE",
      summaryMarkdown: "指導報告ログ",
      createdAt: new Date("2026-03-26T08:10:00.000Z").toISOString(),
      jobs: [],
    },
  },
  {
    stage: "READY",
    statusLabel: "完了",
    waitingForPart: null,
    canOpenLog: true,
    progressTitle: /指導報告ログが完成しました/,
    stepStatuses: ["complete", "complete", "complete", "complete"],
  }
);
assert.equal(lessonReady.progress.value, 100);

const interviewPromotionError = buildSessionProgressState({
  sessionId: "session-interview-error",
  type: "INTERVIEW",
  parts: [
    {
      id: "part-interview-error",
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
  sessionId: "session-lesson-error",
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
  sessionId: "session-transcription-error",
  type: "INTERVIEW",
  parts: [
    {
      id: "part-transcription-error",
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

console.log("session-progress regression checks passed");
