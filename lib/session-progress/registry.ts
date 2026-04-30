import type {
  SessionProgressErrorCopy,
  SessionProgressMode,
  SessionProgressPartType,
  SessionProgressPhaseCopy,
  SessionProgressTranscriptionCopy,
  SessionProgressWaitingCopy,
} from "./types";

const SESSION_PROGRESS_STEP_LABELS: readonly [string, string, string, string] = [
  "保存受付",
  "文字起こし",
  "ログ生成",
  "完了",
];

const SESSION_PROGRESS_READY_COPY: SessionProgressPhaseCopy = {
  statusLabel: "完了",
  title: "面談ログが完成しました",
  description: "このまま閉じても大丈夫です。結果を確認できます。",
};

const SESSION_PROGRESS_GENERATING_COPY: SessionProgressPhaseCopy = {
  statusLabel: "ログ生成中",
  title: "面談の要点を整理しています",
  description: "gpt-5.5 で文字起こしを要約し、面談ログ本文を生成しています。",
};

const SESSION_PROGRESS_RECEIVED_COPY: SessionProgressPhaseCopy = {
  statusLabel: "保存済み",
  title: "保存を受け付けました",
  description: "処理を順番に開始します。",
};

const SESSION_PROGRESS_IDLE_COPY: SessionProgressPhaseCopy = {
  statusLabel: "未開始",
  title: "録音またはアップロードで開始します",
  description: "保存後に文字起こしと面談ログ生成が自動で進みます。",
};

const SESSION_PROGRESS_CONVERSATION_ERROR_COPY: SessionProgressPhaseCopy = {
  statusLabel: "生成エラー",
  title: "ログ生成で問題が発生しました",
  description: "再試行すると復旧できる場合があります。",
};

const SESSION_PROGRESS_REJECTED_COPY: SessionProgressErrorCopy = {
  statusLabel: "内容不足",
  title: "会話量が足りず停止しました",
  description: "録音し直すか、内容を補足して再保存してください。",
  stepIndex: 1,
  value: 42,
};

const SESSION_PROGRESS_GENERIC_ERROR_COPY: SessionProgressPhaseCopy = {
  statusLabel: "処理エラー",
  title: "文字起こしで問題が発生しました",
  description: "しばらく待ってから再試行してください。",
};

const SESSION_PROGRESS_TRANSCRIPTION_PHASE_COPY: Record<
  "PREPARING_STT" | "FINALIZING_TRANSCRIPT",
  SessionProgressPhaseCopy
> = {
  PREPARING_STT: {
    statusLabel: "起動中",
    title: "文字起こし準備中です",
    description: "STT worker を起動して音声の取得と初期化を進めています。起動が終わるとすぐ文字起こしに入ります。",
  },
  FINALIZING_TRANSCRIPT: {
    statusLabel: "取りまとめ中",
    title: "文字起こし結果を整えています",
    description: "STT worker で起こした文字を保存用 transcript にまとめています。完了するとすぐログ生成に進みます。",
  },
};

const SESSION_PROGRESS_TRANSCRIBING_COPY: SessionProgressTranscriptionCopy = {
  statusLabel: "文字起こし中",
  title: "面談音声を文字起こし中です",
  description: "STT worker で音声を文字起こししています。音声が長いほど時間はかかりますが、このまま閉じても大丈夫です。",
  unitLabel: "面談音声",
  start: 24,
  end: 68,
  acceptedTitle: "音声を受け付けました",
  acceptedDescription: "文字起こしを進めています。このまま閉じても大丈夫です。",
};

const SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY = {
  promotion: {
    statusLabel: "生成エラー",
    title: "ログ生成の準備で問題が発生しました",
    description: "文字起こしは完了しています。生成を再開すると復旧できる場合があります。",
    stepIndex: 2 as const,
    value: 82,
  },
  schema: {
    statusLabel: "生成エラー",
    title: "ログ生成の準備で問題が発生しました",
    description: "文字起こしは完了しています。システム更新の反映後に生成を再開してください。",
    stepIndex: 2 as const,
    value: 82,
  },
  transcription: {
    statusLabel: "処理エラー",
    title: "文字起こしの再取得が必要です",
    description: "音声は受け取れましたが、文字起こし結果を取得できませんでした。再開すると STT worker 側の処理をやり直します。",
    stepIndex: 1 as const,
    value: 44,
  },
  quota: {
    statusLabel: "処理エラー",
    title: "文字起こしで問題が発生しました",
    description: "音声処理のAPIクォータ上限に達したため停止しました。課金枠を確認して再試行してください。",
    stepIndex: 1 as const,
    value: 44,
  },
  invalidAudio: {
    statusLabel: "処理エラー",
    title: "文字起こしで問題が発生しました",
    description: "音声ファイル形式を処理できず停止しました。MP3 / M4A を再書き出しするか、そのまま再試行してください。",
    stepIndex: 1 as const,
    value: 44,
  },
  recordingLock: {
    statusLabel: "処理エラー",
    title: "保存処理で問題が発生しました",
    description: "録音ロックを確認できず停止しました。画面を更新してからやり直してください。",
    stepIndex: 0 as const,
    value: 44,
  },
  generic: {
    statusLabel: "処理エラー",
    title: "文字起こしで問題が発生しました",
    description: "音声処理で問題が発生しました。少し待ってから再試行してください。",
    stepIndex: 1 as const,
    value: 44,
  },
} as const;

export function getSessionProgressStepLabels(mode: SessionProgressMode) {
  return SESSION_PROGRESS_STEP_LABELS;
}

export function getSessionProgressReadyCopy(mode: SessionProgressMode) {
  return SESSION_PROGRESS_READY_COPY;
}

export function getSessionProgressGeneratingCopy(mode: SessionProgressMode) {
  return SESSION_PROGRESS_GENERATING_COPY;
}

export function getSessionProgressReceivedCopy() {
  return SESSION_PROGRESS_RECEIVED_COPY;
}

export function getSessionProgressIdleCopy(mode: SessionProgressMode) {
  return SESSION_PROGRESS_IDLE_COPY;
}

export function getSessionProgressConversationDoneCopy(mode: SessionProgressMode) {
  return SESSION_PROGRESS_READY_COPY;
}

export function getSessionProgressConversationErrorCopy() {
  return SESSION_PROGRESS_CONVERSATION_ERROR_COPY;
}

export function getSessionProgressRejectedCopy() {
  return SESSION_PROGRESS_REJECTED_COPY;
}

export function getSessionProgressGenericErrorCopy() {
  return SESSION_PROGRESS_GENERIC_ERROR_COPY;
}

export function getSessionProgressTranscriptionPhaseCopy(phase: "PREPARING_STT" | "FINALIZING_TRANSCRIPT") {
  return SESSION_PROGRESS_TRANSCRIPTION_PHASE_COPY[phase];
}

export function getSessionProgressTranscriptionCopy(mode: SessionProgressMode, partType: SessionProgressPartType) {
  return SESSION_PROGRESS_TRANSCRIBING_COPY;
}

export function getSessionProgressWaitingCopy(partType: SessionProgressPartType) {
  const waitingForPart = partType === "TEXT_NOTE" ? "TEXT_NOTE" : "FULL";
  return {
    statusLabel: waitingForPart === "FULL" ? "本文待ち" : "メモ待ち",
    title: waitingForPart === "FULL" ? "面談本文を保存しました" : "補足メモを保存しました",
    description:
      waitingForPart === "FULL"
        ? "補足メモを追加すると、ログ生成に進みます。"
        : "本文を追加すると、ログ生成に進みます。",
    waitingForPart,
    value: waitingForPart === "FULL" ? 34 : 52,
  };
}

export function getSessionProgressConversationErrorDetailCopy(message: string) {
  if (/recording_lock/i.test(message)) return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.recordingLock;
  if (/insufficient_quota/i.test(message)) return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.quota;
  if (/Audio file might be corrupted or unsupported|invalid_value/i.test(message)) {
    return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.invalidAudio;
  }
  if (/empty transcript/i.test(message)) return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.transcription;
  if (/(Invalid prisma\.|Unknown arg|column .* does not exist|migration|schema)/i.test(message)) {
    return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.schema;
  }
  return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.promotion;
}

export function getSessionProgressProcessingErrorCopy(message: string, hasTranscript: boolean): SessionProgressErrorCopy {
  if (/insufficient_quota/i.test(message)) return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.quota;
  if (/Audio file might be corrupted or unsupported|invalid_value/i.test(message)) {
    return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.invalidAudio;
  }
  if (/empty transcript/i.test(message)) return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.transcription;
  if (/recording_lock/i.test(message)) return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.recordingLock;
  if (/(Invalid prisma\.|Unknown arg|column .* does not exist|migration|schema)/i.test(message)) {
    return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.schema;
  }
  if (hasTranscript) return SESSION_PROGRESS_CONVERSATION_ERROR_DETAIL_COPY.promotion;
  return {
    statusLabel: SESSION_PROGRESS_GENERIC_ERROR_COPY.statusLabel,
    title: SESSION_PROGRESS_GENERIC_ERROR_COPY.title,
    description: SESSION_PROGRESS_GENERIC_ERROR_COPY.description,
    stepIndex: 1,
    value: 44,
  };
}
