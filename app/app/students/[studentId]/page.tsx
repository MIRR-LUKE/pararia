"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StudentSessionStream } from "./StudentSessionStream";
import { StudentWorkbench } from "./StudentWorkbench";
import type { RoomResponse, WorkbenchPanel } from "./roomTypes";
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

function reportTone(status?: string | null): "neutral" | "low" | "medium" | "high" {
  if (!status) return "medium";
  if (status === "SENT") return "low";
  if (status === "REVIEWED") return "low";
  if (status === "DRAFT") return "medium";
  return "neutral";
}

function normalizePanel(panel: string | null, hasSelection: boolean, hasReport: boolean): WorkbenchPanel {
  if (panel === "recording") return "recording";
  if (panel === "proof") return "proof";
  if (panel === "report_selection") return "report_selection";
  if (panel === "report_generated") return "report_generated";
  if (panel === "send_ready") return "send_ready";
  if (panel === "error") return "error";
  if (panel === "report") {
    if (hasSelection) return "report_selection";
    if (hasReport) return "report_generated";
    return "report_selection";
  }
  return "idle";
}

export default function StudentDetailPage({ params }: { params: { studentId: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const workbenchRef = useRef<HTMLDivElement | null>(null);

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

  const applyQuery = useCallback(
    (changes: {
      panel?: string | null;
      mode?: string | null;
      part?: string | null;
      logId?: string | null;
      sessionIds?: string[] | null;
    }) => {
      const nextParams = new URLSearchParams(searchParams.toString());

      const applyValue = (key: string, value?: string | null) => {
        if (typeof value === "undefined") return;
        if (value === null || value === "") nextParams.delete(key);
        else nextParams.set(key, value);
      };

      applyValue("panel", changes.panel);
      applyValue("mode", changes.mode);
      applyValue("part", changes.part);
      applyValue("logId", changes.logId);

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
    const presetIds = (searchParams.get("sessionIds") ?? "")
      .split(",")
      .filter(Boolean)
      .filter((id) => validIds.has(id));

    if (presetIds.length > 0) {
      setSelectedSessionIds(presetIds);
      return;
    }

    setSelectedSessionIds((current) => current.filter((id) => validIds.has(id)));
  }, [room, searchParams]);

  const latestConversation = room?.latestConversation ?? null;
  const latestReport = room?.reports[0] ?? null;
  const latestInterviewSession = room?.sessions.find((session) => session.type === "INTERVIEW") ?? null;
  const latestLessonSession = room?.sessions.find((session) => session.type === "LESSON_REPORT") ?? null;
  const latestProofLogId = room?.sessions.find((session) => session.conversation?.id)?.conversation?.id ?? null;
  const pendingEntityCount = useMemo(
    () => room?.sessions.reduce((acc, session) => acc + (session.pendingEntityCount ?? 0), 0) ?? 0,
    [room?.sessions]
  );
  const processingCount = useMemo(
    () => room?.sessions.filter((session) => session.status === "PROCESSING").length ?? 0,
    [room?.sessions]
  );
  const completeness = calcCompleteness(room?.latestProfile?.profileData);
  const topicCards = latestConversation?.topicSuggestionsJson?.slice(0, 3) ?? [];
  const nextActions = latestConversation?.nextActionsJson?.slice(0, 3) ?? [];
  const profileSections = latestConversation?.profileSectionsJson?.slice(0, 4) ?? [];
  const sessionHighlights = room?.sessions.slice(0, 3) ?? [];

  const activePanel = normalizePanel(searchParams.get("panel"), selectedSessionIds.length > 0, Boolean(latestReport));
  const recordingMode = searchParams.get("mode") === "LESSON_REPORT" ? "LESSON_REPORT" : "INTERVIEW";
  const lessonPart = searchParams.get("part") === "CHECK_OUT" ? "CHECK_OUT" : "CHECK_IN";
  const proofLogId = searchParams.get("logId") || latestProofLogId || null;

  const updateSelectedSessions = useCallback(
    (ids: string[]) => {
      setSelectedSessionIds(ids);
      applyQuery({
        sessionIds: ids,
        panel: ids.length > 0 ? "report_selection" : activePanel === "report_selection" || activePanel === "report_generated" || activePanel === "send_ready" ? null : undefined,
      });
    },
    [activePanel, applyQuery]
  );

  const openRecording = useCallback(
    (mode: "INTERVIEW" | "LESSON_REPORT", part: "CHECK_IN" | "CHECK_OUT" = "CHECK_IN") => {
      applyQuery({
        panel: "recording",
        mode,
        part: mode === "LESSON_REPORT" ? part : null,
        logId: null,
      });
    },
    [applyQuery]
  );

  const openProof = useCallback(
    (logId: string) => {
      applyQuery({ panel: "proof", logId, mode: null, part: null });
    },
    [applyQuery]
  );

  const openReport = useCallback(
    (options?: { sendReady?: boolean }) => {
      applyQuery({
        panel: options?.sendReady
          ? "send_ready"
          : selectedSessionIds.length > 0
            ? "report_selection"
            : latestReport
              ? "report_generated"
              : "report_selection",
        logId: null,
      });
    },
    [applyQuery, latestReport, selectedSessionIds.length]
  );

  const closePanel = useCallback(() => {
    applyQuery({ panel: null, mode: null, part: null, logId: null });
  }, [applyQuery]);

  useEffect(() => {
    if (activePanel === "idle") return;
    if (typeof window === "undefined") return;
    if (window.innerWidth > 1220) return;
    workbenchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activePanel]);

  const primaryAction = useMemo(() => {
    if (latestLessonSession?.status === "COLLECTING") {
      return {
        label: "チェックアウトを始める",
        note: "授業前の記録は保存済みです。1コマ分の報告に仕上げます。",
        onClick: () => openRecording("LESSON_REPORT", "CHECK_OUT"),
      };
    }

    if (processingCount > 0) {
      return {
        label: "生成結果を確認",
        note: `${processingCount} 件の処理が進行中です。いまの生徒の進捗を右で確認できます。`,
        onClick: () => openRecording(latestLessonSession?.status === "PROCESSING" ? "LESSON_REPORT" : "INTERVIEW", lessonPart),
      };
    }

    if (selectedSessionIds.length > 0) {
      return {
        label: "保護者レポートを生成",
        note: `選択中の ${selectedSessionIds.length} 件を束ねて、そのまま送付前確認まで進めます。`,
        onClick: () => openReport(),
      };
    }

    if (latestReport && latestReport.status !== "SENT") {
      return {
        label: "送付前確認",
        note: "下書きはあります。送る前に事故を止める確認だけを右で行います。",
        onClick: () => openReport({ sendReady: true }),
      };
    }

    if (!latestConversation) {
      return {
        label: "面談を始める",
        note: "最初の会話を録れば、この生徒の状態・次の会話・レポ素材がここに育ち始めます。",
        onClick: () => openRecording("INTERVIEW"),
      };
    }

    return {
      label: "根拠を確認",
      note: "最新ログの要点と見立てを右で開き、必要ならそのままレポ素材に使えます。",
      onClick: () => latestProofLogId && openProof(latestProofLogId),
    };
  }, [latestConversation, latestLessonSession, latestProofLogId, latestReport, lessonPart, openProof, openRecording, openReport, processingCount, selectedSessionIds.length]);

  if (loading) {
    return (
      <div className={styles.page}>
        <AppHeader title="読み込み中..." subtitle="Student Room を準備しています。" />
        <div className={styles.skeletonHero} />
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className={styles.page}>
        <AppHeader title="Student Room" subtitle="読み込みに失敗しました。" />
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
        subtitle="この生徒の録音、根拠確認、保護者共有までを一つの思考の流れで進める作業面です。"
        actions={<Button variant="ghost" onClick={() => router.push("/app/reports")}>補助キューを見る</Button>}
      />

      <section className={styles.contextBar}>
        <div className={styles.contextIdentity}>
          <div>
            <div className={styles.eyebrow}>Student Room</div>
            <h2 className={styles.contextName}>{room.student.name}</h2>
            <p className={styles.contextMeta}>
              {room.student.grade ?? "学年未設定"}
              {room.student.course ? ` / ${room.student.course}` : ""}
            </p>
          </div>
          <div className={styles.contextBadges}>
            {latestConversation?.studentStateJson?.label ? <Badge label={latestConversation.studentStateJson.label} tone="medium" /> : null}
            <Badge label={`要確認 ${pendingEntityCount} 件`} tone={pendingEntityCount > 0 ? "high" : "low"} />
            <Badge label={`進行中 ${processingCount} 件`} tone={processingCount > 0 ? "medium" : "neutral"} />
          </div>
        </div>

        <div className={styles.contextActions}>
          <div className={styles.primaryNote}>{primaryAction.note}</div>
          <Button className={styles.primaryAction} onClick={primaryAction.onClick}>
            {primaryAction.label}
          </Button>
          <div className={styles.overflowActions}>
            <Button variant="secondary" size="small" onClick={() => openRecording("INTERVIEW")}>面談を録音</Button>
            <Button variant="secondary" size="small" onClick={() => openRecording("LESSON_REPORT", latestLessonSession?.status === "COLLECTING" ? "CHECK_OUT" : "CHECK_IN")}>
              授業を始める
            </Button>
            <Button variant="ghost" size="small" onClick={() => openReport()} disabled={selectedSessionIds.length === 0 && !latestReport}>
              レポワークベンチ
            </Button>
          </div>
        </div>
      </section>

      <div className={styles.roomLayout}>
        <main className={styles.mainSurface}>
          <section className={styles.heroSurface}>
            <div className={styles.heroMain}>
              <div className={styles.heroTop}>
                <div>
                  <div className={styles.eyebrow}>Overview</div>
                  <h2 className={styles.heroTitle}>
                    {latestConversation?.studentStateJson?.oneLiner ?? "まだ会話がありません。最初の面談からこの生徒の流れを作ります。"}
                  </h2>
                </div>
                {latestConversation?.studentStateJson?.label ? <Badge label={latestConversation.studentStateJson.label} tone="medium" /> : null}
              </div>
              <p className={styles.heroText}>
                {latestConversation?.operationalLog?.theme ?? "会話ログのテーマ、見立て、次の一手はここに集約されます。録音を始めると、読むためでなく動くための情報に変わります。"}
              </p>
              <div className={styles.heroChips}>
                <span>今週面談: {latestInterviewSession ? "済" : "未"}</span>
                <span>直近授業: {latestLessonSession ? (latestLessonSession.status === "COLLECTING" ? "途中" : "記録あり") : "未実施"}</span>
                <span>レポ状態: {reportStatusLabel(latestReport?.status ?? null)}</span>
              </div>
            </div>

            <div className={styles.heroAside}>
              <div className={styles.heroMetric}>
                <span className={styles.metricLabel}>プロフィール充足</span>
                <strong>{completeness}%</strong>
                <p className={styles.mutedText}>会話を重ねるほど、学習・学校・生活・進路の文脈がここに蓄積されます。</p>
              </div>
              <div className={styles.heroMetric}>
                <span className={styles.metricLabel}>最新の優先テーマ</span>
                <strong>{topicCards[0]?.title ?? "まずは面談を録音"}</strong>
                <p className={styles.mutedText}>{topicCards[0]?.reason ?? "次の会話を作る材料は、最初のログから立ち上がります。"}</p>
              </div>
            </div>
          </section>

          <section className={styles.summaryGrid}>
            <Card title="Next Best Action" subtitle="次の会話・次回までの確認事項・最重要 warning だけを前に出します。">
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
                          <Badge label={action.owner === "COACH" ? "講師" : action.owner === "PARENT" ? "保護者" : "生徒"} tone="neutral" />
                        </div>
                        <p className={styles.mutedText}>指標: {action.metric || "未設定"}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className={styles.warningCard}>
                  <div className={styles.blockLabel}>最重要 warning</div>
                  <p>
                    {pendingEntityCount > 0
                      ? `${pendingEntityCount} 件の固有名詞候補があります。送付前にここだけ止めれば十分です。`
                      : latestLessonSession?.status === "COLLECTING"
                        ? "授業前の check-in で止まっています。授業後の録音で 1 コマを閉じてください。"
                        : "いま大きく止めるべき warning はありません。必要なら次の録音から進められます。"}
                  </p>
                </div>
              </div>
            </Card>

            <Card title="Profile Snapshot" subtitle="4カテゴリは読むためでなく、次の会話でどこを埋めるか判断するために置きます。">
              <div className={styles.profileGrid}>
                {(profileSections.length > 0 ? profileSections : [
                  { category: "学習", status: "不明", nextQuestion: "最初の面談で学習の現在地を確認する", highlights: [] },
                  { category: "学校", status: "不明", nextQuestion: "学校課題と学校での様子を確認する", highlights: [] },
                  { category: "生活", status: "不明", nextQuestion: "学習の土台になる生活リズムを確認する", highlights: [] },
                  { category: "進路", status: "不明", nextQuestion: "志望校や受験への意識を確認する", highlights: [] },
                ]).map((section) => (
                  <div key={section.category} className={styles.profileCard}>
                    <div className={styles.listCardHead}>
                      <strong>{section.category}</strong>
                      <Badge label={section.status} tone="neutral" />
                    </div>
                    <p className={styles.profileText}>{section.highlights[0]?.value ?? "まだ十分な情報がありません。"}</p>
                    <p className={styles.mutedText}>次に確認: {section.nextQuestion}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Session Stream の入口" subtitle="直近の流れを 3 件だけ前に出し、詳細はそのまま下で選べるようにします。">
              <div className={styles.stack}>
                {sessionHighlights.length === 0 ? (
                  <div className={styles.emptyStateCompact}>まだ会話ログがありません。</div>
                ) : (
                  sessionHighlights.map((session) => (
                    <div key={session.id} className={styles.listCard}>
                      <div className={styles.listCardHead}>
                        <strong>{session.type === "LESSON_REPORT" ? "指導報告" : "面談"}</strong>
                        <Badge label={session.status === "COLLECTING" ? "check-out 待ち" : session.status === "PROCESSING" ? "生成中" : "確認可能"} tone={session.status === "PROCESSING" ? "medium" : session.status === "COLLECTING" ? "medium" : "low"} />
                      </div>
                      <p className={styles.profileText}>{session.heroOneLiner ?? session.latestSummary ?? session.title ?? "要点はまだありません。"}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </section>

          <section id="session-stream" className={styles.streamSurface}>
            <StudentSessionStream
              sessions={room.sessions}
              selectedSessionIds={selectedSessionIds}
              onSelectedSessionIdsChange={updateSelectedSessions}
              onOpenProof={openProof}
              onOpenReport={() => openReport()}
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
            onOpenRecording={openRecording}
            onOpenProof={openProof}
            onOpenReport={openReport}
            onClosePanel={closePanel}
            onRefresh={refresh}
          />
        </div>
      </div>
    </div>
  );
}
