"use client";

import { buildLessonReportFlowMessage, getLessonReportPartState } from "@/lib/lesson-report-flow";
import type { StudentSessionConsoleControllerParams } from "./useStudentSessionConsoleControllerRecording";
import { useStudentSessionConsoleRecording } from "./useStudentSessionConsoleControllerRecording";

type Props = StudentSessionConsoleControllerParams;

export function useStudentSessionConsoleController(props: Props) {
  const recording = useStudentSessionConsoleRecording(props);
  const lessonFlowState = getLessonReportPartState(props.ongoingLessonSession?.parts ?? []);
  const lessonFlowMessage = buildLessonReportFlowMessage(props.ongoingLessonSession);

  return {
    ...recording,
    lessonFlowMessage,
    lessonFlowState,
  };
}
