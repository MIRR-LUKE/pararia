import type { ReportStudioView } from "./roomTypes";

export type StudentDetailTabKey = "communications" | "parentReports";
export type StudentDetailPeriodFilter = "all" | "month";
export type StudentDetailSortOrder = "desc" | "asc";
export type SessionConsoleMode = "INTERVIEW";
export type SessionConsoleLessonPart = "FULL" | "TEXT_NOTE";

export type StudentDetailOverlayState =
  | { kind: "none" }
  | { kind: "log"; logId: string }
  | { kind: "report"; view: ReportStudioView }
  | { kind: "parentReport"; reportId: string };

export type StudentDetailDeleteTarget =
  | { kind: "conversation"; id: string; label: string; detail: string }
  | { kind: "report"; id: string; label: string; detail: string };

export type StudentDetailUrlChanges = {
  tab?: StudentDetailTabKey | null;
  panel?: string | null;
  logId?: string | null;
  reportId?: string | null;
  lessonSessionId?: string | null;
  sessionIds?: string[] | null;
  mode?: SessionConsoleMode | null;
  part?: SessionConsoleLessonPart | null;
};

export type StudentDetailSearchParamsLike = Pick<URLSearchParams, "get" | "toString">;

export const EMPTY_SEARCH_PARAMS = new URLSearchParams();

export function normalizeTab(value: string | null): StudentDetailTabKey {
  if (value === "parentReports") return "parentReports";
  return "communications";
}

export function normalizeRecordingMode(value: string | null): SessionConsoleMode | null {
  if (value === "INTERVIEW") return "INTERVIEW";
  return null;
}

export function normalizeLessonPart(value: string | null): SessionConsoleLessonPart | null {
  if (value === "FULL") return "FULL";
  if (value === "TEXT_NOTE") return "TEXT_NOTE";
  return null;
}

export function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function applyStudentDetailSearchParams(base: StudentDetailSearchParamsLike, changes: StudentDetailUrlChanges) {
  const nextParams = new URLSearchParams(base.toString());
  const apply = (key: string, value?: string | null) => {
    if (typeof value === "undefined") return;
    if (!value) nextParams.delete(key);
    else nextParams.set(key, value);
  };

  apply("tab", changes.tab);
  apply("panel", changes.panel);
  apply("logId", changes.logId);
  apply("reportId", changes.reportId);
  apply("lessonSessionId", changes.lessonSessionId);
  apply("mode", changes.mode);
  apply("part", changes.part);

  if (typeof changes.sessionIds !== "undefined") {
    if (changes.sessionIds && changes.sessionIds.length > 0) nextParams.set("sessionIds", changes.sessionIds.join(","));
    else nextParams.delete("sessionIds");
  }

  return nextParams;
}
