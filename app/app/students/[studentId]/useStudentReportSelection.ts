"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionItem } from "./roomTypes";
import { arraysEqual, type StudentDetailSearchParamsLike, type StudentDetailUrlChanges } from "./studentDetailState";

type Params = {
  sessions: SessionItem[];
  queryParams: StudentDetailSearchParamsLike;
  syncUrl: (changes: StudentDetailUrlChanges) => void;
};

type Result = {
  selectedSessionIds: string[];
  reportSelectionSessions: SessionItem[];
  allSelected: boolean;
  handleSelectedSessionIdsChange: (ids: string[]) => void;
  toggleReportSelection: (sessionId: string) => void;
  toggleSelectAll: () => void;
};

function getRequestedSessionIds(queryParams: StudentDetailSearchParamsLike, validIds: Set<string>) {
  return (queryParams.get("sessionIds") ?? "")
    .split(",")
    .filter(Boolean)
    .filter((id) => validIds.has(id));
}

export function useStudentReportSelection({ sessions, queryParams, syncUrl }: Params): Result {
  const candidateReportSessions = useMemo(
    () =>
      sessions.filter((session) => session.type === "INTERVIEW" && session.conversation?.status === "DONE"),
    [sessions]
  );
  const reportSelectionSessions = useMemo(() => candidateReportSessions.slice(0, 4), [candidateReportSessions]);
  const allSelectionIds = useMemo(() => reportSelectionSessions.map((item) => item.id), [reportSelectionSessions]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>(() =>
    getRequestedSessionIds(queryParams, new Set(allSelectionIds))
  );
  const allSelected = allSelectionIds.length > 0 && allSelectionIds.every((id) => selectedSessionIds.includes(id));

  useEffect(() => {
    const validIds = new Set(allSelectionIds);
    const requestedIds = getRequestedSessionIds(queryParams, validIds);
    setSelectedSessionIds((current) => (arraysEqual(current, requestedIds) ? current : requestedIds));
  }, [allSelectionIds, queryParams]);

  const handleSelectedSessionIdsChange = useCallback(
    (ids: string[]) => {
      setSelectedSessionIds(ids);
      syncUrl({ sessionIds: ids });
    },
    [syncUrl]
  );

  const toggleReportSelection = useCallback(
    (sessionId: string) => {
      const nextIds = selectedSessionIds.includes(sessionId)
        ? selectedSessionIds.filter((id) => id !== sessionId)
        : [...selectedSessionIds, sessionId];
      handleSelectedSessionIdsChange(nextIds);
    },
    [handleSelectedSessionIdsChange, selectedSessionIds]
  );

  const toggleSelectAll = useCallback(() => {
    handleSelectedSessionIdsChange(allSelected ? [] : allSelectionIds);
  }, [allSelected, allSelectionIds, handleSelectedSessionIdsChange]);

  return { selectedSessionIds, reportSelectionSessions, allSelected, handleSelectedSessionIdsChange, toggleReportSelection, toggleSelectAll };
}
