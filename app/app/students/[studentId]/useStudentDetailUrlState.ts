"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  applyStudentDetailSearchParams,
  EMPTY_SEARCH_PARAMS,
  normalizeLessonPart,
  normalizeRecordingMode,
  normalizeTab,
  type StudentDetailSearchParamsLike,
  type StudentDetailTabKey,
  type StudentDetailUrlChanges,
} from "./studentDetailState";
import type { SessionConsoleLessonPart, SessionConsoleMode } from "./StudentSessionConsole";

type Result = {
  queryParams: StudentDetailSearchParamsLike;
  activeTab: StudentDetailTabKey;
  setActiveTab: (tab: StudentDetailTabKey) => void;
  recordingMode: SessionConsoleMode;
  setRecordingMode: (mode: SessionConsoleMode) => void;
  lessonPart: SessionConsoleLessonPart;
  setLessonPart: (part: SessionConsoleLessonPart) => void;
  syncUrl: (changes: StudentDetailUrlChanges) => void;
};

export function useStudentDetailUrlState(fallbackPathname: string): Result {
  const router = useRouter();
  const pathname = usePathname();
  const currentPathname = pathname ?? fallbackPathname;
  const searchParams = useSearchParams();
  const queryParams: StudentDetailSearchParamsLike = searchParams ?? EMPTY_SEARCH_PARAMS;

  const [activeTab, setActiveTabState] = useState<StudentDetailTabKey>(normalizeTab(queryParams.get("tab")));
  const [recordingMode, setRecordingModeState] = useState<SessionConsoleMode>(
    normalizeRecordingMode(queryParams.get("mode")) ?? "INTERVIEW"
  );
  const [lessonPart, setLessonPartState] = useState<SessionConsoleLessonPart>(
    normalizeLessonPart(queryParams.get("part")) ?? "CHECK_IN"
  );

  useEffect(() => {
    setActiveTabState(normalizeTab(queryParams.get("tab")));
  }, [queryParams]);

  useEffect(() => {
    const requestedMode = normalizeRecordingMode(queryParams.get("mode")) ?? "INTERVIEW";
    setRecordingModeState((current) => (current === requestedMode ? current : requestedMode));
  }, [queryParams]);

  useEffect(() => {
    const requestedPart = normalizeLessonPart(queryParams.get("part")) ?? "CHECK_IN";
    setLessonPartState((current) => (current === requestedPart ? current : requestedPart));
  }, [queryParams]);

  const syncUrl = useCallback(
    (changes: StudentDetailUrlChanges) => {
      const nextParams = applyStudentDetailSearchParams(queryParams, changes);
      const nextUrl = nextParams.toString() ? `${currentPathname}?${nextParams.toString()}` : currentPathname;
      router.replace(nextUrl, { scroll: false });
    },
    [currentPathname, queryParams, router]
  );

  const setActiveTab = useCallback(
    (tab: StudentDetailTabKey) => {
      setActiveTabState(tab);
      syncUrl({ tab });
    },
    [syncUrl]
  );

  const setRecordingMode = useCallback(
    (mode: SessionConsoleMode) => {
      setRecordingModeState(mode);
      syncUrl({ mode });
    },
    [syncUrl]
  );

  const setLessonPart = useCallback(
    (part: SessionConsoleLessonPart) => {
      setLessonPartState(part);
      syncUrl({ part });
    },
    [syncUrl]
  );

  return { queryParams, activeTab, setActiveTab, recordingMode, setRecordingMode, lessonPart, setLessonPart, syncUrl };
}
