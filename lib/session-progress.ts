import type { GenerationProgressState, GenerationStep, GenerationStepStatus } from "@/lib/generation-progress";
import { readSessionPartMeta } from "@/lib/session-part-meta";

export type SessionProgressStage =
  | "IDLE"
  | "RECEIVED"
  | "TRANSCRIBING"
  | "WAITING_COUNTERPART"
  | "GENERATING"
  | "READY"
  | "REJECTED"
  | "ERROR";

type SessionProgressPartLike = {
  id: string;
  partType: string;
  status: string;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  qualityMetaJson?: unknown;
};

type SessionProgressConversationJobLike = {
  type?: string | null;
  status?: string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
};

type SessionProgressConversationLike = {
  id: string;
  status: string;
  summaryMarkdown?: string | null;
  createdAt?: Date | string | null;
  jobs?: SessionProgressConversationJobLike[];
};

type SessionProgressInput = {
  sessionId: string;
  type: "INTERVIEW" | "LESSON_REPORT";
  parts: SessionProgressPartLike[];
  conversation?: SessionProgressConversationLike | null;
};

export type SessionProgressState = {
  stage: SessionProgressStage;
  statusLabel: string;
  canLeavePage: boolean;
  canOpenLog: boolean;
  openLogId: string | null;
  waitingForPart: "CHECK_IN" | "CHECK_OUT" | null;
  progress: GenerationProgressState;
};

const INTERVIEW_STEP_LABELS = ["保存受付", "文字起こし", "ログ生成", "完了"];
const LESSON_STEP_LABELS = ["チェックイン", "チェックアウト", "ログ生成", "完了"];

function buildSteps(labels: string[], currentIndex: number, errorIndex?: number): GenerationStep[] {
  return labels.map((label, index) => {
    let status: GenerationStepStatus = "pending";
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

function buildCompletedSteps(labels: string[]): GenerationStep[] {
  return labels.map((label, index) => ({
    id: `${index}-${label}`,
    label,
    status: "complete" as const,
  }));
}

function estimateValue(steps: GenerationStep[]) {
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

  return estimateElapsedProgress(start, end, (meta.lastQueuedAt as string | undefined) ?? (meta.lastAcceptedAt as string | undefined), expectedMs);
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
    return {
      statusLabel: "起動中",
      title: "文字起こし準備中です",
      description: "STT worker を起動して音声の取得と初期化を進めています。起動が終わるとすぐ文字起こしに入ります。",
      value: estimateElapsedProgress(start, Math.max(start + 8, end - 12), phaseUpdatedAt, 45_000),
    };
  }

  if (phase === "FINALIZING_TRANSCRIPT") {
    return {
      statusLabel: "取りまとめ中",
      title: "文字起こし結果を整えています",
      description: "STT worker で起こした文字を保存用 transcript にまとめています。完了するとすぐログ生成に進みます。",
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
  return Boolean(part.rawTextCleaned?.trim() || part.rawTextOriginal?.trim() || meta.summaryPreview || meta.lastCompletedAt);
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
    if (/insufficient_quota/i.test(lastError)) {
      return {
        title: "文字起こしで問題が発生しました",
        description: "音声処理のAPIクォータ上限に達したため停止しました。課金枠を確認して再試行してください。",
        stepIndex: 1,
      };
    }
    if (/Audio file might be corrupted or unsupported|invalid_value/i.test(lastError)) {
      return {
        title: "文字起こしで問題が発生しました",
        description: "音声ファイル形式を処理できず停止しました。MP3 / M4A を再書き出しするか、そのまま再試行してください。",
        stepIndex: 1,
      };
    }
    if (/empty transcript/i.test(lastError)) {
      return {
        title: "文字起こしの再取得が必要です",
        description: "音声は受け取れましたが、文字起こし結果を取得できませんでした。再開すると STT worker 側の処理をやり直します。",
        stepIndex: 1,
      };
    }
    if (/recording_lock/i.test(lastError)) {
      return {
        title: "保存処理で問題が発生しました",
        description: "録音ロックを確認できず停止しました。画面を更新してからやり直してください。",
        stepIndex: 0,
      };
    }

    const isPostTranscriptionFailure = meta.errorSource === "PROMOTION" || partHasTranscript(part, meta);
    if (isPostTranscriptionFailure) {
      if (/(Invalid prisma\.|Unknown arg|column .* does not exist|migration|schema)/i.test(lastError)) {
        return {
          title: "ログ生成の準備で問題が発生しました",
          description: "文字起こしは完了しています。システム更新の反映後に生成を再開してください。",
          stepIndex: 2,
        };
      }
      return {
        title: "ログ生成の準備で問題が発生しました",
        description: "文字起こしは完了しています。生成を再開すると復旧できる場合があります。",
        stepIndex: 2,
      };
    }

    return {
      title: "文字起こしで問題が発生しました",
      description: "音声処理で問題が発生しました。少し待ってから再試行してください。",
      stepIndex: 1,
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
  labels: string[],
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

export function buildSessionProgressState(input: SessionProgressInput): SessionProgressState {
  const labels = input.type === "LESSON_REPORT" ? LESSON_STEP_LABELS : INTERVIEW_STEP_LABELS;
  const conversation = input.conversation;

  if (conversation?.status === "DONE") {
    return {
      stage: "READY",
      statusLabel: "完了",
      canLeavePage: true,
      canOpenLog: true,
      openLogId: conversation.id,
      waitingForPart: null,
      progress: {
        title: input.type === "LESSON_REPORT" ? "指導報告ログが完成しました" : "面談ログが完成しました",
        description: "このまま閉じても大丈夫です。結果を確認できます。",
        value: 100,
        steps: buildCompletedSteps(labels),
      },
    };
  }

  if (conversation?.status === "ERROR") {
    return {
      stage: "ERROR",
      statusLabel: "生成エラー",
      canLeavePage: true,
      canOpenLog: Boolean(conversation.id),
      openLogId: conversation?.id ?? null,
      waitingForPart: null,
      progress: buildProgressPayload(
        labels,
        2,
        "ログ生成で問題が発生しました",
        "再試行すると復旧できる場合があります。",
        2,
        88
      ),
    };
  }

  if (hasRejectedPart(input.parts)) {
    const rejectionMessage = extractRejectedMessage(input.parts) ?? "録音し直すか、内容を補足して再保存してください。";
    return {
      stage: "REJECTED",
      statusLabel: "内容不足",
      canLeavePage: true,
      canOpenLog: false,
      openLogId: null,
      waitingForPart: null,
      progress: buildProgressPayload(labels, 1, "会話量が足りず停止しました", rejectionMessage, 1, 42),
    };
  }

  if (input.parts.some((part) => part.status === "ERROR")) {
    const errorState = extractProcessingErrorState(input.parts) ?? {
      title: "文字起こしで問題が発生しました",
      description: "しばらく待ってから再試行してください。",
      stepIndex: 1,
    };
    return {
      stage: "ERROR",
      statusLabel: "処理エラー",
      canLeavePage: true,
      canOpenLog: Boolean(conversation?.id),
      openLogId: conversation?.id ?? null,
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

  if (input.type === "LESSON_REPORT") {
    const checkIn = getPart(input.parts, "CHECK_IN");
    const checkOut = getPart(input.parts, "CHECK_OUT");
    const hasReadyCheckIn = isReady(checkIn);
    const hasReadyCheckOut = isReady(checkOut);

    if (hasReadyCheckIn && hasReadyCheckOut) {
      return {
        stage: "GENERATING",
        statusLabel: "ログ生成中",
        canLeavePage: true,
        canOpenLog: Boolean(conversation?.id),
        openLogId: conversation?.id ?? null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          2,
          "チェックインとチェックアウトを統合しています",
          "gpt-5.4 で文字起こしを要約し、指導報告ログ本文を生成しています。",
          undefined,
          estimateConversationProgress(conversation, 78, 96)
        ),
      };
    }

    if (hasReadyCheckIn && !checkOut) {
      return {
        stage: "WAITING_COUNTERPART",
        statusLabel: "チェックアウト待ち",
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: "CHECK_OUT",
        progress: buildProgressPayload(
          labels,
          1,
          "チェックインを保存しました",
          "次はチェックアウトを録音またはアップロードしてください。",
          undefined,
          52
        ),
      };
    }

    if (hasReadyCheckIn && isBusy(checkOut)) {
      const detail = buildDetailedTranscriptionCopy(checkOut, 56, 76, {
        unitLabel: "チェックアウト音声",
        acceptedTitle: "チェックアウトを文字起こし中です",
        acceptedDescription: "保存受付は完了しています。このまま閉じても大丈夫です。",
      });
      return {
        stage: "TRANSCRIBING",
        statusLabel: detail.statusLabel,
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          1,
          detail.title,
          detail.description,
          undefined,
          detail.value
        ),
      };
    }

    if (hasReadyCheckOut && !checkIn) {
      return {
        stage: "WAITING_COUNTERPART",
        statusLabel: "チェックイン待ち",
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: "CHECK_IN",
        progress: buildProgressPayload(
          labels,
          0,
          "チェックアウトを保存しました",
          "チェックインを追加すると、指導報告ログの生成に進みます。",
          undefined,
          34
        ),
      };
    }

    if (hasReadyCheckOut && isBusy(checkIn)) {
      const detail = buildDetailedTranscriptionCopy(checkIn, 18, 42, {
        unitLabel: "チェックイン音声",
        acceptedTitle: "チェックインを文字起こし中です",
        acceptedDescription: "保存受付は完了しています。このまま閉じても大丈夫です。",
      });
      return {
        stage: "TRANSCRIBING",
        statusLabel: detail.statusLabel,
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          0,
          detail.title,
          detail.description,
          undefined,
          detail.value
        ),
      };
    }

    if (isBusy(checkIn)) {
      const detail = buildDetailedTranscriptionCopy(checkIn, 16, 36, {
        unitLabel: "チェックイン音声",
        acceptedTitle: "チェックインを受け付けました",
        acceptedDescription: "まずは文字起こしを進めています。このまま閉じても大丈夫です。",
      });
      return {
        stage: "TRANSCRIBING",
        statusLabel: detail.statusLabel,
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          0,
          detail.title,
          detail.description,
          undefined,
          detail.value
        ),
      };
    }

    if (isBusy(checkOut)) {
      const detail = buildDetailedTranscriptionCopy(checkOut, 50, 72, {
        unitLabel: "チェックアウト音声",
        acceptedTitle: "チェックアウトを受け付けました",
        acceptedDescription: "文字起こしが終わりしだい、指導報告ログに進みます。",
      });
      return {
        stage: "TRANSCRIBING",
        statusLabel: detail.statusLabel,
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          1,
          detail.title,
          detail.description,
          undefined,
          detail.value
        ),
      };
    }
  } else {
    const full = getPart(input.parts, "FULL");
    if (isReady(full)) {
      return {
        stage: "GENERATING",
        statusLabel: "ログ生成中",
        canLeavePage: true,
        canOpenLog: Boolean(conversation?.id),
        openLogId: conversation?.id ?? null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          2,
          "面談の要点を整理しています",
          "gpt-5.4 で文字起こしを要約し、面談ログ本文を生成しています。",
          undefined,
          estimateConversationProgress(conversation, 76, 96)
        ),
      };
    }

    if (isBusy(full)) {
      const detail = buildDetailedTranscriptionCopy(full, 24, 68, {
        unitLabel: "面談音声",
        acceptedTitle: "音声を受け付けました",
        acceptedDescription: "文字起こしを進めています。このまま閉じても大丈夫です。",
      });
      return {
        stage: "TRANSCRIBING",
        statusLabel: detail.statusLabel,
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          1,
          detail.title,
          detail.description,
          undefined,
          detail.value
        ),
      };
    }
  }

  if (input.parts.length > 0) {
    return {
      stage: "RECEIVED",
      statusLabel: "保存済み",
      canLeavePage: true,
      canOpenLog: false,
      openLogId: null,
      waitingForPart: input.type === "LESSON_REPORT" ? "CHECK_IN" : null,
      progress: buildProgressPayload(labels, 0, "保存を受け付けました", "処理を順番に開始します。", undefined, 16),
    };
  }

  return {
    stage: "IDLE",
    statusLabel: "未開始",
    canLeavePage: true,
    canOpenLog: false,
    openLogId: null,
    waitingForPart: input.type === "LESSON_REPORT" ? "CHECK_IN" : null,
    progress: buildProgressPayload(labels, 0, input.type === "LESSON_REPORT" ? "チェックインから開始します" : "録音またはアップロードで開始します", input.type === "LESSON_REPORT" ? "チェックイン保存後、チェックアウトを追加すると自動で指導報告ログを生成します。" : "保存後に文字起こしと面談ログ生成が自動で進みます。"),
  };
}
