"use client";

import type { StudentSessionConsoleControllerParams } from "./useStudentSessionConsoleControllerRecording";
import { useStudentSessionConsoleRecording } from "./useStudentSessionConsoleControllerRecording";

type Props = StudentSessionConsoleControllerParams;

export function useStudentSessionConsoleController(props: Props) {
  const recording = useStudentSessionConsoleRecording(props);

  return {
    ...recording,
    lessonFlowMessage: null,
    lessonFlowState: {
      hasFull: false,
      hasReadyFull: false,
      hasTextNote: false,
      hasReadyTextNote: false,
      isComplete: false,
    },
  };
}
