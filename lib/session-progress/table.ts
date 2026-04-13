import { readSessionPartMeta } from "@/lib/session-part-meta";
import {
  getSessionProgressConversationDoneCopy,
  getSessionProgressConversationErrorCopy,
  getSessionProgressGeneratingCopy,
  getSessionProgressIdleCopy,
  getSessionProgressReceivedCopy,
  getSessionProgressRejectedCopy,
  getSessionProgressProcessingErrorCopy,
  getSessionProgressStepLabels,
  getSessionProgressTranscriptionCopy,
  getSessionProgressTranscriptionPhaseCopy,
  getSessionProgressWaitingCopy,
} from "./registry";
import type {
  SessionProgressConversationLike,
  SessionProgressInput,
  SessionProgressPartLike,
  SessionProgressRule,
  SessionProgressState,
} from "./types";

function buildSteps(labels: readonly string[], currentIndex: number, errorIndex?: number): SessionProgressState["progress"]["steps"] {
  return labels.map((label, index) => {
    let status: "complete" | "active" | "pending" | "error" = "pending";
    if (typeof errorIndex === "number") {
      if (index < errorIndex) status = "complete";
      else if (index === errorIndex) status = "error";
    } else if (index < currentIndex) {
      status = "complete";
    } else if (index === currentIndex) {
      status = "active";
    }
    return { id: `${index}-${label}`, label, status };
  });
}

function buildCompletedSteps(labels: readonly string[]) {
  return labels.map((label, index) => ({
    id: `${index}-${label}`,
    label,
    status: "complete" as const,
  }));
}

function estimateValue(steps: SessionProgressState["progress"]["steps"]) {
  if (steps.every((step) => step.status === "complete")) return 100;
  const total = Math.max(steps.length, 1);
  const completed = steps.filter((step) => step.status === "complete").length;
  const active = steps.some((step) => step.status === "active");
  return Math.max(8, Math.min(96, Math.round(((completed + (active ? 0.55 : 0.25)) / total) * 100)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function readNonNegativeNumber(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function progressFromRatio(start: number, end: number, ratio: number) {
  return clamp(Math.round(start + (end - start) * ratio), start, end);
}

function estimateElapsedProgress(start: number, end: number, startedAt: Date | string | null | undefined, expectedMs: number) {
  const startedAtMs = toTimestamp(startedAt);
  if (!startedAtMs) return Math.round((start + end) / 2);
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const safeExpectedMs = Math.max(1_000, expectedMs);
  const ratio = clamp(elapsedMs / safeExpectedMs, 0.08, 0.94);
  return progressFromRatio(start, end, ratio);
}

function estimatePartProgress(part: SessionProgressPartLike | null, start: number, end: number) {
  if (!part) return start;
  const meta = readSessionPartMeta(part.qualityMetaJson);
  const liveChunkCount = readNonNegativeNumber(meta.liveChunkCount);
  const liveReadyChunkCount = readNonNegativeNumber(meta.liveReadyChunkCount) ?? 0;
  const liveErrorChunkCount = readNonNegativeNumber(meta.liveErrorChunkCount) ?? 0;

  if (liveChunkCount && liveChunkCount > 0) {
    const completedChunks = clamp(liveReadyChunkCount + liveErrorChunkCount, 0, liveChunkCount);
    const ratio = clamp(completedChunks / liveChunkCount, 0.08, 0.96);
    return progressFromRatio(start, end, ratio);
  }

  const audioDurationSeconds =
    readNonNegativeNumber(meta.audioDurationSeconds) ?? readNonNegativeNumber(meta.liveDurationSeconds);
  const expectedMs = audioDurationSeconds
    ? clamp(Math.round(audioDurationSeconds * 18), 12_000, 120_000)
    : 24_000;

  return estimateElapsedProgress(
    start,
    end,
    (meta.lastQueuedAt as string | undefined) ?? (meta.lastAcceptedAt as string | undefined),
    expectedMs
  );
}

function estimateConversationProgress(conversation: SessionProgressConversationLike | null | undefined, start: number, end: number) {
  const finalizeJob = conversation?.jobs?.find((job) => job.type === "FINALIZE") ?? null;
  if (!finalizeJob) {
    return clamp(start + 6, start, end);
  }
  if (finalizeJob.status === "DONE") return end;
  if (finalizeJob.status === "QUEUED") return clamp(start + 8, start, end);
  if (finalizeJob.status === "ERROR") return clamp(end - 4, start, end);
  return estimateElapsedProgress(start, end, finalizeJob.startedAt ?? conversation?.createdAt, 16_000);
}

type DetailedTranscriptionCopy = {
  statusLabel: string;
  title: string;
  description: string;
  value: number;
};

function buildDetailedTranscriptionCopy(
  part: SessionProgressPartLike | null,
  start: number,
  end: number,
  options: {
    unitLabel: string;
    acceptedTitle: string;
    acceptedDescription: string;
  }
): DetailedTranscriptionCopy {
  if (!part) {
    return {
      statusLabel: "文字起こし中",
      title: options.acceptedTitle,
      description: options.acceptedDescription,
      value: start,
    };
  }

  const meta = readSessionPartMeta(part.qualityMetaJson);
  const phase = typeof meta.transcriptionPhase === "string" ? meta.transcriptionPhase : null;
  const phaseUpdatedAt =
    (typeof meta.transcriptionPhaseUpdatedAt === "string" ? meta.transcriptionPhaseUpdatedAt : null) ??
    (typeof meta.lastQueuedAt === "string" ? meta.lastQueuedAt : null);

  if (phase === "PREPARING_STT") {
    const phaseCopy = getSessionProgressTranscriptionPhaseCopy("PREPARING_STT");
    return {
      statusLabel: phaseCopy.statusLabel,
      title: phaseCopy.title,
      description: phaseCopy.description,
      value: estimateElapsedProgress(start, Math.max(start + 8, end - 12), phaseUpdatedAt, 45_000),
    };
  }

  if (phase === "FINALIZING_TRANSCRIPT") {
    const phaseCopy = getSessionProgressTranscriptionPhaseCopy("FINALIZING_TRANSCRIPT");
    return {
      statusLabel: phaseCopy.statusLabel,
      title: phaseCopy.title,
      description: phaseCopy.description,
      value: estimateElapsedProgress(Math.max(start + 10, start), end, phaseUpdatedAt, 9_000),
    };
  }

  return {
    statusLabel: "文字起こし中",
    title: `${options.unitLabel}を文字起こし中です`,
    description: "STT worker で音声を文字起こししています。音声が長いほど時間はかかりますが、このまま閉じても大丈夫です。",
    value: estimatePartProgress(part, start, end),
  };
}

function extractRejectedMessage(parts: SessionProgressPartLike[]) {
  for (const part of parts) {
    const meta = readSessionPartMeta(part.qualityMetaJson);
    const rejectionMessage = meta.validationRejection?.messageJa?.trim();
    if (rejectionMessage) return rejectionMessage;
  }
  return null;
}

type SessionProcessingErrorState = {
  title: string;
  description: string;
  stepIndex: number;
};

function partHasTranscript(part: SessionProgressPartLike, meta: ReturnType<typeof readSessionPartMeta>) {
  return Boolean(meta.summaryPreview || meta.lastCompletedAt || part.status === "READY");
}

function extractProcessingErrorState(parts: SessionProgressPartLike[]): SessionProcessingErrorState | null {
  for (const part of parts) {
    const meta = readSessionPartMeta(part.qualityMetaJson);
    const rejectionMessage = meta.validationRejection?.messageJa?.trim();
    if (rejectionMessage) {
      return {
        title: "文字起こしで問題が発生しました",
        description: rejectionMessage,
        stepIndex: 1,
      };
    }
    const lastError = typeof meta.lastError === "string" ? meta.lastError.trim() : "";
    if (!lastError) continue;
    const isPostTranscriptionFailure = meta.errorSource === "PROMOTION" || partHasTranscript(part, meta);
    const detail = getSessionProgressProcessingErrorCopy(lastError, isPostTranscriptionFailure);
    return {
      title: detail.title,
      description: detail.description,
      stepIndex: detail.stepIndex,
    };
  }
  return null;
}

function getPart(parts: SessionProgressPartLike[], partType: string) {
  return parts.find((part) => part.partType === partType) ?? null;
}

function isBusy(part: SessionProgressPartLike | null) {
  if (!part) return false;
  return part.status === "PENDING" || part.status === "UPLOADING" || part.status === "TRANSCRIBING";
}

function isReady(part: SessionProgressPartLike | null) {
  return part?.status === "READY";
}

function hasRejectedPart(parts: SessionProgressPartLike[]) {
  return parts.some((part) => {
    if (part.status !== "ERROR") return false;
    const meta = readSessionPartMeta(part.qualityMetaJson);
    return Boolean(meta.validationRejection?.messageJa);
  });
}

function buildProgressPayload(
  labels: readonly string[],
  currentIndex: number,
  title: string,
  description: string,
  errorIndex?: number,
  valueOverride?: number
) {
  const steps = typeof errorIndex === "number" ? buildSteps(labels, errorIndex, errorIndex) : buildSteps(labels, currentIndex);
  return {
    title,
    description,
    value: typeof valueOverride === "number" ? valueOverride : estimateValue(steps),
    steps,
  };
}

function buildConversationDoneState(input: SessionProgressInput): SessionProgressState {
  const copy = getSessionProgressConversationDoneCopy(input.type);
  const labels = getSessionProgressStepLabels(input.type);
  return {
    stage: "READY",
    statusLabel: copy.statusLabel,
    canLeavePage: true,
    canOpenLog: true,
    openLogId: input.conversation?.id ?? null,
    waitingForPart: null,
    progress: {
      title: copy.title,
      description: copy.description,
      value: 100,
      steps: buildCompletedSteps(labels),
    },
  };
}

function buildConversationErrorState(input: SessionProgressInput): SessionProgressState {
  const copy = getSessionProgressConversationErrorCopy();
  const labels = getSessionProgressStepLabels(input.type);
  return {
    stage: "ERROR",
    statusLabel: copy.statusLabel,
    canLeavePage: true,
    canOpenLog: Boolean(input.conversation?.id),
    openLogId: input.conversation?.id ?? null,
    waitingForPart: null,
    progress: buildProgressPayload(labels, 2, copy.title, copy.description, 2, 88),
  };
}

function buildRejectedState(input: SessionProgressInput): SessionProgressState {
  const copy = getSessionProgressRejectedCopy();
  const labels = getSessionProgressStepLabels(input.type);
  const rejectionMessage = extractRejectedMessage(input.parts) ?? "録音し直すか、内容を補足して再保存してください。";
  return {
    stage: "REJECTED",
    statusLabel: copy.statusLabel,
    canLeavePage: true,
    canOpenLog: false,
    openLogId: null,
    waitingForPart: null,
    progress: buildProgressPayload(labels, copy.stepIndex, copy.title, rejectionMessage, copy.stepIndex, copy.value),
  };
}

function buildProcessingErrorState(input: SessionProgressInput): SessionProgressState {
  const labels = getSessionProgressStepLabels(input.type);
  const errorState = extractProcessingErrorState(input.parts) ?? {
    title: "文字起こしで問題が発生しました",
    description: "しばらく待ってから再試行してください。",
    stepIndex: 1,
  };
  return {
    stage: "ERROR",
    statusLabel: "処理エラー",
    canLeavePage: true,
    canOpenLog: Boolean(input.conversation?.id),
    openLogId: input.conversation?.id ?? null,
    waitingForPart: null,
    progress: buildProgressPayload(
      labels,
      errorState.stepIndex,
      errorState.title,
      errorState.description,
      errorState.stepIndex,
      errorState.stepIndex >= 2 ? 82 : 44
    ),
  };
}

function buildLessonReportState(input: SessionProgressInput): SessionProgressState | null {
  const labels = getSessionProgressStepLabels(input.type);
  const checkIn = getPart(input.parts, "CHECK_IN");
  const checkOut = getPart(input.parts, "CHECK_OUT");
  const hasReadyCheckIn = isReady(checkIn);
  const hasReadyCheckOut = isReady(checkOut);

  if (hasReadyCheckIn && hasReadyCheckOut) {
    const copy = getSessionProgressGeneratingCopy(input.type);
    return {
      stage: "GENERATING",
      statusLabel: copy.statusLabel,
      canLeavePage: true,
      canOpenLog: Boolean(input.conversation?.id),
      openLogId: input.conversation?.id ?? null,
      waitingForPart: null,
      progress: buildProgressPayload(
        labels,
        2,
        copy.title,
        copy.description,
        undefined,
        estimateConversationProgress(input.conversation, 78, 96)
      ),
    };
  }

  if (hasReadyCheckIn && !checkOut) {
    const copy = getSessionProgressWaitingCopy("CHECK_OUT");
    return {
      stage: "WAITING_COUNTERPART",
      statusLabel: copy.statusLabel,
      canLeavePage: true,
      canOpenLog: false,
      openLogId: null,
      waitingForPart: "CHECK_OUT",
      progress: buildProgressPayload(labels, 1, copy.title, copy.description, undefined, copy.value),
    };
  }

  if (hasReadyCheckIn && isBusy(checkOut)) {
    const copy = getSessionProgressTranscriptionCopy(input.type, "CHECK_OUT");
    const detail = buildDetailedTranscriptionCopy(checkOut, copy.start, copy.end, copy);
    return {
      stage: "TRANSCRIBING",
      statusLabel: detail.statusLabel,
      canLeavePage: true,
      canOpenLog: false,
      openLogId: null,
      waitingForPart: null,
      progress: buildProgressPayload(labels, 1, detail.title, detail.description, undefined, detail.value),
    };
  }

  if (hasReadyCheckOut && !checkIn) {
    const copy = getSessionProgressWaitingCopy("CHECK_IN");
    return {
      stage: "WAITING_COUNTERPART",
      statusLabel: copy.statusLabel,
      canLeavePage: true,
      canOpenLog: false,
      openLogId: null,
      waitingForPart: "CHECK_IN",
      progress: buildProgressPayload(labels, 0, copy.title, copy.description, undefined, copy.value),
    };
  }

  if (hasReadyCheckOut && isBusy(checkIn)) {
    const copy = getSessionProgressTranscriptionCopy(input.type, "CHECK_IN");
    const detail = buildDetailedTranscriptionCopy(checkIn, copy.start, copy.end, copy);
    return {
      stage: "TRANSCRIBING",
      statusLabel: detail.statusLabel,
      canLeavePage: true,
      canOpenLog: false,
      openLogId: null,
      waitingForPart: null,
      progress: buildProgressPayload(labels, 0, detail.title, detail.description, undefined, detail.value),
    };
  }

  if (isBusy(checkIn)) {
    const copy = getSessionProgressTranscriptionCopy(input.type, "CHECK_IN");
    const detail = buildDetailedTranscriptionCopy(checkIn, copy.start, copy.end, copy);
    return {
      stage: "TRANSCRIBING",
      statusLabel: detail.statusLabel,
      canLeavePage: true,
      canOpenLog: false,
      openLogId: null,
      waitingForPart: null,
      progress: buildProgressPayload(labels, 0, detail.title, detail.description, undefined, detail.value),
    };
  }

  if (isBusy(checkOut)) {
    const copy = getSessionProgressTranscriptionCopy(input.type, "CHECK_OUT");
    const detail = buildDetailedTranscriptionCopy(checkOut, copy.start, copy.end, copy);
    return {
      stage: "TRANSCRIBING",
      statusLabel: detail.statusLabel,
      canLeavePage: true,
      canOpenLog: false,
      openLogId: null,
      waitingForPart: null,
      progress: buildProgressPayload(labels, 1, detail.title, detail.description, undefined, detail.value),
    };
  }

  return null;
}

function buildInterviewState(input: SessionProgressInput): SessionProgressState | null {
  const labels = getSessionProgressStepLabels(input.type);
  const full = getPart(input.parts, "FULL");
  if (isReady(full)) {
    const copy = getSessionProgressGeneratingCopy(input.type);
    return {
      stage: "GENERATING",
      statusLabel: copy.statusLabel,
      canLeavePage: true,
      canOpenLog: Boolean(input.conversation?.id),
      openLogId: input.conversation?.id ?? null,
      waitingForPart: null,
      progress: buildProgressPayload(
        labels,
        2,
        copy.title,
        copy.description,
        undefined,
        estimateConversationProgress(input.conversation, 76, 96)
      ),
    };
  }

  if (isBusy(full)) {
    const copy = getSessionProgressTranscriptionCopy(input.type, "FULL");
    const detail = buildDetailedTranscriptionCopy(full, copy.start, copy.end, copy);
    return {
      stage: "TRANSCRIBING",
      statusLabel: detail.statusLabel,
      canLeavePage: true,
      canOpenLog: false,
      openLogId: null,
      waitingForPart: null,
      progress: buildProgressPayload(labels, 1, detail.title, detail.description, undefined, detail.value),
    };
  }

  return null;
}

function buildReceivedState(input: SessionProgressInput): SessionProgressState {
  const copy = getSessionProgressReceivedCopy();
  const labels = getSessionProgressStepLabels(input.type);
  return {
    stage: "RECEIVED",
    statusLabel: copy.statusLabel,
    canLeavePage: true,
    canOpenLog: false,
    openLogId: null,
    waitingForPart: input.type === "LESSON_REPORT" ? "CHECK_IN" : null,
    progress: buildProgressPayload(labels, 0, copy.title, copy.description, undefined, 16),
  };
}

function buildIdleState(input: SessionProgressInput): SessionProgressState {
  const copy = getSessionProgressIdleCopy(input.type);
  const labels = getSessionProgressStepLabels(input.type);
  return {
    stage: "IDLE",
    statusLabel: copy.statusLabel,
    canLeavePage: true,
    canOpenLog: false,
    openLogId: null,
    waitingForPart: input.type === "LESSON_REPORT" ? "CHECK_IN" : null,
    progress: buildProgressPayload(labels, 0, copy.title, copy.description),
  };
}

const SESSION_PROGRESS_TRANSITION_TABLE: SessionProgressRule[] = [
  {
    id: "conversation-done",
    match: (input) => input.conversation?.status === "DONE",
    build: buildConversationDoneState,
  },
  {
    id: "conversation-error",
    match: (input) => input.conversation?.status === "ERROR",
    build: buildConversationErrorState,
  },
  {
    id: "rejected-part",
    match: (input) => hasRejectedPart(input.parts),
    build: buildRejectedState,
  },
  {
    id: "processing-error",
    match: (input) => input.parts.some((part) => part.status === "ERROR"),
    build: buildProcessingErrorState,
  },
  {
    id: "lesson-report-state",
    match: (input) =>
      input.type === "LESSON_REPORT" && input.parts.some((part) => isBusy(part) || isReady(part)),
    build: (input) => buildLessonReportState(input) ?? buildReceivedState(input),
  },
  {
    id: "interview-state",
    match: (input) =>
      input.type === "INTERVIEW" && input.parts.some((part) => isBusy(part) || isReady(part)),
    build: (input) => buildInterviewState(input) ?? buildReceivedState(input),
  },
  {
    id: "received",
    match: (input) => input.parts.length > 0,
    build: buildReceivedState,
  },
  {
    id: "idle",
    match: () => true,
    build: buildIdleState,
  },
];

export function resolveSessionProgressState(input: SessionProgressInput): SessionProgressState {
  const matchedRule = SESSION_PROGRESS_TRANSITION_TABLE.find((rule) => rule.match(input));
  return (matchedRule ?? SESSION_PROGRESS_TRANSITION_TABLE[SESSION_PROGRESS_TRANSITION_TABLE.length - 1]).build(input);
}
