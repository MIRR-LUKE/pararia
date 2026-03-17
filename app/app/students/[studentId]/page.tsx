"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { OperationalLog } from "@/lib/operational-log";
import styles from "./studentDetail.module.css";
import { StudentRecorder } from "./StudentRecorder";
import { LessonReportComposer } from "./LessonReportComposer";

type TopicCard = {
  category: string;
  title: string;
  reason: string;
  question: string;
  priority: number;
};

type NextAction = {
  owner: string;
  action: string;
  due: string | null;
  metric: string;
  why: string;
};

type ProfileSection = {
  category: string;
  status: string;
  highlights: Array<{ label: string; value: string; isNew?: boolean; isUpdated?: boolean }>;
  nextQuestion: string;
};

type StudentState = {
  label: string;
  oneLiner: string;
  rationale: string[];
  confidence: number;
};

type SessionEntity = {
  id: string;
  kind: string;
  rawValue: string;
  canonicalValue?: string | null;
  confidence: number;
  status: string;
};

type SessionItem = {
  id: string;
  type: "INTERVIEW" | "LESSON_REPORT";
  status: string;
  title?: string | null;
  sessionDate: string;
  heroStateLabel?: string | null;
  heroOneLiner?: string | null;
  latestSummary?: string | null;
  pendingEntityCount: number;
  parts: Array<{ id: string; partType: string; status: string; fileName?: string | null }>;
  entities: SessionEntity[];
  conversation?: {
    id: string;
    status: string;
    summaryMarkdown?: string | null;
    operationalLog?: OperationalLog | null;
    operationalSummaryMarkdown?: string | null;
    studentStateJson?: StudentState | null;
    topicSuggestionsJson?: TopicCard[] | null;
    nextActionsJson?: NextAction[] | null;
    profileSectionsJson?: ProfileSection[] | null;
    lessonReportJson?: {
      goal?: string;
      did?: string[];
      blocked?: string[];
      homework?: string[];
      nextLessonFocus?: string[];
      parentShare?: string;
    } | null;
    createdAt: string;
  } | null;
};

type ReportItem = {
  id: string;
  status: string;
  reportMarkdown: string;
  createdAt: string;
  sentAt?: string | null;
};

type RoomResponse = {
  student: {
    id: string;
    name: string;
    grade?: string | null;
    course?: string | null;
    guardianNames?: string | null;
    profiles: Array<{ profileData?: any }>;
  };
  latestConversation?: {
    id: string;
    status: string;
    summaryMarkdown?: string | null;
    operationalLog?: OperationalLog | null;
    operationalSummaryMarkdown?: string | null;
    studentStateJson?: StudentState | null;
    topicSuggestionsJson?: TopicCard[] | null;
    nextActionsJson?: NextAction[] | null;
    profileSectionsJson?: ProfileSection[] | null;
    createdAt: string;
  } | null;
  latestProfile?: { profileData?: any } | null;
  sessions: SessionItem[];
  reports: ReportItem[];
};

const ACTION_OWNER_LABELS: Record<string, string> = {
  COACH: "講師",
  STUDENT: "生徒",
  PARENT: "保護者",
};

const ENTITY_KIND_LABELS: Record<string, string> = {
  SCHOOL: "学校名",
  TARGET_SCHOOL: "志望校",
  MATERIAL: "教材",
  EXAM: "検定・試験",
  CRAM_SCHOOL: "塾名",
  TEACHER: "先生名",
  METRIC: "数値情報",
  OTHER: "その他",
};

const SESSION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "下書き",
  COLLECTING: "check-out 待ち",
  PROCESSING: "生成中",
  READY: "確認可能",
  DONE: "完了",
  ERROR: "エラー",
};

const REPORT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "下書きあり",
  REVIEWED: "確認済み",
  SENT: "送付済み",
};

function calcCompleteness(profileData?: any) {
  const basic = Array.isArray(profileData?.basic) ? profileData.basic.length : 0;
  const personal = Array.isArray(profileData?.personal) ? profileData.personal.length : 0;
  return Math.min(100, (basic + personal) * 6);
}

function labelActionOwner(owner?: string | null) {
  if (!owner) return "担当者";
  return ACTION_OWNER_LABELS[owner] ?? owner;
}

function labelEntityKind(kind?: string | null) {
  if (!kind) return "未分類";
  return ENTITY_KIND_LABELS[kind] ?? kind;
}

function labelSessionStatus(status?: string | null) {
  if (!status) return "未設定";
  return SESSION_STATUS_LABELS[status] ?? status;
}

function labelReportStatus(status?: string | null) {
  if (!status) return "未設定";
  return REPORT_STATUS_LABELS[status] ?? status;
}

function toneFromStatus(status?: string | null): "neutral" | "low" | "medium" | "high" {
  if (status === "READY" || status === "DONE" || status === "SENT") return "low";
  if (status === "ERROR") return "high";
  return "medium";
}

function plainText(markdown?: string | null) {
  if (!markdown) return "";
  return markdown
    .replace(/#+\s*/g, "")
    .replace(/[*_>`-]/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function StudentDetailPage({ params }: { params: { studentId: string } }) {
  const searchParams = useSearchParams();
  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [communicationFilter, setCommunicationFilter] = useState<"ALL" | "INTERVIEW" | "LESSON_REPORT" | "PARENT" | "ENTITY">("ALL");
  const [selectedCommunicationIds, setSelectedCommunicationIds] = useState<string[]>([]);

  const conversationRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<HTMLDivElement>(null);
  const lessonRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/students/${params.studentId}/room`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "生徒ルームの取得に失敗しました。");
      setRoom(body);
    } catch (err: any) {
      setError(err?.message ?? "生徒ルームの取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [params.studentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (focus === "interview") {
      recorderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (focus === "lesson") {
      lessonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (focus === "report") {
      reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [searchParams]);

  const latestView = room?.latestConversation;
  const studentState = latestView?.studentStateJson;
  const topicCards = latestView?.topicSuggestionsJson?.slice(0, 3) ?? [];
  const nextActions = latestView?.nextActionsJson?.slice(0, 3) ?? [];
  const profileSections = latestView?.profileSectionsJson ?? [];
  const latestOperational = latestView?.operationalLog;
  const completeness = calcCompleteness(room?.latestProfile?.profileData);
  const pendingEntities = useMemo(
    () =>
      (room?.sessions ?? [])
        .flatMap((session) => session.entities.map((entity) => ({ ...entity, sessionId: session.id })))
        .filter((entity) => entity.status === "PENDING"),
    [room?.sessions]
  );

  const latestLessonSession = room?.sessions.find((session) => session.type === "LESSON_REPORT");
  const latestInterviewSession = room?.sessions.find((session) => session.type === "INTERVIEW");
  const latestReport = room?.reports[0] ?? null;
  const latestProofLogId = room?.sessions.find((session) => session.conversation?.id)?.conversation?.id;
  const communicationSessions = useMemo(() => {
    const sessions = (room?.sessions ?? []).filter((session) => session.conversation?.operationalLog);
    return sessions.filter((session) => {
      if (communicationFilter === "ALL") return true;
      if (communicationFilter === "INTERVIEW") return session.type === "INTERVIEW";
      if (communicationFilter === "LESSON_REPORT") return session.type === "LESSON_REPORT";
      if (communicationFilter === "PARENT") return (session.conversation?.operationalLog?.parentShare.length ?? 0) > 0;
      if (communicationFilter === "ENTITY") return (session.pendingEntityCount ?? 0) > 0;
      return true;
    });
  }, [communicationFilter, room?.sessions]);

  useEffect(() => {
    setSelectedCommunicationIds((current) =>
      current.filter((id) => room?.sessions.some((session) => session.id === id))
    );
  }, [room?.sessions]);

  const primaryAction = useMemo<{ label: string; href?: string; onClick?: () => void }>(() => {
    if (latestLessonSession?.status === "COLLECTING") {
      return {
        label: "チェックアウトを録音",
        onClick: () => lessonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      };
    }
    if (latestReport && latestReport.status !== "SENT") {
      return {
        label: "レポを確認",
        href: `/app/reports/${params.studentId}`,
      };
    }
    if (!latestView) {
      return {
        label: "面談を録音",
        onClick: () => recorderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      };
    }
    return {
      label: "次の会話を見る",
      onClick: () => conversationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    };
  }, [latestLessonSession?.status, latestReport, latestView, params.studentId]);

  const reviewEntity = async (sessionId: string, entityId: string, action: "confirm" | "ignore", canonicalValue?: string) => {
    const res = await fetch(`/api/sessions/${sessionId}/entities/${entityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, canonicalValue }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(body?.error ?? "確認の反映に失敗しました。");
      return;
    }
    await refresh();
  };

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
        subtitle="ここで面談、授業、保護者共有をつなぎます。読むより先に、次の行動を進めるための面です。"
      />

      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <div className={styles.heroTopRow}>
            <p className={styles.eyebrow}>Student Room</p>
            <div className={styles.heroBadges}>
              {room.student.grade ? <Badge label={room.student.grade} tone="neutral" /> : null}
              {studentState?.label ? <Badge label={studentState.label} tone="medium" /> : null}
              {pendingEntities.length > 0 ? <Badge label={`要確認 ${pendingEntities.length}件`} tone="high" /> : null}
            </div>
          </div>
          <h2 className={styles.heroTitle}>{studentState?.oneLiner ?? "まだ会話データがありません。最初の面談から始めます。"}</h2>
          <p className={styles.heroText}>
            {studentState?.rationale?.join(" / ") || "会話を重ねると、ここに状態の変化と次の会話の軸がたまっていきます。"}
          </p>
          <div className={styles.heroMeta}>
            <span>今週面談: {latestInterviewSession ? "済" : "未"}</span>
            <span>レポ状態: {latestReport ? labelReportStatus(latestReport.status) : "未生成"}</span>
            <span>要確認: {pendingEntities.length} 件</span>
          </div>
        </div>

        <div className={styles.heroSide}>
          <div className={styles.primaryCtaBlock}>
            {primaryAction.href ? (
              <Link href={primaryAction.href}>
                <Button className={styles.primaryCta}>{primaryAction.label}</Button>
              </Link>
            ) : (
              <Button className={styles.primaryCta} onClick={primaryAction.onClick}>
                {primaryAction.label}
              </Button>
            )}
            <div className={styles.secondaryActions}>
              <Button variant="secondary" onClick={() => recorderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                面談を録音
              </Button>
              <Button variant="secondary" onClick={() => lessonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                授業を始める
              </Button>
            </div>
          </div>

          <div className={styles.completenessCard}>
            <div className={styles.metricLabel}>プロフィール充足</div>
            <div className={styles.metricValue}>{completeness}%</div>
            <div className={styles.metricHint}>会話を重ねるほど、生徒理解がここに蓄積されます。</div>
          </div>
        </div>
      </section>

      <section className={styles.surfaceGrid} ref={conversationRef}>
        <Card title="今回の会話ログ" subtitle="文字起こしではなく、次の運用に使える形へ再構成した会話ログです。">
          <div className={styles.stack}>
            <div className={styles.topicCard}>
              <div className={styles.topicHead}>
                <strong>今回の会話テーマ</strong>
                {studentState?.label ? <Badge label={studentState.label} tone="medium" /> : null}
              </div>
              <p className={styles.topicQuestion}>{latestOperational?.theme ?? "面談や授業を録ると、ここに今回の会話テーマが出ます。"}</p>
            </div>
            <div className={styles.highlightItem}>
              <div className={styles.blockLabel}>事実として分かったこと</div>
              <p>{latestOperational?.facts.join(" ") ?? "まだ会話ログがありません。"}</p>
            </div>
            <div className={styles.highlightItem}>
              <div className={styles.blockLabel}>講師としての見立て</div>
              <p>{latestOperational?.assessment.join(" ") ?? "記録がたまると、ここに見立てが整理されます。"}</p>
            </div>
          </div>
        </Card>

        <Card title="次の会話はこの順で聞く" subtitle="この3件から始めれば、会話の入口を迷わず作れます。">
          <div className={styles.stack}>
            {topicCards.length === 0 ? (
              <div className={styles.emptySmall}>次の会話テーマは、面談や授業を1回録るとここに自動で出ます。</div>
            ) : (
              topicCards.map((topic) => (
                <div key={`${topic.category}-${topic.title}`} className={styles.topicCard}>
                  <div className={styles.topicHead}>
                    <strong>{topic.title}</strong>
                    <Badge label={topic.category} tone="neutral" />
                  </div>
                  <p className={styles.topicReason}>{topic.reason}</p>
                  <p className={styles.topicQuestion}>{topic.question}</p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card title="次回までに確認する行動" subtitle="次に会ったとき、進んだかどうかをすぐ確認できる粒度だけに絞ります。">
          <div className={styles.stack}>
            {nextActions.length === 0 ? (
              <div className={styles.emptySmall}>次回までの行動は、会話が生成されるとここに自動で整理されます。</div>
            ) : (
              nextActions.map((action, index) => (
                <div key={`${action.owner}-${index}`} className={styles.actionCard}>
                  <div className={styles.actionHead}>
                    <Badge label={labelActionOwner(action.owner)} tone="neutral" />
                    {action.due ? <span className={styles.actionDue}>{action.due}</span> : null}
                  </div>
                  <strong>{action.action}</strong>
                  <p className={styles.actionMetric}>指標: {action.metric}</p>
                  <p className={styles.actionWhy}>{action.why}</p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card title="このまま送る前に確認すること" subtitle="事故につながる確認だけを前に出します。修正はここから直接反映できます。">
          <div className={styles.stack}>
            {pendingEntities.length === 0 && !latestReport ? (
              <div className={styles.emptySmall}>いま確認が必要な項目はありません。</div>
            ) : null}
            {pendingEntities.map((entity) => (
              <div key={entity.id} className={styles.reviewRow}>
                <div>
                  <strong>{entity.rawValue}</strong>
                  <p className={styles.metaLine}>{labelEntityKind(entity.kind)} / 信頼度 {entity.confidence}%</p>
                </div>
                <div className={styles.inlineActions}>
                  <Button
                    size="small"
                    onClick={() =>
                      reviewEntity((entity as any).sessionId, entity.id, "confirm", entity.canonicalValue ?? entity.rawValue)
                    }
                  >
                    確定
                  </Button>
                  <Button size="small" variant="secondary" onClick={() => reviewEntity((entity as any).sessionId, entity.id, "ignore")}>
                    無視
                  </Button>
                </div>
              </div>
            ))}
            {latestReport ? (
              <div className={styles.reviewSummary}>
                <strong>保護者レポート</strong>
                <p className={styles.metaLine}>状態: {labelReportStatus(latestReport.status)}</p>
                <Link href={`/app/reports/${params.studentId}`}>
                  <Button variant="secondary" size="small">下書きを確認</Button>
                </Link>
              </div>
            ) : null}
          </div>
        </Card>
      </section>

      <Card title="生徒理解" subtitle="内部では複雑な構造を持っていても、画面には状態・今回のポイント・次に話すだけを出します。">
        <div className={styles.profileStack}>
          {profileSections.length === 0 ? (
            <div className={styles.emptySmall}>プロフィールの変化は、面談や授業を重ねるほどここに育ちます。</div>
          ) : (
            profileSections.map((section) => (
              <details key={section.category} className={styles.profileSection} open>
                <summary className={styles.profileSummary}>
                  <div>
                    <strong>{section.category}</strong>
                    <div className={styles.metaLine}>状態: {section.status}</div>
                  </div>
                  <span aria-hidden>⌄</span>
                </summary>
                <div className={styles.profileBody}>
                  <div className={styles.profileBlock}>
                    <div className={styles.blockLabel}>今回のポイント</div>
                    <div className={styles.highlightList}>
                      {section.highlights.map((highlight) => (
                        <div key={`${highlight.label}-${highlight.value}`} className={styles.highlightItem}>
                          <div className={styles.highlightTop}>
                            <strong>{highlight.label}</strong>
                            {highlight.isNew ? <Badge label="NEW" tone="low" /> : null}
                            {highlight.isUpdated ? <Badge label="UPDATE" tone="medium" /> : null}
                          </div>
                          <p>{highlight.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className={styles.profileBlock}>
                    <div className={styles.blockLabel}>次に話す</div>
                    <p>{section.nextQuestion}</p>
                  </div>
                </div>
              </details>
            ))
          )}
        </div>
      </Card>

      <Card
        title="Communication / レポ素材"
        subtitle="ここが親レポ素材選択の起点です。テーマ・事実・変化・見立てを見て、束ねるログだけ選びます。"
      >
        <div className={styles.inlineActions}>
          {[
            ["ALL", "すべて"],
            ["INTERVIEW", "面談のみ"],
            ["LESSON_REPORT", "指導報告のみ"],
            ["PARENT", "親共有向き"],
            ["ENTITY", "entity未確認あり"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${styles.filterChip} ${communicationFilter === key ? styles.filterChipActive : ""}`}
              onClick={() => setCommunicationFilter(key as typeof communicationFilter)}
            >
              {label}
            </button>
          ))}
          {selectedCommunicationIds.length > 0 ? (
            <Link href={`/app/reports/${params.studentId}?sessionIds=${selectedCommunicationIds.join(",")}`}>
              <Button>選択したログでレポ Builderへ</Button>
            </Link>
          ) : (
            <Button disabled>選択したログでレポ Builderへ</Button>
          )}
        </div>

        <div className={styles.historyList}>
          {communicationSessions.length === 0 ? (
            <div className={styles.emptySmall}>この条件に合う会話ログはまだありません。</div>
          ) : (
            communicationSessions.map((session) => {
              const operational = session.conversation?.operationalLog;
              if (!operational) return null;
              const selected = selectedCommunicationIds.includes(session.id);

              return (
                <div key={session.id} className={styles.communicationRow}>
                  <label className={styles.communicationSelect}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        setSelectedCommunicationIds((current) =>
                          current.includes(session.id)
                            ? current.filter((id) => id !== session.id)
                            : [...current, session.id]
                        )
                      }
                    />
                    <div>
                      <div className={styles.historyHead}>
                        <strong>{session.type === "LESSON_REPORT" ? "指導報告" : "面談"}</strong>
                        <Badge label={labelSessionStatus(session.status)} tone={toneFromStatus(session.status)} />
                      </div>
                      <p className={styles.metaLine}>{new Date(session.sessionDate).toLocaleDateString("ja-JP")}</p>
                    </div>
                  </label>

                  <div className={styles.communicationBody}>
                    <div className={styles.communicationColumn}>
                      <div className={styles.blockLabel}>今回の会話テーマ</div>
                      <p>{operational.theme}</p>
                    </div>
                    <div className={styles.communicationColumn}>
                      <div className={styles.blockLabel}>事実</div>
                      <p>{operational.facts.join(" ")}</p>
                    </div>
                    <div className={styles.communicationColumn}>
                      <div className={styles.blockLabel}>変化</div>
                      <p>{operational.changes.join(" ")}</p>
                    </div>
                    <div className={styles.communicationColumn}>
                      <div className={styles.blockLabel}>見立て</div>
                      <p>{operational.assessment.join(" ")}</p>
                    </div>
                    <div className={styles.communicationMeta}>
                      <span>親共有 {operational.parentShare.length}件</span>
                      <span>entity未確認 {session.pendingEntityCount}件</span>
                    </div>
                  </div>

                  <div className={styles.inlineActions}>
                    {session.conversation?.id ? (
                      <Link href={`/app/logs/${session.conversation.id}`}>
                        <Button size="small" variant="secondary">詳細を見る</Button>
                      </Link>
                    ) : null}
                    <Link href={`/app/reports/${params.studentId}?sessionIds=${session.id}`}>
                      <Button size="small">このログでレポへ</Button>
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <div className={styles.supportGrid}>
        <Card title="指導報告" subtitle="授業前後の記録は 1 コマの授業として束ねて扱います。">
          {latestLessonSession ? (
            <div className={styles.stack}>
              <div className={styles.lessonSummary}>
                <div>
                  <strong>{new Date(latestLessonSession.sessionDate).toLocaleDateString("ja-JP")}</strong>
                  <p className={styles.metaLine}>{labelSessionStatus(latestLessonSession.status)}</p>
                </div>
                <Badge label={labelSessionStatus(latestLessonSession.status)} tone={toneFromStatus(latestLessonSession.status)} />
              </div>
              <p className={styles.summaryText}>
                {latestLessonSession.heroOneLiner ?? latestLessonSession.latestSummary ?? "授業セッションの要点がまだありません。"}
              </p>
              {latestLessonSession.conversation?.lessonReportJson?.nextLessonFocus?.length ? (
                <div className={styles.lessonCarry}>次回授業の引き継ぎ: {latestLessonSession.conversation.lessonReportJson.nextLessonFocus.join(" / ")}</div>
              ) : null}
            </div>
          ) : (
            <div className={styles.emptySmall}>まだ指導報告がありません。授業を始めるとここにまとまります。</div>
          )}
          <div className={styles.inlineActions}>
            <Button variant="secondary" onClick={() => lessonRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              授業を始める
            </Button>
            {latestLessonSession?.conversation?.id ? (
              <Link href={`/app/logs/${latestLessonSession.conversation.id}`}>
                <Button size="small">指導報告を見る</Button>
              </Link>
            ) : null}
          </div>
        </Card>

        <div ref={reportRef}>
        <Card title="保護者レポート" subtitle="ここでは文章を作るのでなく、下書きを確認して事故を止めることを優先します。">
          <div className={styles.stack}>
            <div className={styles.reportHeader}>
              <div>
                <div className={styles.metricLabel}>今月の下書き状態</div>
                <div className={styles.metricValueSmall}>{latestReport ? labelReportStatus(latestReport.status) : "未生成"}</div>
              </div>
              <Badge label={latestReport ? labelReportStatus(latestReport.status) : "未生成"} tone={latestReport ? toneFromStatus(latestReport.status) : "medium"} />
            </div>
            <p className={styles.summaryText}>
              {latestReport
                ? plainText(latestReport.reportMarkdown).slice(0, 140) + (plainText(latestReport.reportMarkdown).length > 140 ? "…" : "")
                : "レポートの下書きは、この生徒の会話履歴をもとに自動で準備します。"}
            </p>
            <div className={styles.inlineActions}>
              <Link href={`/app/reports/${params.studentId}`}>
                <Button>下書きを確認</Button>
              </Link>
              {latestProofLogId ? (
                <Link href={`/app/logs/${latestProofLogId}`}>
                  <Button variant="secondary">根拠を見る</Button>
                </Link>
              ) : null}
            </div>
          </div>
        </Card>
        </div>
      </div>

      <Card title="セッション履歴 / 根拠" subtitle="ログ詳細は主導線ではありません。必要なときだけ根拠を見に行ける構造にします。">
        <div className={styles.historyList}>
          {room.sessions.length === 0 ? (
            <div className={styles.emptySmall}>まだセッションがありません。最初の面談か授業から始めてください。</div>
          ) : (
            room.sessions.slice(0, 8).map((session) => (
              <div key={session.id} className={styles.historyRow}>
                <div>
                  <div className={styles.historyHead}>
                    <strong>{session.type === "LESSON_REPORT" ? "指導報告" : "面談"}</strong>
                    <Badge label={labelSessionStatus(session.status)} tone={toneFromStatus(session.status)} />
                  </div>
                  <p className={styles.metaLine}>{new Date(session.sessionDate).toLocaleDateString("ja-JP")}</p>
                  <p className={styles.summaryText}>{session.heroOneLiner ?? session.latestSummary ?? session.title ?? "要点はまだありません。"}</p>
                </div>
                <div className={styles.inlineActions}>
                  {session.conversation?.id ? (
                    <Link href={`/app/logs/${session.conversation.id}`}>
                      <Button size="small" variant="secondary">根拠を見る</Button>
                    </Link>
                  ) : null}
                  {session.type === "LESSON_REPORT" ? (
                    <Link href={`/app/reports/${params.studentId}?sessionIds=${session.id}`}>
                      <Button size="small">レポに使う</Button>
                    </Link>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <div className={styles.recorderGrid}>
        <div ref={recorderRef}>
          <StudentRecorder studentName={room.student.name} studentId={room.student.id} onLogCreated={refresh} />
        </div>
        <div ref={lessonRef}>
          <LessonReportComposer
            studentName={room.student.name}
            studentId={room.student.id}
            onCompleted={refresh}
            onReportFromSession={() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          />
        </div>
      </div>
    </div>
  );
}
