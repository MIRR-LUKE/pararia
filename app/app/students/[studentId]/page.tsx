"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StudentSessionStream } from "./StudentSessionStream";
import { StudentWorkbench } from "./StudentWorkbench";
import type {
  ProfileSection,
  RoomResponse,
  SessionItem,
  WorkbenchPanel,
} from "./roomTypes";
import styles from "./studentDetail.module.css";

function calcCompleteness(profileData?: any) {
  const basic = Array.isArray(profileData?.basic) ? profileData.basic.length : 0;
  const personal = Array.isArray(profileData?.personal) ? profileData.personal.length : 0;
  return Math.min(100, (basic + personal) * 6);
}

function reportStatusLabel(status?: string | null) {
  if (!status) return "未生成";
  if (status === "DRAFT") return "下書きあり";
  if (status === "REVIEWED") return "確認済み";
  if (status === "SENT") return "送付済み";
  return status;
}

function normalizePanel(panel: string | null, hasReport: boolean): WorkbenchPanel {
  if (panel === "recording") return "recording";
  if (panel === "processing") return "processing";
  if (panel === "proof") return "proof";
  if (panel === "report_selection") return "report_selection";
  if (panel === "report_generated") return "report_generated";
  if (panel === "send_ready") return "send_ready";
  if (panel === "error") return "error";
  if (panel === "report") return hasReport ? "report_generated" : "report_selection";
  return "idle";
}

function normalizeMode(value: string | null): "INTERVIEW" | "LESSON_REPORT" {
  return value === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW";
}

function normalizeLessonPart(value: string | null): "CHECK_IN" | "CHECK_OUT" {
  return value === "CHECK_OUT" ? "CHECK_OUT" : "CHECK_IN";
}

function fallbackProfileSections(sections: ProfileSection[] | null | undefined): ProfileSection[] {
  if (sections && sections.length > 0) return sections.slice(0, 4);
  return [
    { category: "学習", status: "不明", nextQuestion: "最初の面談で学習の現在地を確認する", highlights: [] },
    { category: "学校", status: "不明", nextQuestion: "学校課題と学校での様子を確認する", highlights: [] },
    { category: "生活", status: "不明", nextQuestion: "学習の土台になる生活リズムを確認する", highlights: [] },
    { category: "進路", status: "不明", nextQuestion: "志望校や受験への意識を確認する", highlights: [] },
  ];
}

export default function StudentDetailPage({ params }: { params: { studentId: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workbenchRef = useRef<HTMLDivElement | null>(null);

  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<WorkbenchPanel>("idle");
  const [proofLogId, setProofLogId] = useState<string | null>(null);
  const [recordingMode, setRecordingMode] = useState<"INTERVIEW" | "LESSON_REPORT">(
    normalizeMode(searchParams.get("mode"))
  );
  const [lessonPart, setLessonPart] = useState<"CHECK_IN" | "CHECK_OUT">(
    normalizeLessonPart(searchParams.get("part"))
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/students/${params.studentId}/room`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? "生徒ルームの取得に失敗しました。");
      }
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

  const latestConversation = room?.latestConversation ?? null;
  const latestReport = room?.reports[0] ?? null;
  const latestInterviewSession = room?.sessions.find((session) => session.type === "INTERVIEW") ?? null;
  const latestLessonSession = room?.sessions.find((session) => session.type === "LESSON_REPORT") ?? null;
  const latestProofLogId = room?.sessions.find((session) => session.conversation?.id)?.conversation?.id ?? null;
  const topicCards = latestConversation?.topicSuggestionsJson?.slice(0, 3) ?? [];
  const nextActions = latestConversation?.nextActionsJson?.slice(0, 3) ?? [];
  const profileSections = fallbackProfileSections(latestConversation?.profileSectionsJson);
  const sessionHighlights = room?.sessions.slice(0, 3) ?? [];
  const pendingEntityCount = useMemo(
    () => room?.sessions.reduce((acc, session) => acc + (session.pendingEntityCount ?? 0), 0) ?? 0,
    [room?.sessions]
  );
  const processingCount = useMemo(
    () =>
      room?.sessions.filter(
        (session) => session.status === "PROCESSING" || session.status === "COLLECTING"
      ).length ?? 0,
    [room?.sessions]
  );
  const completeness = calcCompleteness(room?.latestProfile?.profileData);

  const syncUrl = useCallback(
    (changes: {
      panel?: string | null;
      logId?: string | null;
      sessionIds?: string[] | null;
    }) => {
      const nextParams = new URLSearchParams(searchParams.toString());

      const applyValue = (key: string, value?: string | null) => {
        if (typeof value === "undefined") return;
        if (value === null || value === "") nextParams.delete(key);
        else nextParams.set(key, value);
      };

      nextParams.delete("mode");
      nextParams.delete("part");
      applyValue("panel", changes.panel);
      applyValue("logId", changes.logId);

      if (typeof changes.sessionIds !== "undefined") {
        if (changes.sessionIds && changes.sessionIds.length > 0) {
          nextParams.set("sessionIds", changes.sessionIds.join(","));
        } else {
          nextParams.delete("sessionIds");
        }
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

    if (requestedSessionIds.length > 0) {
      setSelectedSessionIds(requestedSessionIds);
    } else {
      setSelectedSessionIds((current) => current.filter((id) => validSessionIds.has(id)));
    }

    setActivePanel(normalizePanel(searchParams.get("panel"), Boolean(room.reports[0])));
    setProofLogId(searchParams.get("logId") || latestProofLogId || null);

    if (searchParams.get("panel") === "recording") {
      setRecordingMode(normalizeMode(searchParams.get("mode")));
      setLessonPart(normalizeLessonPart(searchParams.get("part")));
    }
  }, [latestProofLogId, room, searchParams]);

  const updateSelectedSessions = useCallback(
    (ids: string[]) => {
      setSelectedSessionIds(ids);
      syncUrl({ sessionIds: ids });
    },
    [syncUrl]
  );

  const openRecording = useCallback(
    (mode: "INTERVIEW" | "LESSON_REPORT", part: "CHECK_IN" | "CHECK_OUT" = "CHECK_IN") => {
      setRecordingMode(mode);
      if (mode === "LESSON_REPORT") {
        setLessonPart(part);
      }
      setActivePanel("recording");
      setProofLogId(null);
      syncUrl({ panel: "recording", logId: null, sessionIds: selectedSessionIds });
    },
    [selectedSessionIds, syncUrl]
  );

  const openProcessing = useCallback(() => {
    setActivePanel("processing");
    setProofLogId(null);
    syncUrl({ panel: "processing", logId: null, sessionIds: selectedSessionIds });
  }, [selectedSessionIds, syncUrl]);

  const openProof = useCallback(
    (logId: string) => {
      setProofLogId(logId);
      setActivePanel("proof");
      syncUrl({ panel: "proof", logId, sessionIds: selectedSessionIds });
    },
    [selectedSessionIds, syncUrl]
  );

  const openGeneratedReport = useCallback(() => {
    setActivePanel("report_generated");
    setProofLogId(null);
    syncUrl({ panel: "report_generated", logId: null, sessionIds: selectedSessionIds });
  }, [selectedSessionIds, syncUrl]);

  const openReport = useCallback(
    (options?: { sendReady?: boolean }) => {
      const nextPanel: WorkbenchPanel = options?.sendReady
        ? "send_ready"
        : selectedSessionIds.length > 0
          ? "report_selection"
          : latestReport
            ? "report_generated"
            : "report_selection";

      setActivePanel(nextPanel);
      setProofLogId(null);
      syncUrl({ panel: nextPanel, logId: null, sessionIds: selectedSessionIds });
    },
    [latestReport, selectedSessionIds, syncUrl]
  );

  const closePanel = useCallback(() => {
    setActivePanel("idle");
    setProofLogId(null);
    syncUrl({ panel: null, logId: null, sessionIds: selectedSessionIds });
  }, [selectedSessionIds, syncUrl]);

  useEffect(() => {
    if (activePanel === "idle") return;
    if (typeof window === "undefined") return;
    if (window.innerWidth > 1220) return;
    workbenchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activePanel]);

  const primaryAction = useMemo(() => {
    if (latestLessonSession?.status === "COLLECTING") {
      return {
        label: "チェックアウトを録音する",
        note: "授業前の記録は保存済みです。授業後の録音を足して、1コマ分の指導報告に閉じます。",
        onClick: () => openRecording("LESSON_REPORT", "CHECK_OUT"),
      };
    }

    if (processingCount > 0) {
      return {
        label: "生成結果を確認",
        note: `${processingCount} 件の処理が進行中です。この生徒の進みだけを右の作業面で確認できます。`,
        onClick: openProcessing,
      };
    }

    if (selectedSessionIds.length > 0) {
      return {
        label: "保護者レポートを生成",
        note: `選択中の ${selectedSessionIds.length} 件を束ねて、右の作業面で品質確認から送付前チェックまで続けられます。`,
        onClick: () => openReport(),
      };
    }

    if (latestReport && latestReport.status !== "SENT") {
      return {
        label: "送付前確認",
        note: "下書きはあります。未確認の固有名詞と警告だけを止めて、送付前の確認を終えます。",
        onClick: () => openReport({ sendReady: true }),
      };
    }

    if (!latestConversation) {
      return {
        label: "面談を録音する",
        note: "最初の会話を録ると、この生徒の状態・次の会話・保護者共有に使う素材がここで育ち始めます。",
        onClick: () => openRecording("INTERVIEW"),
      };
    }

    return {
      label: "面談を録音する",
      note: "前回の内容を踏まえた次の面談をすぐ始められます。必要なら右側から根拠確認やレポ作成にも切り替えられます。",
      onClick: () => openRecording("INTERVIEW"),
    };
  }, [
    latestConversation,
    latestLessonSession,
    latestReport,
    openProcessing,
    openRecording,
    openReport,
    processingCount,
    selectedSessionIds.length,
  ]);

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
        <AppHeader title="生徒ルーム" subtitle="読み込みに失敗しました。" />
        <Card>
          <div className={styles.emptyState}>
            <strong>{error ?? "生徒情報を取得できませんでした。"}</strong>
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
        subtitle="録音、根拠確認、レポ生成、送付前確認までをこの生徒の文脈のまま進める作業面です。"
      />

      <section className={styles.contextBar}>
        <div className={styles.contextIdentity}>
          <div>
            <div className={styles.eyebrow}>生徒ルーム</div>
            <h2 className={styles.contextName}>{room.student.name}</h2>
            <p className={styles.contextMeta}>
              学年 {room.student.grade ?? "未設定"}
              {room.student.course ? ` / コース ${room.student.course}` : ""}
            </p>
          </div>
          <div className={styles.contextBadges}>
            {latestConversation?.studentStateJson?.label ? (
              <Badge label={latestConversation.studentStateJson.label} tone="medium" />
            ) : null}
            <Badge label={`要確認 ${pendingEntityCount} 件`} tone={pendingEntityCount > 0 ? "high" : "low"} />
            <Badge label={`進行中 ${processingCount} 件`} tone={processingCount > 0 ? "medium" : "neutral"} />
          </div>
        </div>

        <div className={styles.contextActions}>
          <div className={styles.primaryNote}>{primaryAction.note}</div>
          <Button className={styles.primaryAction} onClick={primaryAction.onClick}>
            {primaryAction.label}
          </Button>
        </div>
      </section>

      <div className={styles.roomLayout}>
        <main className={styles.mainSurface}>
          <section className={styles.heroSurface}>
            <div className={styles.heroMain}>
              <div className={styles.heroTop}>
                <div>
                  <div className={styles.eyebrow}>概要</div>
                  <h2 className={styles.heroTitle}>
                    {latestConversation?.studentStateJson?.oneLiner ??
                      "まだ会話がありません。最初の面談から、この生徒の流れをここで作ります。"}
                  </h2>
                </div>
                {latestConversation?.studentStateJson?.label ? (
                  <Badge label={latestConversation.studentStateJson.label} tone="medium" />
                ) : null}
              </div>
              <p className={styles.heroText}>
                {latestConversation?.operationalLog?.theme ??
                  "会話ログのテーマ、見立て、次の一手はここに集約されます。録音を始めると、読むためでなく動くための情報に変わります。"}
              </p>
              <div className={styles.heroChips}>
                <span>今週面談: {latestInterviewSession ? "済" : "未"}</span>
                <span>
                  直近授業:{" "}
                  {latestLessonSession
                    ? latestLessonSession.status === "COLLECTING"
                      ? "途中"
                      : "記録あり"
                    : "未実施"}
                </span>
                <span>レポ状態: {reportStatusLabel(latestReport?.status ?? null)}</span>
              </div>
            </div>

            <div className={styles.heroAside}>
              <div className={styles.heroMetric}>
                <span className={styles.metricLabel}>プロフィール充足</span>
                <strong>{completeness}%</strong>
                <p className={styles.mutedText}>
                  会話を重ねるほど、学習・学校・生活・進路の文脈がここに蓄積されます。
                </p>
              </div>
              <div className={styles.heroMetric}>
                <span className={styles.metricLabel}>最新の優先テーマ</span>
                <strong>{topicCards[0]?.title ?? "まずは面談を録音"}</strong>
                <p className={styles.mutedText}>
                  {topicCards[0]?.reason ?? "次の会話を作る材料は、最初のログから立ち上がります。"}
                </p>
              </div>
            </div>
          </section>

          <section className={styles.summaryGrid}>
            <Card
              title="次にやること"
              subtitle="次の会話・次回までの確認事項・最重要の注意だけを前に出します。"
            >
              <div className={styles.stack}>
                <div className={styles.summaryBlock}>
                  <div className={styles.blockLabel}>次に聞くこと</div>
                  {topicCards.length === 0 ? (
                    <p className={styles.mutedText}>最初の会話を録ると、ここに次の会話順が出ます。</p>
                  ) : (
                    topicCards.map((topic) => (
                      <div key={`${topic.category}-${topic.title}`} className={styles.listCard}>
                        <div className={styles.listCardHead}>
                          <strong>{topic.title}</strong>
                          <Badge label={topic.category} tone="neutral" />
                        </div>
                        <p className={styles.mutedText}>{topic.question}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className={styles.summaryBlock}>
                  <div className={styles.blockLabel}>次回までの確認事項</div>
                  {nextActions.length === 0 ? (
                    <p className={styles.mutedText}>次回の確認事項は、会話生成後にここへまとまります。</p>
                  ) : (
                    nextActions.map((action, index) => (
                      <div key={`${action.owner}-${index}`} className={styles.listCard}>
                        <div className={styles.listCardHead}>
                          <strong>{action.action}</strong>
                          <Badge
                            label={
                              action.owner === "COACH"
                                ? "講師"
                                : action.owner === "PARENT"
                                  ? "保護者"
                                  : "生徒"
                            }
                            tone="neutral"
                          />
                        </div>
                        <p className={styles.mutedText}>指標: {action.metric || "未設定"}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className={styles.warningCard}>
                  <div className={styles.blockLabel}>最重要の注意</div>
                  <p>
                    {pendingEntityCount > 0
                      ? `${pendingEntityCount} 件の固有名詞候補があります。送付前にここだけ止めれば十分です。`
                      : latestLessonSession?.status === "COLLECTING"
                        ? "授業前のチェックインで止まっています。授業後の録音で 1 コマを閉じてください。"
                        : "いま大きく止めるべき注意はありません。必要なら次の録音から進められます。"}
                  </p>
                </div>
              </div>
            </Card>

            <Card
              title="プロフィール要約"
              subtitle="4カテゴリは読むためでなく、次の会話でどこを埋めるか判断するために置きます。"
            >
              <div className={styles.profileGrid}>
                {profileSections.map((section) => (
                  <div key={section.category} className={styles.profileCard}>
                    <div className={styles.listCardHead}>
                      <strong>{section.category}</strong>
                      <Badge label={section.status} tone="neutral" />
                    </div>
                    <p className={styles.profileText}>
                      {section.highlights[0]?.value ?? "まだ十分な情報がありません。"}
                    </p>
                    <p className={styles.mutedText}>次に確認: {section.nextQuestion}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card
              title="会話ログの入口"
              subtitle="直近 3 件の流れだけを前に出し、詳細と選択はそのまま下の一覧で続けます。"
            >
              <div className={styles.stack}>
                {sessionHighlights.length === 0 ? (
                  <div className={styles.emptyStateCompact}>まだ会話ログがありません。</div>
                ) : (
                  sessionHighlights.map((session: SessionItem) => (
                    <div key={session.id} className={styles.listCard}>
                      <div className={styles.listCardHead}>
                        <strong>{session.type === "LESSON_REPORT" ? "指導報告" : "面談"}</strong>
                        <Badge
                          label={
                            session.status === "COLLECTING"
                              ? "チェックアウト待ち"
                              : session.status === "PROCESSING"
                                ? "生成中"
                                : "確認可能"
                          }
                          tone={
                            session.status === "PROCESSING" || session.status === "COLLECTING"
                              ? "medium"
                              : "low"
                          }
                        />
                      </div>
                      <p className={styles.profileText}>
                        {session.heroOneLiner ?? session.latestSummary ?? session.title ?? "要点はまだありません。"}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </section>

          <section className={styles.streamSurface}>
            <StudentSessionStream
              sessions={room.sessions}
              selectedSessionIds={selectedSessionIds}
              onSelectedSessionIdsChange={updateSelectedSessions}
              onOpenProof={openProof}
            />
          </section>
        </main>

        <div ref={workbenchRef} className={styles.workbenchRail}>
          <StudentWorkbench
            panel={activePanel}
            studentId={room.student.id}
            studentName={room.student.name}
            sessions={room.sessions}
            reports={room.reports}
            selectedSessionIds={selectedSessionIds}
            onSelectedSessionIdsChange={updateSelectedSessions}
            recordingMode={recordingMode}
            lessonPart={lessonPart}
            proofLogId={proofLogId}
            recommendedAction={primaryAction}
            onOpenRecording={openRecording}
            onOpenProcessing={openProcessing}
            onOpenProof={openProof}
            onOpenReport={openReport}
            onOpenGeneratedReport={openGeneratedReport}
            onClosePanel={closePanel}
            onRefresh={refresh}
          />
        </div>
      </div>
    </div>
  );
}
