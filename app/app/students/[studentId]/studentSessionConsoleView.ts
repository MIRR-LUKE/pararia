import type { GenerationProgressState } from "@/lib/generation-progress";
import type { SessionPipelineInfo } from "./roomTypes";
import type { ConsoleState, SessionConsoleLessonPart, SessionConsoleMode } from "./studentSessionConsoleTypes";

type ProgressInput = {
  mode: SessionConsoleMode;
  state: ConsoleState;
  sessionProgress: SessionPipelineInfo | null;
};

type StatusCopyInput = {
  mode: SessionConsoleMode;
  lessonPart: SessionConsoleLessonPart;
  state: ConsoleState;
  studentName: string;
  message: string;
  generationProgress: GenerationProgressState | null;
};

export function getStudentSessionConsoleIdleCopy(
  mode: SessionConsoleMode,
  lessonPart: SessionConsoleLessonPart
) {
  return {
    headline: "面談を始めましょう",
    description: "録音が終わると、自動でログを整理して次回の話題まで更新します。",
  };
}

export function buildStudentSessionConsoleProgress({
  mode,
  state,
  sessionProgress,
}: ProgressInput): GenerationProgressState | null {
  if (state !== "uploading" && state !== "processing") return null;
  if (sessionProgress?.progress) return sessionProgress.progress;

  return {
    title: "文字起こし準備中です",
    description: "STT worker を起動しています。このまま閉じても大丈夫です。",
    value: 18,
    steps: [
      { id: "0-save", label: "保存受付", status: "complete" as const },
      { id: "1-stt", label: "文字起こし", status: "active" as const },
      { id: "2-generate", label: "ログ生成", status: "pending" as const },
      { id: "3-done", label: "完了", status: "pending" as const },
    ],
  };
}

export function buildStudentSessionConsoleStatusCopy({
  mode,
  lessonPart,
  state,
  studentName,
  message,
  generationProgress,
}: StatusCopyInput) {
  const idleCopy = getStudentSessionConsoleIdleCopy(mode, lessonPart);

  if (state === "recording") {
    return {
      currentStudentLabel: `${studentName} を録音中`,
      statusLine: "話し終えたら終了してください。自動で保存して生成に入ります。",
    };
  }

  if (state === "preparing") {
    return {
      currentStudentLabel: `${studentName} の録音準備中`,
      statusLine: message || "マイクと録音セッションを準備しています。",
    };
  }

  if (state === "uploading" || state === "processing") {
    return {
      currentStudentLabel: generationProgress?.title ?? "文字起こし準備中です",
      statusLine: generationProgress?.description ?? message,
    };
  }

  return {
    currentStudentLabel: idleCopy.headline,
    statusLine: message || idleCopy.description,
  };
}
