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

type SessionProgressConversationLike = {
  id: string;
  status: string;
  summaryMarkdown?: string | null;
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
  errorIndex?: number
) {
  const steps = typeof errorIndex === "number" ? buildSteps(labels, errorIndex, errorIndex) : buildSteps(labels, currentIndex);
  return {
    title,
    description,
    value: estimateValue(steps),
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
      progress: buildProgressPayload(labels, 2, "ログ生成で問題が発生しました", "再試行すると復旧できる場合があります。", 2),
    };
  }

  if (hasRejectedPart(input.parts)) {
    return {
      stage: "REJECTED",
      statusLabel: "内容不足",
      canLeavePage: true,
      canOpenLog: false,
      openLogId: null,
      waitingForPart: null,
      progress: buildProgressPayload(labels, 1, "会話量が足りず停止しました", "録音し直すか、内容を補足して再保存してください。", 1),
    };
  }

  if (input.parts.some((part) => part.status === "ERROR")) {
    return {
      stage: "ERROR",
      statusLabel: "処理エラー",
      canLeavePage: true,
      canOpenLog: Boolean(conversation?.id),
      openLogId: conversation?.id ?? null,
      waitingForPart: null,
      progress: buildProgressPayload(labels, 1, "文字起こしで問題が発生しました", "しばらく待ってから再試行してください。", 1),
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
          "文字起こしをまとめて、指導報告ログを生成しています。"
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
          "次はチェックアウトを録音またはアップロードしてください。"
        ),
      };
    }

    if (hasReadyCheckIn && isBusy(checkOut)) {
      return {
        stage: "TRANSCRIBING",
        statusLabel: "チェックアウト文字起こし中",
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          1,
          "チェックアウトを文字起こし中です",
          "保存受付は完了しています。このまま閉じても大丈夫です。"
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
          "チェックインを追加すると、指導報告ログの生成に進みます。"
        ),
      };
    }

    if (hasReadyCheckOut && isBusy(checkIn)) {
      return {
        stage: "TRANSCRIBING",
        statusLabel: "チェックイン文字起こし中",
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          0,
          "チェックインを文字起こし中です",
          "保存受付は完了しています。このまま閉じても大丈夫です。"
        ),
      };
    }

    if (isBusy(checkIn)) {
      return {
        stage: "TRANSCRIBING",
        statusLabel: "チェックイン文字起こし中",
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          0,
          "チェックインを受け付けました",
          "まずは文字起こしを進めています。このまま閉じても大丈夫です。"
        ),
      };
    }

    if (isBusy(checkOut)) {
      return {
        stage: "TRANSCRIBING",
        statusLabel: "チェックアウト文字起こし中",
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          1,
          "チェックアウトを受け付けました",
          "文字起こしが終わりしだい、指導報告ログに進みます。"
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
          "文字起こしが終わり、面談ログ本文を生成しています。"
        ),
      };
    }

    if (isBusy(full)) {
      return {
        stage: "TRANSCRIBING",
        statusLabel: "文字起こし中",
        canLeavePage: true,
        canOpenLog: false,
        openLogId: null,
        waitingForPart: null,
        progress: buildProgressPayload(
          labels,
          1,
          "音声を受け付けました",
          "文字起こしを進めています。このまま閉じても大丈夫です。"
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
      progress: buildProgressPayload(labels, 0, "保存を受け付けました", "処理を順番に開始します。"),
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
