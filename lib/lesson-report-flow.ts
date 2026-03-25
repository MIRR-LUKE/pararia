export type LessonPartLike = {
  partType?: string | null;
  status?: string | null;
};

export type LessonSessionLike = {
  id?: string | null;
  type?: string | null;
  status?: string | null;
  parts?: LessonPartLike[] | null;
};

export type LessonReportPartState = {
  hasReadyCheckIn: boolean;
  hasReadyCheckOut: boolean;
  isComplete: boolean;
  nextRecommendedPart: "CHECK_IN" | "CHECK_OUT";
};

function isReadyPart(part: LessonPartLike, partType: "CHECK_IN" | "CHECK_OUT") {
  return part.partType === partType && part.status === "READY";
}

export function getLessonReportPartState(parts: LessonPartLike[] = []): LessonReportPartState {
  const hasReadyCheckIn = parts.some((part) => isReadyPart(part, "CHECK_IN"));
  const hasReadyCheckOut = parts.some((part) => isReadyPart(part, "CHECK_OUT"));
  return {
    hasReadyCheckIn,
    hasReadyCheckOut,
    isComplete: hasReadyCheckIn && hasReadyCheckOut,
    nextRecommendedPart: hasReadyCheckIn ? "CHECK_OUT" : "CHECK_IN",
  };
}

export function isLessonReportSessionOpenForCollection(session: LessonSessionLike | null | undefined) {
  if (!session || session.type !== "LESSON_REPORT") return false;
  return !getLessonReportPartState(session.parts ?? []).isComplete;
}

export function pickOngoingLessonReportSession<T extends LessonSessionLike>(sessions: T[] = []) {
  return sessions.find((session) => isLessonReportSessionOpenForCollection(session)) ?? null;
}

export function buildLessonReportFlowMessage(session: LessonSessionLike | null | undefined) {
  const state = getLessonReportPartState(session?.parts ?? []);
  if (!session) {
    return "① チェックインを保存 → ② チェックアウトを保存 → 指導報告を自動生成";
  }
  if (state.hasReadyCheckIn && !state.hasReadyCheckOut) {
    return "チェックイン保存済み。チェックアウトを録音すると指導報告を自動生成します。";
  }
  if (!state.hasReadyCheckIn && state.hasReadyCheckOut) {
    return "チェックアウト保存済み。チェックインを追加すると指導報告を自動生成します。";
  }
  if (state.isComplete) {
    return "チェックイン・チェックアウトがそろいました。指導報告を生成中です。";
  }
  return "① チェックインを保存 → ② チェックアウトを保存 → 指導報告を自動生成";
}
