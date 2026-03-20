"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LogDetailView } from "../../logs/LogDetailView";
import { ReportStudio } from "./ReportStudio";
import { StudentQueueDock } from "./StudentQueueDock";
import {
  StudentSessionConsole,
  type SessionConsoleLessonPart,
  type SessionConsoleMode,
} from "./StudentSessionConsole";
import { StudentSessionStream } from "./StudentSessionStream";
import type { ProfileSection, RoomResponse, SessionItem, WorkbenchPanel } from "./roomTypes";
import styles from "./studentDetail.module.css";

type TabKey = "profile" | "communications" | "lessonReports" | "parentReports";

type OverlayState =
  | { kind: "none" }
  | { kind: "recording" }
  | { kind: "proof"; logId: string }
  | {
      kind: "reportBuilder";
      phase: Extract<WorkbenchPanel, "report_selection" | "report_generated" | "send_ready">;
    }
  | { kind: "lessonReport"; sessionId: string }
  | { kind: "parentReport"; reportId: string };

function calcCompleteness(profileData?: any) {
  const basic = Array.isArray(profileData?.basic) ? profileData.basic.length : 0;
  const personal = Array.isArray(profileData?.personal) ? profileData.personal.length : 0;
  return Math.min(100, (basic + personal) * 6);
}

function normalizeMode(value: string | null): SessionConsoleMode {
  return value === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW";
}

function normalizeLessonPart(value: string | null): SessionConsoleLessonPart {
  return value === "CHECK_OUT" ? "CHECK_OUT" : "CHECK_IN";
}

function normalizeTab(value: string | null): TabKey {
  if (value === "communications") return "communications";
  if (value === "lessonReports") return "lessonReports";
  if (value === "parentReports") return "parentReports";
  return "profile";
}

function reportStatusLabel(status?: string | null) {
  if (!status) return "未生成";
  if (status === "DRAFT") return "下書き";
  if (status === "REVIEWED") return "確認済み";
  if (status === "SENT") return "送付済み";
  return status;
}

function formatDateLabel(date: string) {
  return new Date(date).toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function splitParagraphs(markdown?: string | null) {
  if (!markdown) return [];
  return markdown
    .split(/\n\s*\n/g)
    .map((block) => block.replace(/\r/g, "").trim())
    .filter(Boolean);
}

function fallbackProfileSections(sections: ProfileSection[] | null | undefined): ProfileSection[] {
  if (sections && sections.length > 0) return sections.slice(0, 4);
  return [
    { category: "学習", status: "未確認", nextQuestion: "今の学習の進み方で気になっていることを聞く。", highlights: [] },
    { category: "学校", status: "未確認", nextQuestion: "学校課題と受験勉強のバランスを確認する。", highlights: [] },
    { category: "生活", status: "未確認", nextQuestion: "生活リズムと集中しやすい時間帯を確認する。", highlights: [] },
    { category: "進路", status: "未確認", nextQuestion: "仮でもよいので志望校や方向性を聞く。", highlights: [] },
  ];
}

function interviewStatusLabel(session?: SessionItem | null) {
  if (!session) return "未実施";
  if (session.status === "PROCESSING") return "生成中";
  return "実施済み";
}

function lessonStatusLabel(session?: SessionItem | null) {
  if (!session) return "未実施";
  if (session.status === "COLLECTING") return "授業後待ち";
  if (session.status === "PROCESSING") return "生成中";
  return "完了";
}

function processingSteps(session: SessionItem) {
  const steps = [
    "アップロード完了",
    "文字起こし中",
    "内容整理中",
    "entity 抽出中",
    "会話ログ要約作成中",
    "プロフィール更新案作成中",
  ];
  if (session.type === "LESSON_REPORT") steps.push("指導報告書作成中");
  steps.push("確認待ち");
  return steps;
}

export default function StudentDetailPage({ params }: { params: { studentId: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>(normalizeTab(searchParams.get("tab")));
  const [overlay, setOverlay] = useState<OverlayState>({ kind: "none" });
  const [recordingMode, setRecordingMode] = useState<SessionConsoleMode>(normalizeMode(searchParams.get("mode")));
  const [lessonPart, setLessonPart] = useState<SessionConsoleLessonPart>(normalizeLessonPart(searchParams.get("part")));

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/students/${params.studentId}/room`, { cache: "no-store" });
      const body = await res.json();
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
      nextParams.delete("mode");
      nextParams.delete("part");

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

    const validSessionIds = new Set(room.sessions.map((session) => session.id));
    const requestedSessionIds = (searchParams.get("sessionIds") ?? "")
      .split(",")
      .filter(Boolean)
      .filter((id) => validSessionIds.has(id));

    setSelectedSessionIds(requestedSessionIds);
    setActiveTab(normalizeTab(searchParams.get("tab")));

    const panel = searchParams.get("panel");
    const logId = searchParams.get("logId");
    const reportId = searchParams.get("reportId");
    const lessonSessionId = searchParams.get("lessonSessionId");

    if (panel === "recording") {
      setOverlay({ kind: "recording" });
      return;
    }
    if (panel === "proof" && logId) {
      setOverlay({ kind: "proof", logId });
      return;
    }
    if (panel === "report") {
      setOverlay({
        kind: "reportBuilder",
        phase:
          requestedSessionIds.length > 0
            ? "report_selection"
            : room.reports[0] && room.reports[0].status !== "SENT"
              ? "report_generated"
              : "report_selection",
      });
      return;
    }
    if (panel === "send") {
      setOverlay({ kind: "reportBuilder", phase: "send_ready" });
      return;
    }
    if (panel === "lesson-report" && lessonSessionId) {
      setOverlay({ kind: "lessonReport", sessionId: lessonSessionId });
      return;
    }
    if (panel === "parent-report" && reportId) {
      setOverlay({ kind: "parentReport", reportId });
      return;
    }

    setOverlay({ kind: "none" });
  }, [room, searchParams]);

  const latestConversation = room?.latestConversation ?? null;
  const latestInterviewSession = room?.sessions.find((session) => session.type === "INTERVIEW") ?? null;
  const latestLessonSession = room?.sessions.find((session) => session.type === "LESSON_REPORT") ?? null;
  const latestReport = room?.reports[0] ?? null;
  const profileSections = fallbackProfileSections(latestConversation?.profileSectionsJson);
  const topicCards = latestConversation?.topicSuggestionsJson?.slice(0, 3) ?? [];
  const completeness = calcCompleteness(room?.latestProfile?.profileData);
  const pendingEntityCount = useMemo(
    () => room?.sessions.reduce((acc, session) => acc + (session.pendingEntityCount ?? 0), 0) ?? 0,
    [room?.sessions]
  );
  const processingSessions = useMemo(
    () => room?.sessions.filter((session) => session.status === "PROCESSING" || session.status === "COLLECTING") ?? [],
    [room?.sessions]
  );
  const processingCount = processingSessions.length;
  const lessonReportSessions = useMemo(
    () => room?.sessions.filter((session) => session.type === "LESSON_REPORT" && session.conversation?.lessonReportJson) ?? [],
    [room?.sessions]
  );
  const firstInitial = room?.student.name?.slice(0, 1) ?? "生";

  const recordingLockBanner =
    room?.recordingLock?.active && room.recordingLock.lock && !room.recordingLock.lock.isHeldByViewer
      ? {
          holder: room.recordingLock.lock.lockedByName,
          modeJa: room.recordingLock.lock.mode === "LESSON_REPORT" ? "指導報告" : "面談",
        }
      : null;

  const userRole = (session?.user as { role?: string } | undefined)?.role;
  const canForceRecordingLock = userRole === "ADMIN" || userRole === "MANAGER";

  const updateSelectedSessions = useCallback(
    (ids: string[]) => {
      setSelectedSessionIds(ids);
      syncUrl({ sessionIds: ids });
    },
    [syncUrl]
  );

  const openRecording = useCallback(() => {
    setOverlay({ kind: "recording" });
    syncUrl({ panel: "recording", logId: null, reportId: null, lessonSessionId: null });
  }, [syncUrl]);

  const openProof = useCallback(
    (logId: string) => {
      setOverlay({ kind: "proof", logId });
      syncUrl({ panel: "proof", logId, reportId: null, lessonSessionId: null });
    },
    [syncUrl]
  );

  const openReportBuilder = useCallback(
    (phase: Extract<WorkbenchPanel, "report_selection" | "report_generated" | "send_ready"> = "report_selection") => {
      setOverlay({ kind: "reportBuilder", phase });
      syncUrl({ panel: phase === "send_ready" ? "send" : "report", logId: null, reportId: null, lessonSessionId: null });
    },
    [syncUrl]
  );

  const openLessonReport = useCallback(
    (sessionId: string) => {
      setOverlay({ kind: "lessonReport", sessionId });
      syncUrl({ panel: "lesson-report", lessonSessionId: sessionId, logId: null, reportId: null });
    },
    [syncUrl]
  );

  const openParentReport = useCallback(
    (reportId: string) => {
      setOverlay({ kind: "parentReport", reportId });
      syncUrl({ panel: "parent-report", reportId, logId: null, lessonSessionId: null });
    },
    [syncUrl]
  );

  const closeOverlay = useCallback(() => {
    setOverlay({ kind: "none" });
    syncUrl({ panel: null, logId: null, reportId: null, lessonSessionId: null });
  }, [syncUrl]);

  const recordButtonLabel = recordingMode === "INTERVIEW" ? "面談を始める" : lessonPart === "CHECK_OUT" ? "チェックアウトを始める" : "チェックインを始める";
  const recommendedAction = useMemo(() => {
    if (processingCount > 0) {
      return {
        label: "生成結果を確認",
        description: `${processingCount} 件の処理が進行中です。完了したら、そのまま要点と根拠を確認できます。`,
        onClick: () => {
          const target = processingSessions.find((session) => session.conversation?.id)?.conversation?.id;
          if (target) openProof(target);
        },
      };
    }

    if (selectedSessionIds.length > 0) {
      return {
        label: "保護者レポートを生成",
        description: `選択中の ${selectedSessionIds.length} 件を材料に、今月の保護者レポートを束ねます。`,
        onClick: () => openReportBuilder("report_selection"),
      };
    }

    if (latestReport && latestReport.status !== "SENT") {
      return {
        label: "送付前確認",
        description: "下書き済みの保護者レポートがあります。根拠と固有名詞を確認してから送付します。",
        onClick: () => openReportBuilder("send_ready"),
      };
    }

    if (latestLessonSession?.status === "COLLECTING") {
      return {
        label: "チェックアウトを始める",
        description: "授業前だけ保存されています。授業後の記録を入れると指導報告が完成します。",
        onClick: () => {
          setRecordingMode("LESSON_REPORT");
          setLessonPart("CHECK_OUT");
          openRecording();
        },
      };
    }

    if (!latestConversation) {
      return {
        label: "面談を始める",
        description: "まだ会話ログがありません。最初の面談から生徒理解を積み上げます。",
        onClick: () => {
          setRecordingMode("INTERVIEW");
          openRecording();
        },
      };
    }

    return {
      label: "根拠を確認",
      description: "最新ログの要点と見立てを確認し、次の面談や授業につなげます。",
      onClick: () => openProof(latestConversation.id),
    };
  }, [
    latestConversation,
    latestLessonSession?.status,
    latestReport,
    openProof,
    openRecording,
    openReportBuilder,
    processingCount,
    processingSessions,
    selectedSessionIds.length,
  ]);

  const activeLessonReportSession =
    overlay.kind === "lessonReport"
      ? lessonReportSessions.find((session) => session.id === overlay.sessionId) ?? null
      : null;
  const activeParentReport =
    overlay.kind === "parentReport"
      ? room?.reports.find((report) => report.id === overlay.reportId) ?? null
      : null;

  if (loading) {
    return (
      <div className={styles.page}>
        <AppHeader title="読み込み中..." subtitle="生徒ルームを準備しています。" />
        <div className={styles.skeletonHero} />
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className={styles.page}>
        <AppHeader title="生徒詳細" subtitle="生徒ルームの読み込みに失敗しました。" />
        <Card>
          <div className={styles.emptyState}>
            <strong>{error ?? "生徒ルームを表示できませんでした。"}</strong>
            <Button onClick={() => void refresh()}>再読み込み</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <AppHeader
        title={room.student.name}
        subtitle="上段で全体像を掴み、下段のタブで落ち着いて進めます。録音も確認もこのページの中で完結します。"
        actions={
          <div className={styles.headerTools}>
            <div className={styles.headerModeSwitch} role="tablist" aria-label="録音モードの切り替え">
              <button
                type="button"
                className={`${styles.headerModeButton} ${recordingMode === "INTERVIEW" ? styles.headerModeButtonActive : ""}`}
                onClick={() => setRecordingMode("INTERVIEW")}
              >
                面談
              </button>
              <button
                type="button"
                className={`${styles.headerModeButton} ${recordingMode === "LESSON_REPORT" ? styles.headerModeButtonActive : ""}`}
                onClick={() => setRecordingMode("LESSON_REPORT")}
              >
                指導報告
              </button>
            </div>

            {recordingMode === "LESSON_REPORT" ? (
              <div className={styles.headerSubSwitch} role="tablist" aria-label="指導報告の種類">
                <button
                  type="button"
                  className={`${styles.headerSubButton} ${lessonPart === "CHECK_IN" ? styles.headerSubButtonActive : ""}`}
                  onClick={() => setLessonPart("CHECK_IN")}
                >
                  チェックイン
                </button>
                <button
                  type="button"
                  className={`${styles.headerSubButton} ${lessonPart === "CHECK_OUT" ? styles.headerSubButtonActive : ""}`}
                  onClick={() => setLessonPart("CHECK_OUT")}
                >
                  チェックアウト
                </button>
              </div>
            ) : null}

            <Button className={styles.headerRecordButton} onClick={openRecording}>
              {recordButtonLabel}
            </Button>
          </div>
        }
      />

      {recordingLockBanner ? (
        <div
          role="status"
          style={{
            margin: "0 0 1rem",
            padding: "0.75rem 1rem",
            borderRadius: 12,
            background: "rgba(251, 191, 36, 0.15)",
            border: "1px solid rgba(217, 119, 6, 0.35)",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>
            <strong>{recordingLockBanner.holder}</strong> さんが{recordingLockBanner.modeJa}
            モードで録音中です。閲覧はできますが、新しい録音は開始できません。
          </span>
          {canForceRecordingLock ? (
            <Button
              size="small"
              variant="secondary"
              onClick={async () => {
                await fetch(`/api/students/${params.studentId}/recording-lock`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ forceRelease: true, reason: "UI から強制解除" }),
                });
                void refresh();
              }}
            >
              ロックを強制解除（管理者）
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className={styles.summaryBlock}>
        <div className={styles.summaryHeader}>
          <div className={styles.studentIdentity}>
            <div className={styles.avatar}>{firstInitial}</div>
            <div className={styles.identityText}>
              <div className={styles.identityMeta}>{room.student.grade ?? "学年未設定"}</div>
              <h2 className={styles.studentName}>{room.student.name}</h2>
              <p className={styles.oneLiner}>{latestConversation?.studentStateJson?.oneLiner ?? "まだ十分な会話ログがないため、次の面談で状態を掴みます。"}</p>
            </div>
          </div>

          <div className={styles.statusBadges}>
            {latestConversation?.studentStateJson?.label ? <Badge label={latestConversation.studentStateJson.label} tone="medium" /> : null}
            <Badge label={`今週の面談 ${interviewStatusLabel(latestInterviewSession)}`} tone={latestInterviewSession ? "low" : "medium"} />
            <Badge label={`コミュニケーション ${lessonStatusLabel(latestLessonSession)}`} tone={latestLessonSession?.status === "COLLECTING" ? "medium" : "neutral"} />
            {pendingEntityCount > 0 ? <Badge label={`未確認 entity ${pendingEntityCount} 件`} tone="high" /> : null}
            {processingCount > 0 ? <Badge label={`進行中 ${processingCount} 件`} tone="medium" /> : null}
          </div>
        </div>
        <div className={styles.summaryGrid}>
          <Card title="次に押すボタン" subtitle="ここだけ見れば、いま何をすべきかが分かるようにします。">
            <div className={styles.primaryCard}>
              <div>
                <div className={styles.primaryLabel}>おすすめの次アクション</div>
                <h3 className={styles.primaryTitle}>{recommendedAction.label}</h3>
                <p className={styles.primaryDescription}>{recommendedAction.description}</p>
              </div>
              <Button onClick={recommendedAction.onClick}>{recommendedAction.label}</Button>
            </div>

            {processingCount > 0 && processingSessions[0] ? (
              <div className={styles.progressCard}>
                <div className={styles.progressTitle}>生成進行</div>
                <div className={styles.progressSteps}>
                  {processingSteps(processingSessions[0]).map((step) => (
                    <span key={step} className={styles.progressStep}>{step}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <Card title="今の全体像" subtitle="状態とコミュニケーションの流れだけを静かにまとめて見せます。">
            <div className={styles.metaGrid}>
              <div className={styles.metaCard}>
                <span className={styles.metaLabel}>プロフィール充足</span>
                <strong>{completeness}%</strong>
                <p>会話を重ねるほど、生徒理解が 4 カテゴリに蓄積されます。</p>
              </div>
              <div className={styles.metaCard}>
                <span className={styles.metaLabel}>今月の保護者レポート</span>
                <strong>{reportStatusLabel(latestReport?.status ?? null)}</strong>
                <p>{latestReport ? `最終更新: ${formatDateLabel(latestReport.createdAt)}` : "まだレポートはありません。"}</p>
              </div>
            </div>
          </Card>

          <Card title="おすすめの話題" subtitle="上から読めば、そのまま次の会話に使える順で置きます。">
            <div className={styles.topicList}>
              {topicCards.length === 0 ? (
                <p className={styles.emptyText}>次の話題は次回の会話から育てます。</p>
              ) : (
                topicCards.map((topic) => (
                  <div key={`${topic.category}-${topic.title}`} className={styles.topicCard}>
                    <div className={styles.topicHead}>
                      <strong>{topic.title}</strong>
                      <Badge label={topic.category} tone="neutral" />
                    </div>
                    <p>{topic.question}</p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <StudentQueueDock
          sessions={room.sessions}
          reports={room.reports}
          onOpenProof={openProof}
          onOpenReport={() => openReportBuilder("send_ready")}
          onOpenRecording={(mode, part = "CHECK_IN") => {
            setRecordingMode(mode);
            setLessonPart(part);
            openRecording();
          }}
        />
      </section>

      <section className={styles.workspace}>
        <div className={styles.tabBar} role="tablist" aria-label="生徒ルームのタブ">
          {[
            { key: "profile", label: "プロフィール" },
            { key: "communications", label: "コミュニケーション履歴" },
            { key: "lessonReports", label: "指導報告書履歴" },
            { key: "parentReports", label: "保護者レポート履歴" },
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

        <div className={styles.tabPanel}>
          {activeTab === "profile" ? (
            <div className={styles.profileGrid}>
              {profileSections.map((section) => (
                <Card
                  key={section.category}
                  title={section.category}
                  subtitle="固定カテゴリで、現在の状態と次に確認することを読みます。"
                  action={<Badge label={section.status} tone="neutral" />}
                >
                  <div className={styles.profileSectionBody}>
                    <div>
                      <div className={styles.sectionLabel}>現在の状態</div>
                      <p>{section.highlights[0]?.value ?? "まだ十分な会話ログがなく、次回の会話で厚みを付けます。"}</p>
                    </div>
                    <div>
                      <div className={styles.sectionLabel}>今回の更新</div>
                      <div className={styles.inlineList}>
                        {(section.highlights.length > 0 ? section.highlights : [{ label: "更新", value: "今回の会話で大きな更新はありません。" }]).map((item) => (
                          <div key={`${section.category}-${item.label}-${item.value}`} className={styles.highlightChip}>
                            <span>{item.label}</span>
                            <strong>{item.value}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className={styles.sectionLabel}>次に確認すること</div>
                      <p>{section.nextQuestion}</p>
                    </div>
                    <div className={styles.profileFooter}>
                      <Button size="small" variant="secondary" onClick={() => latestConversation?.id && openProof(latestConversation.id)} disabled={!latestConversation?.id}>
                        根拠ログを見る
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : null}

          {activeTab === "communications" ? (
            <StudentSessionStream
              sessions={room.sessions}
              selectedSessionIds={selectedSessionIds}
              onSelectedSessionIdsChange={updateSelectedSessions}
              onOpenProof={openProof}
              onOpenReportBuilder={() => openReportBuilder("report_selection")}
            />
          ) : null}

          {activeTab === "lessonReports" ? (
            <div className={styles.historyList}>
              {lessonReportSessions.length === 0 ? (
                <Card title="指導報告書履歴" subtitle="授業前後の記録が揃うと、ここに時系列で並びます。">
                  <div className={styles.emptyStateCompact}>まだ指導報告書はありません。</div>
                </Card>
              ) : (
                lessonReportSessions.map((session) => (
                  <Card key={session.id} title={formatDateLabel(session.sessionDate)} subtitle={`指導報告 / ${lessonStatusLabel(session)}`} action={<Badge label={`${session.pendingEntityCount} 件`} tone={session.pendingEntityCount > 0 ? "high" : "neutral"} />}>
                    <div className={styles.historyCardBody}>
                      <p>{session.conversation?.operationalLog?.theme ?? "授業テーマは生成後に表示されます。"}</p>
                      <div className={styles.inlineActionsWrap}>
                        <Button size="small" onClick={() => openLessonReport(session.id)}>開く</Button>
                        <Button size="small" variant="secondary" onClick={() => session.conversation?.id && openProof(session.conversation.id)} disabled={!session.conversation?.id}>根拠を見る</Button>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          ) : null}
          {activeTab === "parentReports" ? (
            <div className={styles.historyList}>
              {room.reports.length === 0 ? (
                <Card title="保護者レポート履歴" subtitle="コミュニケーション履歴から素材を選ぶと、ここにレポートが並びます。">
                  <div className={styles.emptyStateCompact}>まだ保護者レポートはありません。</div>
                </Card>
              ) : (
                room.reports.map((report) => (
                  <Card key={report.id} title={formatDateLabel(report.createdAt)} subtitle={report.qualityChecksJson?.bundleQualityEval?.periodLabel ?? "対象期間は未設定"} action={<Badge label={reportStatusLabel(report.status)} tone={report.status === "SENT" ? "low" : "medium"} />}>
                    <div className={styles.historyCardBody}>
                      <p>参照ログ {report.qualityChecksJson?.bundleQualityEval?.logCount ?? 0} 件 / 未確認 entity {report.qualityChecksJson?.pendingEntityCount ?? 0} 件</p>
                      <div className={styles.inlineActionsWrap}>
                        <Button size="small" onClick={() => openParentReport(report.id)}>開く</Button>
                        {report.status !== "SENT" ? (
                          <Button size="small" variant="secondary" onClick={() => openReportBuilder("send_ready")}>送付前確認</Button>
                        ) : null}
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          ) : null}
        </div>
      </section>

      {overlay.kind !== "none" ? (
        <div className={styles.overlayBackdrop} onClick={closeOverlay}>
          <div className={styles.overlayPanel} onClick={(event) => event.stopPropagation()}>
            <div className={styles.overlayHeader}>
              <div>
                <div className={styles.overlayEyebrow}>生徒ルーム内操作</div>
                <h3 className={styles.overlayTitle}>
                  {overlay.kind === "recording" ? "録音を始める" : overlay.kind === "proof" ? "ログ詳細" : overlay.kind === "reportBuilder" ? "保護者レポート" : overlay.kind === "lessonReport" ? "指導報告書" : "保護者レポート詳細"}
                </h3>
              </div>
              <Button size="small" variant="ghost" onClick={closeOverlay}>閉じる</Button>
            </div>

            <div className={styles.overlayContent}>
              {overlay.kind === "recording" ? (
                <StudentSessionConsole
                  studentId={room.student.id}
                  studentName={room.student.name}
                  mode={recordingMode}
                  lessonPart={lessonPart}
                  onModeChange={setRecordingMode}
                  onLessonPartChange={setLessonPart}
                  onRefresh={refresh}
                  onOpenProof={openProof}
                  recordingLock={room.recordingLock}
                />
              ) : null}

              {overlay.kind === "proof" ? <LogDetailView logId={overlay.logId} showHeader={false} onBack={closeOverlay} /> : null}

              {overlay.kind === "reportBuilder" ? (
                <ReportStudio
                  panel={overlay.phase}
                  studentId={room.student.id}
                  studentName={room.student.name}
                  sessions={room.sessions}
                  reports={room.reports}
                  selectedSessionIds={selectedSessionIds}
                  onSelectedSessionIdsChange={updateSelectedSessions}
                  onRefresh={refresh}
                  onOpenProof={openProof}
                  onOpenGenerated={() => setOverlay({ kind: "reportBuilder", phase: "report_generated" })}
                  onSendReady={() => setOverlay({ kind: "reportBuilder", phase: "send_ready" })}
                />
              ) : null}

              {overlay.kind === "lessonReport" && activeLessonReportSession ? (
                <div className={styles.detailStack}>
                  <Card title="今日扱った内容" subtitle={formatDateLabel(activeLessonReportSession.sessionDate)}>
                    <p>{(activeLessonReportSession.conversation?.lessonReportJson?.did ?? []).join(" / ") || "まだ内容はありません。"}</p>
                  </Card>
                  <Card title="今日見えた理解状態" subtitle="授業中に見えた理解の手応えや不安定さです。">
                    <p>{activeLessonReportSession.conversation?.operationalLog?.changes.join(" ") || "まだ整理前です。"}</p>
                  </Card>
                  <Card title="詰まった点 / 注意点" subtitle="次の授業や引き継ぎに必要な注意点だけを置きます。">
                    <p>{(activeLessonReportSession.conversation?.lessonReportJson?.blocked ?? []).join(" / ") || "大きな詰まりは記録されていません。"}</p>
                  </Card>
                  <Card title="次回見るべき点" subtitle="次回の授業でどこを確認するかを残します。">
                    <p>{(activeLessonReportSession.conversation?.lessonReportJson?.nextLessonFocus ?? []).join(" / ") || "次回の確認点はこれから整います。"}</p>
                  </Card>
                  <Card title="宿題 / 確認事項" subtitle="授業後に回す行動だけを残します。">
                    <p>{(activeLessonReportSession.conversation?.lessonReportJson?.homework ?? []).join(" / ") || "宿題は未設定です。"}</p>
                  </Card>
                  <div className={styles.inlineActionsWrap}>
                    <Button variant="secondary" onClick={() => activeLessonReportSession.conversation?.id && openProof(activeLessonReportSession.conversation.id)} disabled={!activeLessonReportSession.conversation?.id}>根拠を見る</Button>
                  </div>
                </div>
              ) : null}

              {overlay.kind === "parentReport" && activeParentReport ? (
                <div className={styles.detailStack}>
                  <Card title="レポート本文" subtitle={`${formatDateLabel(activeParentReport.createdAt)} / ${reportStatusLabel(activeParentReport.status)}`}>
                    <div className={styles.reportTextStack}>
                      {splitParagraphs(activeParentReport.reportMarkdown).map((paragraph, index) => (
                        <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph.replace(/^#+\s*/gm, "")}</p>
                      ))}
                    </div>
                  </Card>
                  <Card title="参照範囲" subtitle="どのくらいのまとまりで生成したかを確認します。">
                    <p>対象期間: {activeParentReport.qualityChecksJson?.bundleQualityEval?.periodLabel ?? "未設定"}</p>
                    <p>参照ログ数: {activeParentReport.qualityChecksJson?.bundleQualityEval?.logCount ?? 0} 件</p>
                    <p>未確認 entity: {activeParentReport.qualityChecksJson?.pendingEntityCount ?? 0} 件</p>
                  </Card>
                  {activeParentReport.status !== "SENT" ? (
                    <div className={styles.inlineActionsWrap}>
                      <Button onClick={() => setOverlay({ kind: "reportBuilder", phase: "send_ready" })}>送付前確認へ進む</Button>
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
