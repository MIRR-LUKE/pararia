"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { StructuredMarkdown } from "@/components/ui/StructuredMarkdown";
import { getLessonReportPartState, pickOngoingLessonReportSession } from "@/lib/lesson-report-flow";
import { LogView } from "../../logs/LogView";
import { ReportStudio } from "./ReportStudio";
import {
  StudentSessionConsole,
  type SessionConsoleLessonPart,
  type SessionConsoleMode,
} from "./StudentSessionConsole";
import { StudentSessionStream } from "./StudentSessionStream";
import type { ReportStudioView, RoomResponse, SessionItem } from "./roomTypes";
import styles from "./studentDetail.module.css";

type TabKey = "communications" | "lessonReports" | "parentReports";
type PeriodFilter = "all" | "month";
type SortOrder = "desc" | "asc";

type OverlayState =
  | { kind: "none" }
  | { kind: "log"; logId: string }
  | { kind: "report"; view: ReportStudioView }
  | { kind: "parentReport"; reportId: string };

function normalizeTab(value: string | null): TabKey {
  if (value === "lessonReports") return "lessonReports";
  if (value === "parentReports") return "parentReports";
  return "communications";
}

function normalizeRecordingMode(value: string | null): SessionConsoleMode | null {
  if (value === "LESSON_REPORT") return "LESSON_REPORT";
  if (value === "INTERVIEW") return "INTERVIEW";
  return null;
}

function normalizeLessonPart(value: string | null): SessionConsoleLessonPart | null {
  if (value === "CHECK_OUT") return "CHECK_OUT";
  if (value === "CHECK_IN") return "CHECK_IN";
  return null;
}

function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function formatUpdated(value?: string | null) {
  if (!value) return "未更新";
  const diff = Date.now() - new Date(value).getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days <= 0) return "今日";
  if (days === 1) return "1日前";
  return `${days}日前`;
}

function formatReportDate(value?: string | null) {
  if (!value) return "未生成";
  const date = new Date(value);
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

function formatSessionLabel(session: SessionItem) {
  const date = new Date(session.sessionDate);
  const base = `${date.getMonth() + 1}月${date.getDate()}日`;
  return session.type === "INTERVIEW" ? `${base}の面談` : `${base}の指導報告`;
}

function withinCurrentMonth(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function lessonSummaryLabel(session: SessionItem) {
  if (session.pipeline?.stage === "WAITING_COUNTERPART") {
    return session.pipeline.waitingForPart === "CHECK_IN"
      ? "チェックアウト保存済み → チェックイン待ち"
      : "チェックイン保存済み → チェックアウト待ち";
  }
  if (session.pipeline?.stage === "TRANSCRIBING") return session.pipeline.progress.title;
  if (session.pipeline?.stage === "GENERATING") return "チェックインとチェックアウトを統合して指導報告ログを生成中";
  const types = session.parts.map((part) => part.partType);
  if (types.includes("CHECK_IN") && types.includes("CHECK_OUT")) return "チェックイン + チェックアウト";
  if (types.includes("CHECK_OUT")) return "チェックアウト";
  if (types.includes("CHECK_IN")) return "チェックイン";
  return "指導報告";
}

function userBadge(name?: string | null) {
  if (!name) return "担当";
  const compact = name.replace(/\s+/g, "");
  return compact.length > 4 ? compact.slice(0, 2) : compact;
}

export default function StudentDetailPage({ params }: { params: { studentId: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(normalizeTab(searchParams.get("tab")));
  const [overlay, setOverlay] = useState<OverlayState>({ kind: "none" });
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [recordingMode, setRecordingMode] = useState<SessionConsoleMode>(
    normalizeRecordingMode(searchParams.get("mode")) ?? "INTERVIEW"
  );
  const [lessonPart, setLessonPart] = useState<SessionConsoleLessonPart>(
    normalizeLessonPart(searchParams.get("part")) ?? "CHECK_IN"
  );
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch(`/api/students/${params.studentId}/room`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "生徒ルームの取得に失敗しました。");
      setRoom(body);
    } catch (nextError: any) {
      if (!silent) {
        setError(nextError?.message ?? "生徒ルームの取得に失敗しました。");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [params.studentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!room?.sessions?.length) return;
    const hasActivePipeline = room.sessions.some((session) =>
      ["TRANSCRIBING", "GENERATING"].includes(session.pipeline?.stage ?? "")
    );
    if (!hasActivePipeline) return;
    const timer = window.setTimeout(() => {
      void refresh({ silent: true });
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [refresh, room?.sessions]);

  const syncUrl = useCallback(
    (changes: {
      tab?: TabKey | null;
      panel?: string | null;
      logId?: string | null;
      reportId?: string | null;
      lessonSessionId?: string | null;
      sessionIds?: string[] | null;
      mode?: SessionConsoleMode | null;
      part?: SessionConsoleLessonPart | null;
    }) => {
      const nextParams = new URLSearchParams(searchParams.toString());
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

      const nextUrl = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname;
      router.replace(nextUrl, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (!room) return;

    const validIds = new Set(room.sessions.map((session) => session.id));
    const requestedIds = (searchParams.get("sessionIds") ?? "")
      .split(",")
      .filter(Boolean)
      .filter((id) => validIds.has(id));

    setSelectedSessionIds((current) => (arraysEqual(current, requestedIds) ? current : requestedIds));
    setActiveTab(normalizeTab(searchParams.get("tab")));

    const panel = searchParams.get("panel");
    const logId = searchParams.get("logId");
    const reportId = searchParams.get("reportId");
    const lessonSessionId = searchParams.get("lessonSessionId");

    if (panel === "log" && logId) {
      setOverlay({ kind: "log", logId });
      return;
    }
    if (panel === "report") {
      setOverlay({ kind: "report", view: room.reports.length > 0 && requestedIds.length === 0 ? "generated" : "selection" });
      return;
    }
    if (panel === "lessonReport" && lessonSessionId) {
      const lessonSession = room.sessions.find((session) => session.id === lessonSessionId);
      if (lessonSession?.conversation?.id) {
        setOverlay({ kind: "log", logId: lessonSession.conversation.id });
        return;
      }
    }
    if (panel === "parentReport" && reportId) {
      setOverlay({ kind: "parentReport", reportId });
      return;
    }
    setOverlay({ kind: "none" });
  }, [room, searchParams]);

  const ongoingLessonSession = useMemo(
    () => pickOngoingLessonReportSession(room?.sessions ?? []),
    [room?.sessions]
  );

  useEffect(() => {
    const requestedMode = normalizeRecordingMode(searchParams.get("mode"));
    if (!requestedMode) return;
    setRecordingMode((current) => (current === requestedMode ? current : requestedMode));
  }, [searchParams]);

  useEffect(() => {
    const requestedPart = normalizeLessonPart(searchParams.get("part"));
    if (requestedPart) {
      setLessonPart((current) => (current === requestedPart ? current : requestedPart));
      return;
    }

    const recommendedPart = getLessonReportPartState(ongoingLessonSession?.parts ?? []).nextRecommendedPart;
    if (recordingMode !== "LESSON_REPORT") return;
    setLessonPart((current) => (current === recommendedPart ? current : recommendedPart));
  }, [ongoingLessonSession?.id, ongoingLessonSession?.parts, recordingMode, searchParams]);

  useEffect(() => {
    if (!ongoingLessonSession) return;
    const state = getLessonReportPartState(ongoingLessonSession.parts ?? []);
    if (state.isComplete) return;
    if (state.hasCheckIn || state.hasCheckOut) {
      setRecordingMode("LESSON_REPORT");
      setLessonPart(state.nextRecommendedPart);
      syncUrl({ mode: "LESSON_REPORT", part: state.nextRecommendedPart });
    }
  }, [ongoingLessonSession, syncUrl]);

  const candidateReportSessions = useMemo(
    () => (room?.sessions ?? []).filter((session) => Boolean(session.conversation?.summaryMarkdown?.trim())),
    [room?.sessions]
  );

  const reportSelectionSessions = useMemo(() => candidateReportSessions.slice(0, 4), [candidateReportSessions]);
  const communicationSessions = useMemo(() => {
    const base = (room?.sessions ?? []).filter((session) => session.type === "INTERVIEW" && session.conversation?.id);
    const filtered = periodFilter === "month" ? base.filter((session) => withinCurrentMonth(session.sessionDate)) : base;
    return [...filtered].sort((left, right) =>
      sortOrder === "desc"
        ? new Date(right.sessionDate).getTime() - new Date(left.sessionDate).getTime()
        : new Date(left.sessionDate).getTime() - new Date(right.sessionDate).getTime()
    );
  }, [periodFilter, room?.sessions, sortOrder]);

  const lessonSessions = useMemo(() => {
    const base = (room?.sessions ?? []).filter(
      (session) =>
        session.type === "LESSON_REPORT" &&
        (session.conversation?.id ||
          ["TRANSCRIBING", "WAITING_COUNTERPART", "GENERATING"].includes(session.pipeline?.stage ?? ""))
    );
    const filtered = periodFilter === "month" ? base.filter((session) => withinCurrentMonth(session.sessionDate)) : base;
    return [...filtered].sort((left, right) =>
      sortOrder === "desc"
        ? new Date(right.sessionDate).getTime() - new Date(left.sessionDate).getTime()
        : new Date(left.sessionDate).getTime() - new Date(right.sessionDate).getTime()
    );
  }, [periodFilter, room?.sessions, sortOrder]);

  const parentReports = useMemo(() => {
    const base = room?.reports ?? [];
    const filtered = periodFilter === "month" ? base.filter((report) => withinCurrentMonth(report.createdAt)) : base;
    return [...filtered].sort((left, right) =>
      sortOrder === "desc"
        ? new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        : new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    );
  }, [periodFilter, room?.reports, sortOrder]);

  const latestConversation = room?.latestConversation ?? null;
  const latestReport = room?.reports[0] ?? null;
  const viewerBadge = userBadge(session?.user?.name ?? null);
  const allSelectionIds = reportSelectionSessions.map((item) => item.id);
  const allSelected = allSelectionIds.length > 0 && allSelectionIds.every((id) => selectedSessionIds.includes(id));

  const handleSelectedSessionIdsChange = useCallback(
    (ids: string[]) => {
      setSelectedSessionIds(ids);
      syncUrl({ sessionIds: ids });
    },
    [syncUrl]
  );

  const toggleReportSelection = useCallback(
    (sessionId: string) => {
      if (selectedSessionIds.includes(sessionId)) {
        handleSelectedSessionIdsChange(selectedSessionIds.filter((id) => id !== sessionId));
        return;
      }
      handleSelectedSessionIdsChange([...selectedSessionIds, sessionId]);
    },
    [handleSelectedSessionIdsChange, selectedSessionIds]
  );

  const toggleSelectAll = useCallback(() => {
    handleSelectedSessionIdsChange(allSelected ? [] : allSelectionIds);
  }, [allSelected, allSelectionIds, handleSelectedSessionIdsChange]);

  const openLog = useCallback(
    (logId: string) => {
      setOverlay({ kind: "log", logId });
      syncUrl({ panel: "log", logId, reportId: null, lessonSessionId: null });
    },
    [syncUrl]
  );

  const openReportStudio = useCallback(
    (view: ReportStudioView) => {
      setOverlay({ kind: "report", view });
      syncUrl({ panel: "report", logId: null, reportId: null, lessonSessionId: null });
    },
    [syncUrl]
  );

  const openParentReport = useCallback(
    (reportId: string) => {
      setOverlay({ kind: "parentReport", reportId });
      syncUrl({ panel: "parentReport", reportId, logId: null, lessonSessionId: null, tab: "parentReports" });
    },
    [syncUrl]
  );

  const closeOverlay = useCallback(() => {
    setOverlay({ kind: "none" });
    syncUrl({ panel: null, logId: null, reportId: null, lessonSessionId: null });
  }, [syncUrl]);
  const activeParentReport =
    overlay.kind === "parentReport" ? parentReports.find((report) => report.id === overlay.reportId) ?? null : null;

  if (loading) {
    return <div className={styles.loadingState}>生徒詳細を読み込んでいます...</div>;
  }

  if (error || !room) {
    return (
      <div className={styles.errorState}>
        <strong>生徒詳細を開けませんでした。</strong>
        <p>{error ?? "データの取得に失敗しました。"}</p>
        <Button variant="secondary" onClick={() => void refresh()}>
          もう一度読み込む
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.breadcrumbs}>
          <Link href="/app/students">生徒一覧</Link>
          <span>＞</span>
          <span>{room.student.name}</span>
        </div>
        <div className={styles.viewerBubble}>{viewerBadge}</div>
      </div>

      <div className={styles.headingBlock}>
        <div className={styles.gradeLabel}>{room.student.grade ?? "学年未設定"}</div>
        <h1 className={styles.studentName}>{room.student.name}</h1>
        <div className={styles.updatedText}>最終更新：{formatUpdated(latestConversation?.createdAt ?? latestReport?.createdAt ?? null)}</div>
      </div>

      <section className={styles.topGrid}>
        <div className={styles.recordCard}>
          <StudentSessionConsole
            studentId={room.student.id}
            studentName={room.student.name}
            mode={recordingMode}
            lessonPart={lessonPart}
            ongoingLessonSession={ongoingLessonSession}
            onModeChange={(nextMode) => {
              setRecordingMode(nextMode);
              syncUrl({ mode: nextMode });
            }}
            onLessonPartChange={(nextPart) => {
              setLessonPart(nextPart);
              syncUrl({ part: nextPart });
            }}
            onRefresh={refresh}
            onOpenLog={openLog}
            recordingLock={room.recordingLock}
            showModePicker
          />
        </div>

        <div className={styles.reportCard}>
          <div className={styles.reportCardHead}>
            <div>
              <div className={styles.cardTitle}>保護者レポート生成</div>
              <div className={styles.cardSubtext}>対象のログを選ぶだけで、ワンタップで保護者レポートを生成します。</div>
            </div>
            <div className={styles.generatedMeta}>前回の生成：{formatReportDate(latestReport?.createdAt ?? null)}</div>
          </div>

          <div className={styles.reportSelectionHead}>
            <span>1月21日〜今日までのログから選択してください</span>
            <button type="button" className={styles.inlineTextButton} onClick={toggleSelectAll}>
              {allSelected ? "選択を外す" : "すべてを選択"}
            </button>
          </div>

          <div className={styles.reportSelectionList}>
            {reportSelectionSessions.length === 0 ? (
              <div className={styles.emptyCompact}>まだ選べるログがありません。面談や指導報告を録音するとここに並びます。</div>
            ) : (
              reportSelectionSessions.map((sessionItem) => {
                const checked = selectedSessionIds.includes(sessionItem.id);
                return (
                  <label key={sessionItem.id} className={styles.reportSelectionRow}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleReportSelection(sessionItem.id)}
                    />
                    <span className={`${styles.selectionIndicator} ${checked ? styles.selectionIndicatorActive : ""}`} aria-hidden />
                    <span className={styles.rowLabel}>{formatSessionLabel(sessionItem)}</span>
                  </label>
                );
              })
            )}
          </div>

          <div className={styles.reportActions}>
            <Button variant="secondary" onClick={() => openReportStudio("selection")} disabled={selectedSessionIds.length === 0}>
              保護者レポートを生成
            </Button>
            <span className={styles.selectionCount}>{selectedSessionIds.length}件選択中</span>
          </div>
        </div>
      </section>

      <section className={styles.workspaceSection}>
        <div className={styles.tabBar}>
          {[
            { key: "communications", label: "面談ログ" },
            { key: "lessonReports", label: "指導報告ログ" },
            { key: "parentReports", label: "保護者レポートログ" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`${styles.tabButton} ${activeTab === tab.key ? styles.tabButtonActive : ""}`}
              onClick={() => {
                setActiveTab(tab.key as TabKey);
                syncUrl({ tab: tab.key as TabKey });
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className={styles.filterRow}>
          <div className={styles.filterGroup}>
            <button
              type="button"
              className={`${styles.filterButton} ${periodFilter === "all" ? styles.filterButtonActive : ""}`}
              onClick={() => setPeriodFilter("all")}
            >
              すべて
            </button>
            <button
              type="button"
              className={`${styles.filterButton} ${periodFilter === "month" ? styles.filterButtonActive : ""}`}
              onClick={() => setPeriodFilter("month")}
            >
              今月
            </button>
          </div>
          <div className={styles.filterGroup}>
            <button
              type="button"
              className={`${styles.filterButton} ${sortOrder === "desc" ? styles.filterButtonActive : ""}`}
              onClick={() => setSortOrder("desc")}
            >
              新しい順
            </button>
            <button
              type="button"
              className={`${styles.filterButton} ${sortOrder === "asc" ? styles.filterButtonActive : ""}`}
              onClick={() => setSortOrder("asc")}
            >
              古い順
            </button>
          </div>
        </div>

        {activeTab === "communications" ? (
          <StudentSessionStream sessions={communicationSessions} assigneeName={session?.user?.name ?? undefined} onOpenLog={openLog} />
        ) : null}

        {activeTab === "lessonReports" ? (
          <div className={styles.historyList}>
            {lessonSessions.length === 0 ? (
              <div className={styles.emptyState}>まだ指導報告ログはありません。チェックインとチェックアウトがそろうとここに並びます。</div>
            ) : (
              lessonSessions.map((sessionItem) => (
                <button
                  key={sessionItem.id}
                  type="button"
                  className={styles.historyRow}
                  onClick={() => {
                    const logId = sessionItem.pipeline?.openLogId ?? sessionItem.conversation?.id;
                    if (logId) openLog(logId);
                  }}
                  disabled={!sessionItem.pipeline?.openLogId && !sessionItem.conversation?.id}
                >
                  <div className={styles.historyRowLeft}>
                    <div className={styles.historyIcon} aria-hidden>
                      <span />
                    </div>
                    <div>
                      <div className={styles.historyRowTitle}>{formatSessionLabel(sessionItem)}</div>
                      <div className={styles.historyRowMeta}>{lessonSummaryLabel(sessionItem)}</div>
                    </div>
                  </div>
                  <div className={styles.assigneePill}>{viewerBadge}</div>
                </button>
              ))
            )}
          </div>
        ) : null}

        {activeTab === "parentReports" ? (
          <div className={styles.historyList}>
            {parentReports.length === 0 ? (
              <div className={styles.emptyState}>まだ保護者レポートはありません。上段のカードから対象ログを選んで生成してください。</div>
            ) : (
              parentReports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  className={styles.historyRow}
                  onClick={() => openParentReport(report.id)}
                >
                  <div className={styles.historyRowLeft}>
                    <div className={styles.historyIcon} aria-hidden>
                      <span />
                    </div>
                    <div>
                      <div className={styles.historyRowTitle}>{formatReportDate(report.createdAt)} の保護者レポート</div>
                      <div className={styles.historyRowMeta}>{report.deliveryStateLabel ?? report.workflowStatusLabel ?? "状態確認中"}</div>
                    </div>
                  </div>
                  <div className={styles.assigneePill}>{viewerBadge}</div>
                </button>
              ))
            )}
          </div>
        ) : null}
      </section>

      {overlay.kind !== "none" ? (
        <div
          className={styles.overlayBackdrop}
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeOverlay();
          }}
        >
          <div className={styles.overlayPanel} role="dialog" aria-modal="true">
            <div className={styles.overlayHeader}>
              <div className={styles.overlayTitleBlock}>
                <div className={styles.overlayEyebrow}>
                  {overlay.kind === "log"
                    ? "ログ"
                    : overlay.kind === "report"
                      ? "保護者レポート"
                      : "保護者レポートログ"}
                </div>
                <h3 className={styles.overlayTitle}>
                  {overlay.kind === "log"
                    ? "ログを確認する"
                    : overlay.kind === "report"
                      ? "保護者レポートを確認する"
                      : "保護者レポートを確認する"}
                </h3>
              </div>
              <Button variant="secondary" onClick={closeOverlay}>
                閉じる
              </Button>
            </div>

            <div className={styles.overlayContent}>
              {overlay.kind === "log" ? <LogView logId={overlay.logId} showHeader={false} onBack={closeOverlay} /> : null}

              {overlay.kind === "report" ? (
                <ReportStudio
                  view={overlay.view}
                  studentId={room.student.id}
                  studentName={room.student.name}
                  sessions={room.sessions}
                  reports={room.reports}
                  selectedSessionIds={selectedSessionIds}
                  onSelectedSessionIdsChange={handleSelectedSessionIdsChange}
                  onRefresh={refresh}
                  onOpenLog={openLog}
                  onViewChange={(view) => setOverlay({ kind: "report", view })}
                />
              ) : null}

              {overlay.kind === "parentReport" && activeParentReport ? (
                <div className={styles.reportDetailStack}>
                  <div className={styles.detailMetaRow}>
                    <div>
                      <span>作成日</span>
                      <strong>{formatReportDate(activeParentReport.createdAt)}</strong>
                    </div>
                    <div>
                      <span>状態</span>
                      <strong>{activeParentReport.deliveryStateLabel ?? activeParentReport.workflowStatusLabel ?? "状態確認中"}</strong>
                    </div>
                    <div>
                      <span>参照ログ</span>
                      <strong>{activeParentReport.sourceLogIds?.length ?? 0}件</strong>
                    </div>
                  </div>

                  <div className={styles.reportParagraph}>
                    <StructuredMarkdown
                      markdown={activeParentReport.reportMarkdown}
                      emptyMessage="まだ保護者レポートは生成されていません。"
                    />
                  </div>

                  {activeParentReport.needsReview || activeParentReport.needsShare ? (
                    <div className={styles.detailActions}>
                      <Button onClick={() => openReportStudio("send")}>送付前確認へ進む</Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
