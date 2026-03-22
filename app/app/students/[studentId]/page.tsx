"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { LogDetailView } from "../../logs/LogDetailView";
import { ReportStudio } from "./ReportStudio";
import {
  StudentSessionConsole,
  type SessionConsoleLessonPart,
  type SessionConsoleMode,
} from "./StudentSessionConsole";
import { StudentSessionStream } from "./StudentSessionStream";
import type { ReportStudioView, RoomResponse, SessionItem, TopicCard } from "./roomTypes";
import styles from "./studentDetail.module.css";

type TabKey = "communications" | "lessonReports" | "parentReports";
type PeriodFilter = "all" | "month";
type SortOrder = "desc" | "asc";

type OverlayState =
  | { kind: "none" }
  | { kind: "proof"; logId: string }
  | { kind: "report"; view: ReportStudioView }
  | { kind: "lessonReport"; sessionId: string }
  | { kind: "parentReport"; reportId: string };

const FALLBACK_TOPICS = [
  {
    category: "学習",
    items: [
      { title: "直近の学習で手応えがあった単元を聞く" },
      { title: "今つまずいている問題の種類を確認する" },
    ],
  },
  {
    category: "生活",
    items: [
      { title: "今週の生活リズムで崩れた日を確認する" },
      { title: "勉強に入りやすかった時間帯を聞く" },
    ],
  },
  {
    category: "進路",
    items: [{ title: "次の模試で見たい指標を一つ決める" }],
  },
];

function normalizeTab(value: string | null): TabKey {
  if (value === "lessonReports") return "lessonReports";
  if (value === "parentReports") return "parentReports";
  return "communications";
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
  const types = session.parts.map((part) => part.partType);
  if (types.includes("CHECK_IN") && types.includes("CHECK_OUT")) return "チェックイン + チェックアウト";
  if (types.includes("CHECK_OUT")) return "チェックアウト";
  if (types.includes("CHECK_IN")) return "チェックイン";
  return "指導報告";
}

function groupTopics(topics?: TopicCard[] | null) {
  const grouped = new Map<string, TopicCard[]>();
  for (const topic of topics ?? []) {
    const current = grouped.get(topic.category) ?? [];
    current.push(topic);
    grouped.set(topic.category, current);
  }
  return Array.from(grouped.entries()).map(([category, items]) => ({
    category,
    items: items.slice(0, 2),
  }));
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
  const [recordingMode, setRecordingMode] = useState<SessionConsoleMode>("INTERVIEW");
  const [lessonPart, setLessonPart] = useState<SessionConsoleLessonPart>("CHECK_IN");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/students/${params.studentId}/room`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "生徒ルームの取得に失敗しました。");
      setRoom(body);
    } catch (nextError: any) {
      setError(nextError?.message ?? "生徒ルームの取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [params.studentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const syncUrl = useCallback(
    (changes: {
      tab?: TabKey | null;
      panel?: string | null;
      logId?: string | null;
      reportId?: string | null;
      lessonSessionId?: string | null;
      sessionIds?: string[] | null;
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

    if (panel === "proof" && logId) {
      setOverlay({ kind: "proof", logId });
      return;
    }
    if (panel === "report") {
      setOverlay({ kind: "report", view: room.reports.length > 0 && requestedIds.length === 0 ? "generated" : "selection" });
      return;
    }
    if (panel === "lessonReport" && lessonSessionId) {
      setOverlay({ kind: "lessonReport", sessionId: lessonSessionId });
      return;
    }
    if (panel === "parentReport" && reportId) {
      setOverlay({ kind: "parentReport", reportId });
      return;
    }
    setOverlay({ kind: "none" });
  }, [room, searchParams]);

  const candidateReportSessions = useMemo(
    () => (room?.sessions ?? []).filter((session) => session.conversation?.operationalLog),
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
    const base = (room?.sessions ?? []).filter((session) => session.type === "LESSON_REPORT" && session.conversation?.lessonReportJson);
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
  const topics = useMemo(() => {
    const grouped = groupTopics(latestConversation?.topicSuggestionsJson).slice(0, 3);
    return grouped.length > 0 ? grouped : FALLBACK_TOPICS;
  }, [latestConversation?.topicSuggestionsJson]);
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

  const openProof = useCallback(
    (logId: string) => {
      setOverlay({ kind: "proof", logId });
      syncUrl({ panel: "proof", logId, reportId: null, lessonSessionId: null });
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

  const openLessonReport = useCallback(
    (sessionId: string) => {
      setOverlay({ kind: "lessonReport", sessionId });
      syncUrl({ panel: "lessonReport", lessonSessionId: sessionId, logId: null, reportId: null, tab: "lessonReports" });
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

  const activeLessonReport =
    overlay.kind === "lessonReport"
      ? lessonSessions.find((session) => session.id === overlay.sessionId) ?? null
      : null;
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
            ongoingLessonSession={room.sessions.find((session) => session.type === "LESSON_REPORT" && session.status === "COLLECTING") ?? null}
            onModeChange={setRecordingMode}
            onLessonPartChange={setLessonPart}
            onRefresh={refresh}
            onOpenProof={openProof}
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

      <section className={styles.topicSection}>
        <div className={styles.sectionTitle}>おすすめの話題</div>
        <div className={styles.topicColumns}>
          {topics.map((group) => (
            <div key={group.category} className={styles.topicGroup}>
              <div className={styles.topicGroupLabel}>{group.category}</div>
              <div className={styles.topicTagList}>
                {group.items.map((item) => (
                  <button key={`${group.category}-${item.title}`} type="button" className={styles.topicTag}>
                    {item.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
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
          <StudentSessionStream sessions={communicationSessions} assigneeName={session?.user?.name ?? undefined} onOpenProof={openProof} />
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
                  onClick={() => openLessonReport(sessionItem.id)}
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
                  {overlay.kind === "proof"
                    ? "面談ログ"
                    : overlay.kind === "report"
                      ? "保護者レポート"
                      : overlay.kind === "lessonReport"
                        ? "指導報告ログ"
                        : "保護者レポートログ"}
                </div>
                <h3 className={styles.overlayTitle}>
                  {overlay.kind === "proof"
                    ? "会話ログの詳細"
                    : overlay.kind === "report"
                      ? "保護者レポートを確認する"
                      : overlay.kind === "lessonReport"
                        ? "指導報告書を確認する"
                        : "保護者レポートを確認する"}
                </h3>
              </div>
              <Button variant="secondary" onClick={closeOverlay}>
                閉じる
              </Button>
            </div>

            <div className={styles.overlayContent}>
              {overlay.kind === "proof" ? <LogDetailView logId={overlay.logId} showHeader={false} onBack={closeOverlay} /> : null}

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
                  onOpenProof={openProof}
                  onViewChange={(view) => setOverlay({ kind: "report", view })}
                />
              ) : null}

              {overlay.kind === "lessonReport" && activeLessonReport ? (
                <div className={styles.detailStack}>
                  <div className={styles.detailBlock}>
                    <div className={styles.detailLabel}>今日扱った内容</div>
                    <p>{activeLessonReport.conversation?.lessonReportJson?.goal ?? "まだ整理されていません。"}</p>
                  </div>
                  <div className={styles.detailBlock}>
                    <div className={styles.detailLabel}>今日見えた理解状態</div>
                    <ul>
                      {(activeLessonReport.conversation?.lessonReportJson?.did ?? ["まだ整理されていません。"]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className={styles.detailBlock}>
                    <div className={styles.detailLabel}>詰まった点 / 注意点</div>
                    <ul>
                      {(activeLessonReport.conversation?.lessonReportJson?.blocked ?? ["大きな詰まりは記録されていません。"]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className={styles.detailBlock}>
                    <div className={styles.detailLabel}>次回見るべき点</div>
                    <ul>
                      {(activeLessonReport.conversation?.lessonReportJson?.nextLessonFocus ?? ["次回確認事項はまだありません。"]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className={styles.detailBlock}>
                    <div className={styles.detailLabel}>宿題 / 確認事項</div>
                    <ul>
                      {(activeLessonReport.conversation?.lessonReportJson?.homework ?? ["宿題はまだ整理されていません。"]).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className={styles.detailBlock}>
                    <div className={styles.detailLabel}>講師間共有メモ</div>
                    <p>{activeLessonReport.conversation?.lessonReportJson?.coachMemo ?? "共有メモはありません。"}</p>
                  </div>
                  {activeLessonReport.conversation?.id ? (
                    <div className={styles.detailActions}>
                      <Button variant="secondary" onClick={() => openProof(activeLessonReport.conversation!.id)}>
                        根拠を見る
                      </Button>
                    </div>
                  ) : null}
                </div>
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

                  {activeParentReport.reportMarkdown
                    .split(/\n\s*\n/g)
                    .map((paragraph) => paragraph.replace(/\r/g, "").trim())
                    .filter(Boolean)
                    .map((paragraph, index) => (
                      <div key={`${activeParentReport.id}-${index}`} className={styles.reportParagraph}>
                        {paragraph.replace(/^#+\s*/gm, "")}
                      </div>
                    ))}

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
