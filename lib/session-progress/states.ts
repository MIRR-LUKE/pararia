import {
  getSessionProgressConversationDoneCopy,
  getSessionProgressConversationErrorCopy,
  getSessionProgressGeneratingCopy,
  getSessionProgressIdleCopy,
  getSessionProgressReceivedCopy,
  getSessionProgressRejectedCopy,
  getSessionProgressStepLabels,
  getSessionProgressTranscriptionCopy,
} from "./registry";
import { readSessionPartMeta } from "@/lib/session-part-meta";
import type {
  SessionProgressInput,
  SessionProgressPartLike,
  SessionProgressState,
} from "./types";
import {
  buildDetailedTranscriptionCopy,
  estimateConversationProgress,
  estimateValue,
  extractProcessingErrorState,
  extractRejectedMessage,
} from "./math";

export function buildSteps(labels: readonly string[], currentIndex: number, errorIndex?: number): SessionProgressState["progress"]["steps"] {
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

export function buildCompletedSteps(labels: readonly string[]) {
  return labels.map((label, index) => ({
    id: `${index}-${label}`,
    label,
    status: "complete" as const,
  }));
}

export function getPart(parts: SessionProgressPartLike[], partType: string) {
  return parts.find((part) => part.partType === partType) ?? null;
}

export function isBusy(part: SessionProgressPartLike | null) {
  if (!part) return false;
  return part.status === "PENDING" || part.status === "UPLOADING" || part.status === "TRANSCRIBING";
}

export function isReady(part: SessionProgressPartLike | null) {
  return part?.status === "READY";
}

export function hasRejectedPart(parts: SessionProgressPartLike[]) {
  return parts.some((part) => {
    if (part.status !== "ERROR") return false;
    const meta = readSessionPartMeta(part.qualityMetaJson);
    return Boolean(meta.validationRejection?.messageJa);
  });
}

export function buildProgressPayload(
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

export function buildConversationDoneState(input: SessionProgressInput): SessionProgressState {
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

export function buildConversationErrorState(input: SessionProgressInput): SessionProgressState {
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

export function buildRejectedState(input: SessionProgressInput): SessionProgressState {
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

export function buildProcessingErrorState(input: SessionProgressInput): SessionProgressState {
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

export function buildInterviewState(input: SessionProgressInput): SessionProgressState | null {
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

export function buildReceivedState(input: SessionProgressInput): SessionProgressState {
  const copy = getSessionProgressReceivedCopy();
  const labels = getSessionProgressStepLabels(input.type);
  return {
    stage: "RECEIVED",
    statusLabel: copy.statusLabel,
    canLeavePage: true,
    canOpenLog: false,
    openLogId: null,
    waitingForPart: null,
    progress: buildProgressPayload(labels, 0, copy.title, copy.description),
  };
}

export function buildIdleState(input: SessionProgressInput): SessionProgressState {
  const copy = getSessionProgressIdleCopy(input.type);
  const labels = getSessionProgressStepLabels(input.type);
  return {
    stage: "IDLE",
    statusLabel: copy.statusLabel,
    canLeavePage: true,
    canOpenLog: false,
    openLogId: null,
    waitingForPart: null,
    progress: buildProgressPayload(labels, 0, copy.title, copy.description),
  };
}
