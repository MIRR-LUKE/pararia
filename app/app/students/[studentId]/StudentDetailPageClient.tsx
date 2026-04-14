"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { pickLatestInterviewMemoSession } from "@/lib/next-meeting-memo";
import { StudentDetailActionQueue } from "./StudentDetailActionQueue";
import { formatReportDate, formatSessionLabel, formatUpdated, userBadge } from "./studentDetailFormatting";
import type { RoomResponse } from "./roomTypes";
import styles from "./studentDetail.module.css";
import type { StudentDetailPeriodFilter, StudentDetailSortOrder } from "./studentDetailState";
import { useStudentDetailOverlay } from "./useStudentDetailOverlay";
import { useStudentDetailRefresh } from "./useStudentDetailRefresh";
import { useStudentDetailUrlState } from "./useStudentDetailUrlState";
import { useStudentReportSelection } from "./useStudentReportSelection";

const LazyStudentDetailOverlay = dynamic(
  () => import("./StudentDetailOverlay").then((mod) => mod.StudentDetailOverlay),
  {
    loading: () => <div className={styles.overlayLoading}>詳細画面を準備しています...</div>,
  }
);
const LazyStudentSessionConsole = dynamic(
  () => import("./StudentSessionConsole").then((mod) => mod.StudentSessionConsole),
  {
    loading: () => <div className={styles.sectionLoading}>録音パネルを準備しています...</div>,
  }
);
const LazyStudentDetailWorkspace = dynamic(
  () => import("./StudentDetailWorkspace").then((mod) => mod.StudentDetailWorkspace),
  {
    loading: () => <div className={styles.sectionLoading}>履歴を準備しています...</div>,
  }
);

type StudentDetailPageClientProps = {
  params: { studentId: string };
  initialRoom: RoomResponse;
  viewerName?: string | null;
};

export default function StudentDetailPageClient({
  params,
  initialRoom,
  viewerName,
}: StudentDetailPageClientProps) {
  const { room, loading, error, refresh } = useStudentDetailRefresh({
    initialRoom,
    studentId: params.studentId,
  });
  const { queryParams, activeTab, setActiveTab, recordingMode, setRecordingMode, lessonPart, setLessonPart, syncUrl } =
    useStudentDetailUrlState(`/app/students/${params.studentId}`);
  const {
    selectedSessionIds,
    reportSelectionSessions,
    allSelected,
    handleSelectedSessionIdsChange,
    toggleReportSelection,
    toggleSelectAll,
  } = useStudentReportSelection({
    sessions: room?.sessions ?? [],
    queryParams,
    syncUrl,
  });
  const {
    overlay,
    parentReportLoadingId,
    parentReportError,
    activeParentReport,
    logHasUnsavedChanges,
    onDirtyChange,
    openLog,
    openReportStudio,
    openTranscriptReview,
    openParentReport,
    openReportStudioSend,
    requestOverlayClose,
    onReportViewChange,
    onRetryParentReport,
    openDeleteDialogForLog,
    openDeleteDialogForReport,
    deleteTarget,
    isDeletingTarget,
    deleteSelectedTarget,
    clearDeleteTarget,
  } = useStudentDetailOverlay({
    room,
    queryParams,
    selectedSessionIds,
    syncUrl,
    refresh,
  });
  const [periodFilter, setPeriodFilter] = useState<StudentDetailPeriodFilter>("all");
  const [sortOrder, setSortOrder] = useState<StudentDetailSortOrder>("desc");
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);

  const latestConversation = room?.latestConversation ?? null;
  const latestReport = room?.reports[0] ?? null;
  const latestInterviewMemoSession = useMemo(
    () => pickLatestInterviewMemoSession(room?.sessions ?? []),
    [room?.sessions]
  );
  const interviewSessionCount = useMemo(
    () => (room?.sessions ?? []).filter((session) => session.type === "INTERVIEW").length,
    [room?.sessions]
  );
  const latestNextMeetingMemo = latestInterviewMemoSession?.nextMeetingMemo ?? null;
  const viewerBadge = userBadge(viewerName ?? null);

  const nextMeetingMemoStatus = latestNextMeetingMemo?.status ?? null;
  const nextMeetingMemoPreviousSummary =
    nextMeetingMemoStatus === "READY"
      ? latestNextMeetingMemo?.previousSummary?.trim() || "生成結果をまだ保存できていません。"
      : nextMeetingMemoStatus === "FAILED"
        ? "作成できませんでした。"
        : nextMeetingMemoStatus === "GENERATING" || nextMeetingMemoStatus === "QUEUED"
          ? "生成中…"
          : "面談ログが完成するとここに表示されます。";
  const nextMeetingMemoSuggestedTopics =
    nextMeetingMemoStatus === "READY"
      ? latestNextMeetingMemo?.suggestedTopics?.trim() || "生成結果をまだ保存できていません。"
      : nextMeetingMemoStatus === "FAILED"
        ? "前回の面談ログが整いしだい、ここに表示されます。"
        : nextMeetingMemoStatus === "GENERATING" || nextMeetingMemoStatus === "QUEUED"
          ? "面談ログをもとに作っています…"
          : "前回の面談ログを作ると、次に何を話すかまで短くまとまります。";
  const nextMeetingMemoError =
    nextMeetingMemoStatus === "FAILED" ? latestNextMeetingMemo?.errorMessage?.trim() || "次回の面談メモの作成に失敗しました。" : null;
  const roomScope = room?.meta?.scope ?? null;
  const openConsole = () => {
    setIsConsoleOpen(true);
    void refresh({ silent: true });
  };
  const openWorkspace = () => {
    setIsWorkspaceOpen(true);
    void refresh({ silent: true });
  };

  useEffect(() => {
    if (roomScope !== "summary") return;
    if (!isConsoleOpen && !isWorkspaceOpen) return;
    void refresh({ silent: true });
  }, [isConsoleOpen, isWorkspaceOpen, refresh, roomScope]);

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

      <StudentDetailActionQueue
        sessions={room.sessions}
        reports={room.reports}
        onOpenLog={openLog}
        onOpenTranscriptReview={openTranscriptReview}
        onOpenParentReport={openParentReport}
        onOpenReportStudioSend={openReportStudioSend}
      />

      <section className={styles.topGrid}>
        <div className={styles.recordCard}>
          {isConsoleOpen ? (
            <LazyStudentSessionConsole
              studentId={room.student.id}
              studentName={room.student.name}
              mode={recordingMode}
              lessonPart={lessonPart}
              ongoingLessonSession={null}
              onModeChange={setRecordingMode}
              onLessonPartChange={setLessonPart}
              onRefresh={refresh}
              onOpenLog={openLog}
              recordingLock={room.recordingLock}
              showModePicker={false}
            />
          ) : (
            <div className={styles.sectionGate}>
              <div className={styles.sectionGateHead}>
                <div>
                  <div className={styles.cardTitle}>録音パネル</div>
                  <div className={styles.cardSubtext}>
                    初回は要点だけ見せて、録音や保存を開く時だけ重いパネルを読み込みます。
                  </div>
                </div>
              </div>
              <div className={styles.sectionGateBody}>
                <div className={styles.sectionGateStat}>
                  <strong>{interviewSessionCount}件</strong>
                  <span>最近の面談ログ</span>
                </div>
                <div className={styles.sectionGateStat}>
                  <strong>{room.reports.length}件</strong>
                  <span>保護者レポート</span>
                </div>
              </div>
              <div className={styles.sectionGateActions}>
                <Button variant="secondary" onClick={openConsole}>
                  録音パネルを開く
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.memoCard}>
          <div className={styles.memoCardHead}>
            <div>
              <div className={styles.cardTitle}>次回の面談メモ</div>
              <div className={styles.cardSubtext}>
                {latestInterviewMemoSession
                  ? `${formatSessionLabel(latestInterviewMemoSession)}をもとに、次にすぐ見返せる内容だけを置きます。`
                  : "面談ログが完成すると、ここに次回の面談メモが表示されます。"}
              </div>
            </div>
            <div className={styles.generatedMeta}>
              {latestNextMeetingMemo?.updatedAt ? `更新：${formatUpdated(latestNextMeetingMemo.updatedAt)}` : "未生成"}
            </div>
          </div>

          <>
            <div className={styles.memoBody}>
              <div className={styles.memoSection}>
                <div className={styles.memoSectionTitle}>前回の面談まとめ</div>
                <p
                  className={`${styles.memoParagraph} ${
                    nextMeetingMemoStatus === "READY" ? "" : styles.memoParagraphMuted
                  }`}
                >
                  {nextMeetingMemoPreviousSummary}
                </p>
              </div>

              <div className={styles.memoSection}>
                <div className={styles.memoSectionTitle}>おすすめの話題</div>
                <p
                  className={`${styles.memoParagraph} ${
                    nextMeetingMemoStatus === "READY" ? "" : styles.memoParagraphMuted
                  }`}
                >
                  {nextMeetingMemoSuggestedTopics}
                </p>
              </div>
            </div>

            {nextMeetingMemoError ? <div className={styles.memoError}>{nextMeetingMemoError}</div> : null}
          </>
        </div>

        <div className={styles.reportCard}>
          <div className={styles.reportCardHead}>
            <div>
              <div className={styles.cardTitle}>保護者レポート生成</div>
              <div className={styles.cardSubtext}>対象のログを選ぶだけで、ワンタップで保護者レポートを生成します。</div>
            </div>
            <div className={styles.generatedMeta}>
              前回の生成：{latestReport?.createdAt ? formatReportDate(latestReport.createdAt) : "未生成"}
            </div>
          </div>

          <>
            <div className={styles.reportSelectionHead}>
              <span>1月21日〜今日までのログから選択してください</span>
              <button type="button" className={styles.inlineTextButton} onClick={toggleSelectAll}>
                {allSelected ? "選択を外す" : "すべてを選択"}
              </button>
            </div>

            <div className={styles.reportSelectionList}>
              {reportSelectionSessions.length === 0 ? (
                <div className={styles.emptyCompact}>まだ選べる面談ログがありません。面談を録音するとここに並びます。</div>
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
              <Button variant="secondary" onClick={() => void openReportStudio("selection")} disabled={selectedSessionIds.length === 0}>
                保護者レポートを生成
              </Button>
              <span className={styles.selectionCount}>{selectedSessionIds.length}件選択中</span>
            </div>
          </>
        </div>
      </section>

      <section className={styles.workspaceSection}>
        {isWorkspaceOpen ? (
          <LazyStudentDetailWorkspace
            sessions={room.sessions}
            reports={room.reports}
            activeTab={activeTab}
            periodFilter={periodFilter}
            sortOrder={sortOrder}
            viewerBadge={viewerBadge}
            viewerName={viewerName ?? null}
            onActiveTabChange={setActiveTab}
            onPeriodFilterChange={setPeriodFilter}
            onSortOrderChange={setSortOrder}
            onOpenLog={openLog}
            onOpenParentReport={openParentReport}
          />
        ) : (
          <div className={styles.sectionGate}>
            <div className={styles.sectionGateHead}>
              <div>
                <div className={styles.cardTitle}>履歴とレポート</div>
                <div className={styles.cardSubtext}>
                  面談ログと保護者レポートの深い一覧は、必要な時だけ読み込みます。
                </div>
              </div>
            </div>
            <div className={styles.sectionGateBody}>
              <div className={styles.sectionGateStat}>
                <strong>{interviewSessionCount}</strong>
                <span>面談ログ</span>
              </div>
              <div className={styles.sectionGateStat}>
                <strong>{room.reports.length}</strong>
                <span>保護者レポート</span>
              </div>
            </div>
            <div className={styles.sectionGateActions}>
              <Button variant="secondary" onClick={openWorkspace}>
                履歴を開く
              </Button>
            </div>
          </div>
        )}
      </section>

      {overlay.kind !== "none" ? (
        <LazyStudentDetailOverlay
          overlay={overlay}
          room={room}
          activeParentReport={activeParentReport}
          parentReportLoadingId={parentReportLoadingId}
          parentReportError={parentReportError}
          selectedSessionIds={selectedSessionIds}
          onSelectedSessionIdsChange={handleSelectedSessionIdsChange}
          onRequestClose={requestOverlayClose}
          onRefresh={refresh}
          onDirtyChange={onDirtyChange}
          onOpenLog={openLog}
          onReportViewChange={onReportViewChange}
          onRetryParentReport={onRetryParentReport}
          onOpenDeleteDialogForLog={openDeleteDialogForLog}
          onOpenDeleteDialogForReport={openDeleteDialogForReport}
          onOpenReportStudioSend={openReportStudioSend}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `${deleteTarget.label}を削除しますか？` : ""}
        description={deleteTarget?.detail ?? ""}
        details={[
          "この操作は取り消せません。",
          "削除後は一覧と関連導線から即時に消えます。",
        ]}
        confirmLabel="削除する"
        cancelLabel="戻る"
        tone="danger"
        pending={isDeletingTarget}
        onConfirm={() => void deleteSelectedTarget()}
        onCancel={() => {
          if (isDeletingTarget) return;
          clearDeleteTarget();
        }}
      />
    </div>
  );
}
