export type GenerationMode = "INTERVIEW" | "LESSON_REPORT";
export type GenerationStepStatus = "complete" | "active" | "pending" | "error";

export type GenerationStep = {
  id: string;
  label: string;
  status: GenerationStepStatus;
};

export type GenerationProgressState = {
  title: string;
  description: string;
  value: number;
  steps: GenerationStep[];
};

type ConversationStage = "uploading" | "processing" | "done" | "error";
type ParentReportStage = "validating" | "gathering" | "drafting" | "saving" | "done" | "error";

type ConversationJobLike = {
  type?: string | null;
  status?: string | null;
  lastError?: string | null;
};

const CONVERSATION_STEP_LABELS: Record<GenerationMode, string[]> = {
  INTERVIEW: ["保存", "文字起こし", "分析", "ログ生成", "完了"],
  LESSON_REPORT: ["保存", "文字起こし", "分析", "報告生成", "完了"],
};

const PARENT_REPORT_STEP_LABELS = ["確認", "整理", "生成", "保存"];

function buildSteps(
  labels: string[],
  currentIndex: number,
  errorIndex?: number | null
): GenerationStep[] {
  return labels.map((label, index) => {
    if (typeof errorIndex === "number" && index === errorIndex) {
      return {
        id: `${index}-${label}`,
        label,
        status: "error" as const,
      };
    }
    if (typeof errorIndex === "number" && index > errorIndex) {
      return {
        id: `${index}-${label}`,
        label,
        status: "pending" as const,
      };
    }
    if (index < currentIndex) {
      return {
        id: `${index}-${label}`,
        label,
        status: "complete" as const,
      };
    }
    if (index === currentIndex) {
      return {
        id: `${index}-${label}`,
        label,
        status: "active" as const,
      };
    }
    return {
      id: `${index}-${label}`,
      label,
      status: "pending" as const,
    };
  });
}

function buildCompletedSteps(labels: string[]) {
  return labels.map((label, index) => ({
    id: `${index}-${label}`,
    label,
    status: "complete" as const,
  }));
}

function estimateValue(steps: GenerationStep[]) {
  if (steps.every((step) => step.status === "complete")) {
    return 100;
  }
  const total = steps.length;
  const completed = steps.filter((step) => step.status === "complete").length;
  const hasActive = steps.some((step) => step.status === "active");
  const raw = ((completed + (hasActive ? 0.55 : 0.25)) / Math.max(total, 1)) * 100;
  return Math.max(8, Math.min(96, Math.round(raw)));
}

function getConversationErrorIndex(jobs: ConversationJobLike[]) {
  const firstError = jobs.find((job) => job.status === "ERROR");
  if (!firstError) return 0;
  if (firstError.type === "FINALIZE") return 3;
  if (firstError.type === "REDUCE") return 3;
  if (firstError.type === "CHUNK_ANALYZE") return 2;
  return 1;
}

function getConversationCurrentIndex(jobs: ConversationJobLike[]) {
  const byType = new Map(jobs.map((job) => [job.type, job.status]));
  const analyze = byType.get("CHUNK_ANALYZE");
  const reduce = byType.get("REDUCE");
  const finalize = byType.get("FINALIZE");

  if (finalize === "DONE") return 4;
  if (finalize === "RUNNING" || reduce === "DONE") return 3;
  if (reduce === "RUNNING" || analyze === "DONE" || analyze === "RUNNING") return 2;
  return 1;
}

export function buildConversationGenerationProgress(input: {
  mode: GenerationMode;
  stage: ConversationStage;
  jobs?: ConversationJobLike[] | null;
  conversationStatus?: string | null;
  lastError?: string | null;
}): GenerationProgressState {
  const labels = CONVERSATION_STEP_LABELS[input.mode];

  if (input.stage === "uploading") {
    const steps = buildSteps(labels, 0);
    return {
      title: "音声を保存中…",
      description: "保存後、自動で生成に進みます。",
      value: estimateValue(steps),
      steps,
    };
  }

  if (input.stage === "done" || input.conversationStatus === "DONE") {
    const steps = buildCompletedSteps(labels);
    return {
      title: input.mode === "LESSON_REPORT" ? "指導報告を生成しました" : "面談ログを生成しました",
      description: "結果を確認できます。",
      value: 100,
      steps,
    };
  }

  if (input.stage === "error" || input.conversationStatus === "ERROR") {
    const errorIndex = getConversationErrorIndex(input.jobs ?? []);
    const steps = buildSteps(labels, errorIndex, errorIndex);
    return {
      title: "再試行中…",
      description:
        input.lastError?.trim() || "一時的な問題を検知しました。自動で再開しています。",
      value: estimateValue(steps),
      steps,
    };
  }

  const currentIndex = getConversationCurrentIndex(input.jobs ?? []);
  const steps = buildSteps(labels, currentIndex);
  const descriptionByIndex = [
    "音声データを安全に保存しています。",
    "文字起こしを整えています。",
    "会話の要点を抽出しています。",
    input.mode === "LESSON_REPORT"
      ? "指導報告と引き継ぎ事項を生成しています。"
      : "面談ログと話題候補を生成しています。",
    "最終確認しています。",
  ];

  return {
    title: input.mode === "LESSON_REPORT" ? "指導報告を生成中…" : "面談ログを生成中…",
    description: descriptionByIndex[currentIndex] ?? descriptionByIndex[2],
    value: estimateValue(steps),
    steps,
  };
}

export function buildParentReportGenerationProgress(input: {
  stage: ParentReportStage;
  selectedCount: number;
  lastError?: string | null;
}): GenerationProgressState {
  if (input.stage === "done") {
    const steps = buildCompletedSteps(PARENT_REPORT_STEP_LABELS);
    return {
      title: "保護者レポートを生成しました",
      description: `${Math.max(input.selectedCount, 1)}件のログから下書きを保存しました。`,
      value: 100,
      steps,
    };
  }

  if (input.stage === "error") {
    const steps = buildSteps(PARENT_REPORT_STEP_LABELS, 2, 2);
    return {
      title: "レポート生成に失敗しました",
      description: input.lastError?.trim() || "もう一度お試しください。",
      value: estimateValue(steps),
      steps,
    };
  }

  const currentIndex =
    input.stage === "validating" ? 0 : input.stage === "gathering" ? 1 : input.stage === "drafting" ? 2 : 3;
  const steps = buildSteps(PARENT_REPORT_STEP_LABELS, currentIndex);
  const descriptionByStage: Record<ParentReportStage, string> = {
    validating: `${input.selectedCount}件のログを確認中…`,
    gathering: "要点と共有材料を整理中…",
    drafting: "レポート本文を生成中…",
    saving: "下書きを保存中…",
    done: `${Math.max(input.selectedCount, 1)}件のログから下書きを保存しました。`,
    error: input.lastError?.trim() || "もう一度お試しください。",
  };

  return {
    title: "保護者レポートを生成中…",
    description: descriptionByStage[input.stage],
    value: estimateValue(steps),
    steps,
  };
}
