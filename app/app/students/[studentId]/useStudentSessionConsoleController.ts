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
      hasCheckIn: false,
      hasReadyCheckIn: false,
      hasCheckOut: false,
      hasReadyCheckOut: false,
      isComplete: false,
    },
  };
}
