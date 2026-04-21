"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UNSAVED_CONVERSATION_SUMMARY_MESSAGE } from "@/lib/conversation-editing";
import { formatReportDate, formatSessionLabel } from "./studentDetailFormatting";
import type { ReportItem, ReportStudioView, RoomResponse, SessionItem } from "./roomTypes";
import {
  type StudentDetailSearchParamsLike,
  type StudentDetailDeleteTarget,
  type StudentDetailOverlayState,
  type StudentDetailUrlChanges,
} from "./studentDetailState";

type Params = {
  room: RoomResponse | null;
  queryParams: StudentDetailSearchParamsLike;
  selectedSessionIds: string[];
  syncUrl: (changes: StudentDetailUrlChanges) => void;
  refresh: () => Promise<void> | void;
};

type Result = {
  overlay: StudentDetailOverlayState;
  parentReportLoadingId: string | null;
  parentReportError: string | null;
  activeParentReport: ReportItem | null;
  logHasUnsavedChanges: boolean;
  onDirtyChange: (dirty: boolean) => void;
  openLog: (logId: string) => void;
  openReportStudio: (view: ReportStudioView) => void;
  openTranscriptReview: (logId: string) => void;
  openParentReport: (reportId: string) => void;
  openReportStudioSend: () => void;
  requestOverlayClose: () => void;
  onReportViewChange: (view: ReportStudioView) => void;
  onRetryParentReport: (reportId: string) => void;
  openDeleteDialogForLog: () => void;
  openDeleteDialogForReport: () => void;
  deleteTarget: StudentDetailDeleteTarget | null;
  isDeletingTarget: boolean;
  deleteSelectedTarget: () => Promise<void>;
  clearDeleteTarget: () => void;
};

function resolveOverlayState(
  room: RoomResponse | null,
  queryParams: StudentDetailSearchParamsLike,
  selectedSessionIds: string[]
): StudentDetailOverlayState {
  const panel = queryParams.get("panel");
  const logId = queryParams.get("logId");
  const reportId = queryParams.get("reportId");
  const lessonSessionId = queryParams.get("lessonSessionId");

  if (panel === "log" && logId) {
    return { kind: "log", logId };
  }
  if (panel === "report") {
    const reportCount = room?.reports?.length ?? 0;
    return { kind: "report", view: reportCount > 0 && selectedSessionIds.length === 0 ? "generated" : "selection" };
  }
  if (panel === "lessonReport" && lessonSessionId) {
    const lessonSession = room?.sessions.find((session) => session.id === lessonSessionId);
    if (lessonSession?.conversation?.id) {
      return { kind: "log", logId: lessonSession.conversation.id };
    }
  }
  if (panel === "parentReport" && reportId) {
    return { kind: "parentReport", reportId };
  }
  return { kind: "none" };
}

function findSessionByLogId(sessions: SessionItem[], logId: string) {
  return sessions.find((session) => session.conversation?.id === logId) ?? null;
}

function isSameOverlayState(left: StudentDetailOverlayState, right: StudentDetailOverlayState) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "none") return true;
  if (left.kind === "log" && right.kind === "log") return left.logId === right.logId;
  if (left.kind === "parentReport" && right.kind === "parentReport") return left.reportId === right.reportId;
  if (left.kind === "report" && right.kind === "report") return left.view === right.view;
  return false;
}

export function useStudentDetailOverlay({
  room,
  queryParams,
  selectedSessionIds,
  syncUrl,
  refresh,
}: Params): Result {
  const router = useRouter();
  const [overlay, setOverlay] = useState<StudentDetailOverlayState>(() =>
    resolveOverlayState(room, queryParams, selectedSessionIds)
  );
  const pendingUrlOverlayRef = useRef<StudentDetailOverlayState | null>(null);
  const [parentReportDetails, setParentReportDetails] = useState<Record<string, ReportItem>>({});
  const [parentReportLoadingId, setParentReportLoadingId] = useState<string | null>(null);
  const [parentReportError, setParentReportError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudentDetailDeleteTarget | null>(null);
  const [isDeletingTarget, setIsDeletingTarget] = useState(false);
  const [logHasUnsavedChanges, setLogHasUnsavedChanges] = useState(false);

  useEffect(() => {
    const resolved = resolveOverlayState(room, queryParams, selectedSessionIds);
    const pending = pendingUrlOverlayRef.current;

    if (pending) {
      if (isSameOverlayState(resolved, pending)) {
        pendingUrlOverlayRef.current = null;
      } else {
        return;
      }
    }

    setOverlay((current) => (isSameOverlayState(current, resolved) ? current : resolved));
  }, [queryParams, room, selectedSessionIds]);

  useEffect(() => {
    if (overlay.kind === "log") return;
    setLogHasUnsavedChanges(false);
  }, [overlay.kind]);

  const activeLogSession =
    overlay.kind === "log" ? findSessionByLogId(room?.sessions ?? [], overlay.logId) : null;
  const activeParentReportBase =
    overlay.kind === "parentReport" ? (room?.reports ?? []).find((report) => report.id === overlay.reportId) ?? null : null;
  const activeParentReport = useMemo(
    () =>
      activeParentReportBase
        ? {
            ...activeParentReportBase,
            ...(parentReportDetails[activeParentReportBase.id] ?? {}),
          }
        : null,
    [activeParentReportBase, parentReportDetails]
  );
  const activeLogReportUsageCount =
    overlay.kind === "log"
      ? (room?.reports ?? []).filter((report) => report.sourceLogIds?.includes(overlay.logId)).length
      : 0;

  const fetchParentReportDetail = useCallback(
    async (reportId: string) => {
      if (parentReportDetails[reportId]) return parentReportDetails[reportId];

      setParentReportLoadingId(reportId);
      setParentReportError(null);
      try {
        const res = await fetch(`/api/reports/${reportId}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error ?? "保護者レポートの取得に失敗しました。");
        }
        const nextReport = body?.report as ReportItem | undefined;
        if (!nextReport) {
          throw new Error("保護者レポートの取得に失敗しました。");
        }
        setParentReportDetails((current) => ({ ...current, [reportId]: nextReport }));
        return nextReport;
      } catch (nextError: any) {
        setParentReportError(nextError?.message ?? "保護者レポートの取得に失敗しました。");
        return null;
      } finally {
        setParentReportLoadingId((current) => (current === reportId ? null : current));
      }
    },
    [parentReportDetails]
  );

  useEffect(() => {
    if (overlay.kind !== "parentReport" || !activeParentReportBase) return;
    if (activeParentReportBase.reportMarkdown) return;
    if (parentReportDetails[activeParentReportBase.id]) return;
    void fetchParentReportDetail(activeParentReportBase.id);
  }, [activeParentReportBase, fetchParentReportDetail, overlay.kind, parentReportDetails]);

  const closeOverlay = useCallback(() => {
    const nextOverlay = { kind: "none" } satisfies StudentDetailOverlayState;
    pendingUrlOverlayRef.current = nextOverlay;
    setOverlay(nextOverlay);
    syncUrl({ panel: null, logId: null, reportId: null, lessonSessionId: null });
  }, [syncUrl]);

  const openLog = useCallback(
    (logId: string) => {
      const nextOverlay = { kind: "log", logId } satisfies StudentDetailOverlayState;
      pendingUrlOverlayRef.current = nextOverlay;
      setOverlay(nextOverlay);
      syncUrl({ panel: "log", logId, reportId: null, lessonSessionId: null });
    },
    [syncUrl]
  );

  const openReportStudio = useCallback(
    (view: ReportStudioView) => {
      const nextOverlay = { kind: "report", view } satisfies StudentDetailOverlayState;
      pendingUrlOverlayRef.current = nextOverlay;
      setOverlay(nextOverlay);
      syncUrl({ panel: "report", logId: null, reportId: null, lessonSessionId: null });
    },
    [syncUrl]
  );

  const openTranscriptReview = useCallback(
    (logId: string) => {
      router.push(`/app/logs/${logId}`);
    },
    [router]
  );

  const openParentReport = useCallback(
    (reportId: string) => {
      setParentReportError(null);
      const nextOverlay = { kind: "parentReport", reportId } satisfies StudentDetailOverlayState;
      pendingUrlOverlayRef.current = nextOverlay;
      setOverlay(nextOverlay);
      syncUrl({ panel: "parentReport", reportId, logId: null, lessonSessionId: null, tab: "parentReports" });
    },
    [syncUrl]
  );

  const openReportStudioSend = useCallback(() => {
    void openReportStudio("send");
  }, [openReportStudio]);

  const onReportViewChange = useCallback((view: ReportStudioView) => {
    const nextOverlay = { kind: "report", view } satisfies StudentDetailOverlayState;
    pendingUrlOverlayRef.current = nextOverlay;
    setOverlay(nextOverlay);
  }, []);

  const requestOverlayClose = useCallback(() => {
    if (overlay.kind === "log" && logHasUnsavedChanges && !window.confirm(UNSAVED_CONVERSATION_SUMMARY_MESSAGE)) {
      return;
    }
    closeOverlay();
  }, [closeOverlay, logHasUnsavedChanges, overlay.kind]);

  const openDeleteDialogForLog = useCallback(() => {
    if (overlay.kind !== "log") return;
    if (logHasUnsavedChanges && !window.confirm(UNSAVED_CONVERSATION_SUMMARY_MESSAGE)) return;

    const label = activeLogSession ? formatSessionLabel(activeLogSession) : "このログ";
    const usageDetail =
      activeLogReportUsageCount > 0
        ? `${activeLogReportUsageCount}件の保護者レポートからは参照件数だけが残ります。必要ならあとでこのログを戻せます。`
        : "一覧からは隠れますが、あとで戻せます。";

    setDeleteTarget({
      kind: "conversation",
      id: overlay.logId,
      label,
      detail: `${label}を一覧から隠します。本文と文字起こしは復元用にしばらく残ります。${usageDetail}`,
    });
  }, [activeLogReportUsageCount, activeLogSession, logHasUnsavedChanges, overlay]);

  const openDeleteDialogForReport = useCallback(() => {
    if (!activeParentReport) return;

    setDeleteTarget({
      kind: "report",
      id: activeParentReport.id,
      label: `${formatReportDate(activeParentReport.createdAt)} の保護者レポート`,
      detail: "レポートを一覧から隠します。本文と共有履歴は復元用にしばらく残ります。",
    });
  }, [activeParentReport]);

  const deleteSelectedTarget = useCallback(async () => {
    if (!deleteTarget) return;

    setIsDeletingTarget(true);
    try {
      const res = await fetch(
        deleteTarget.kind === "conversation" ? `/api/conversations/${deleteTarget.id}` : `/api/reports/${deleteTarget.id}`,
        {
          method: "DELETE",
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ??
            (deleteTarget.kind === "conversation" ? "ログの削除に失敗しました。" : "保護者レポートの削除に失敗しました。")
        );
      }

      setDeleteTarget(null);
      closeOverlay();
      await refresh();
    } catch (nextError: any) {
      alert(
        nextError?.message ??
          (deleteTarget.kind === "conversation" ? "ログの削除に失敗しました。" : "保護者レポートの削除に失敗しました。")
      );
    } finally {
      setIsDeletingTarget(false);
    }
  }, [closeOverlay, deleteTarget, refresh]);

  const clearDeleteTarget = useCallback(() => setDeleteTarget(null), []);
  const onRetryParentReport = useCallback(
    (reportId: string) => {
      void fetchParentReportDetail(reportId);
    },
    [fetchParentReportDetail]
  );

  return {
    overlay,
    parentReportLoadingId,
    parentReportError,
    activeParentReport,
    logHasUnsavedChanges,
    onDirtyChange: setLogHasUnsavedChanges,
    openLog,
    openReportStudio,
    openTranscriptReview,
    openParentReport,
    openReportStudioSend,
    requestOverlayClose,
    onReportViewChange,
    openDeleteDialogForLog,
    openDeleteDialogForReport,
    deleteTarget,
    isDeletingTarget,
    deleteSelectedTarget,
    clearDeleteTarget,
    onRetryParentReport,
  };
}
