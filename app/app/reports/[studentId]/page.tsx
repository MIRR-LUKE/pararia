"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { buildBundlePreview, buildBundleQualityEval, type OperationalLog, type ReportBundleLog } from "@/lib/operational-log";
import styles from "./report.module.css";

type SessionItem = {
  id: string;
  type: "INTERVIEW" | "LESSON_REPORT";
  status: string;
  title?: string | null;
  sessionDate: string;
  heroOneLiner?: string | null;
  pendingEntityCount?: number;
  conversation?: {
    id: string;
    operationalLog?: OperationalLog;
    operationalSummaryMarkdown?: string;
  } | null;
};

type ReportItem = {
  id: string;
  status: string;
  reportMarkdown: string;
  createdAt: string;
  sentAt?: string | null;
  qualityChecksJson?: {
    pendingEntityCount?: number;
    bundleQualityEval?: {
      periodLabel?: string;
      logCount?: number;
      mainThemes?: string[];
      strongElements?: string[];
      weakElements?: string[];
      parentPoints?: string[];
      warnings?: string[];
    };
  } | null;
};

type RoomResponse = {
  student: { id: string; name: string; grade?: string | null };
  sessions: SessionItem[];
  reports: ReportItem[];
};

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

function plainText(markdown?: string | null) {
  if (!markdown) return "";
  return markdown
    .replace(/#+\s*/g, "")
    .replace(/[*_>`-]/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function modeLabel(mode: SessionItem["type"]) {
  return mode === "LESSON_REPORT" ? "指導報告" : "面談";
}

function toBundleLogs(sessions: SessionItem[]): ReportBundleLog[] {
  return sessions
    .filter((session) => session.conversation?.operationalLog)
    .map((session) => ({
      id: session.id,
      sessionId: session.id,
      date: session.sessionDate,
      mode: session.type,
      operationalLog: session.conversation!.operationalLog!,
    }));
}

export default function ReportBuilderPage({ params }: { params: { studentId: string } }) {
  const searchParams = useSearchParams();
  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/students/${params.studentId}/room`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "レポート素材の取得に失敗しました。");
      setRoom(body);
    } catch (fetchError: any) {
      setError(fetchError?.message ?? "レポート素材の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [params.studentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!room) return;
    const preset = searchParams.get("sessionIds")?.split(",").filter(Boolean) ?? [];
    const validPreset = preset.filter((id) => room.sessions.some((session) => session.id === id && session.conversation?.operationalLog));
    if (validPreset.length > 0) {
      setSelectedSessionIds(validPreset);
      return;
    }

    const defaultSelection = room.sessions
      .filter((session) => session.conversation?.operationalLog)
      .slice(0, 3)
      .map((session) => session.id);
    setSelectedSessionIds(defaultSelection);
  }, [room, searchParams]);

  useEffect(() => {
    if (!room?.reports?.[0]?.reportMarkdown) return;
    setContent((prev) => prev || room.reports[0].reportMarkdown);
  }, [room?.reports]);

  const candidateSessions = useMemo(
    () => room?.sessions.filter((session) => session.conversation?.operationalLog) ?? [],
    [room?.sessions]
  );

  const selectedSessions = useMemo(
    () => candidateSessions.filter((session) => selectedSessionIds.includes(session.id)),
    [candidateSessions, selectedSessionIds]
  );

  const bundleLogs = useMemo(() => toBundleLogs(selectedSessions), [selectedSessions]);
  const allBundleLogs = useMemo(() => toBundleLogs(candidateSessions), [candidateSessions]);
  const bundleQuality = useMemo(() => buildBundleQualityEval(bundleLogs, allBundleLogs), [allBundleLogs, bundleLogs]);

  const pendingEntityCount = useMemo(
    () => selectedSessions.reduce((acc, session) => acc + (session.pendingEntityCount ?? 0), 0),
    [selectedSessions]
  );

  const latestReport = room?.reports?.[0] ?? null;
  const suggestedSessions = useMemo(
    () => candidateSessions.filter((session) => bundleQuality.suggestedLogIds.includes(session.id)),
    [bundleQuality.suggestedLogIds, candidateSessions]
  );

  const toggleSession = (sessionId: string) => {
    setSelectedSessionIds((current) =>
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId]
    );
  };

  const generate = async () => {
    if (!room || selectedSessionIds.length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: room.student.id,
          sessionIds: selectedSessionIds,
          usePreviousReport: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "保護者レポートの生成に失敗しました。");
      setContent(body.report?.reportMarkdown ?? "");
      await refresh();
    } catch (generateError: any) {
      setError(generateError?.message ?? "保護者レポートの生成に失敗しました。");
    } finally {
      setGenerating(false);
    }
  };

  const markAsSent = async (reportId: string) => {
    const res = await fetch(`/api/reports/${reportId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryChannel: "manual" }),
    });
    if (res.ok) {
      await refresh();
    }
  };

  if (loading) {
    return <div className={styles.page}>読み込み中です。</div>;
  }

  if (!room) {
    return <div className={styles.page}>レポート素材を取得できませんでした。</div>;
  }

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb}>
        <Link href="/app/students">Students</Link>
        <span>/</span>
        <Link href={`/app/students/${params.studentId}`}>{room.student.name}</Link>
        <span>/</span>
        <span>Report Builder</span>
      </nav>

      <AppHeader
        title={`${room.student.name} の保護者レポート`}
        subtitle="作文画面ではなく、会話ログのまとまりを確認してから生成する Builder です。"
        actions={
          <Button onClick={generate} disabled={generating || selectedSessionIds.length === 0}>
            {generating ? "生成中..." : "選択ログから生成"}
          </Button>
        }
      />

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>状態</span>
          <strong>{reportStatusLabel(latestReport?.status ?? null)}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>選択ログ数</span>
          <strong>{selectedSessionIds.length} 件</strong>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>要確認 entity</span>
          <strong>{pendingEntityCount} 件</strong>
        </div>
      </section>

      <div className={styles.layout}>
        <Card title="候補ログ" subtitle="テーマ・事実・変化・見立てを見て、束ねる価値のあるログだけ選びます。">
          <div className={styles.columnStack}>
            {candidateSessions.length === 0 ? (
              <div className={styles.empty}>レポートに使える会話ログがまだありません。</div>
            ) : (
              candidateSessions.map((session) => {
                const operational = session.conversation?.operationalLog;
                if (!operational) return null;
                const checked = selectedSessionIds.includes(session.id);

                return (
                  <label key={session.id} className={`${styles.logCard} ${checked ? styles.logCardSelected : ""}`}>
                    <div className={styles.logCardHead}>
                      <div className={styles.checkboxWrap}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSession(session.id)}
                        />
                        <div>
                          <strong>{modeLabel(session.type)}</strong>
                          <p className={styles.metaText}>
                            {new Date(session.sessionDate).toLocaleDateString("ja-JP")}
                          </p>
                        </div>
                      </div>
                      <div className={styles.badgeRow}>
                        {session.pendingEntityCount ? (
                          <Badge label={`未確認 ${session.pendingEntityCount}件`} tone="high" />
                        ) : null}
                        <Link href={session.conversation?.id ? `/app/logs/${session.conversation.id}` : `/app/students/${params.studentId}`}>
                          <Button size="small" variant="secondary">詳細を見る</Button>
                        </Link>
                      </div>
                    </div>

                    <div className={styles.logBody}>
                      <div className={styles.logSection}>
                        <span className={styles.sectionLabel}>今回の会話テーマ</span>
                        <p>{operational.theme}</p>
                      </div>
                      <div className={styles.logSection}>
                        <span className={styles.sectionLabel}>事実</span>
                        <p>{operational.facts.join(" ")}</p>
                      </div>
                      <div className={styles.logSection}>
                        <span className={styles.sectionLabel}>変化</span>
                        <p>{operational.changes.join(" ")}</p>
                      </div>
                      <div className={styles.logSection}>
                        <span className={styles.sectionLabel}>見立て</span>
                        <p>{operational.assessment.join(" ")}</p>
                      </div>
                      <div className={styles.logFooterMeta}>
                        <span>次に確認: {operational.nextChecks.length}件</span>
                        <span>親共有: {operational.parentShare.length}件</span>
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </Card>

        <Card title="選択中ログの束ねプレビュー" subtitle="この選び方で、一本の保護者レポートが自然に組み立つかを先に見ます。">
          <div className={styles.columnStack}>
            <div className={styles.previewCard}>
              <pre className={styles.previewText}>{buildBundlePreview(bundleQuality)}</pre>
            </div>

            <div className={styles.qualityGrid}>
              <div className={styles.qualityBox}>
                <div className={styles.sectionLabel}>強い要素</div>
                {bundleQuality.strongElements.length > 0 ? (
                  bundleQuality.strongElements.map((item) => <p key={item}>{item}</p>)
                ) : (
                  <p>まだ十分に見えていません。</p>
                )}
              </div>
              <div className={styles.qualityBox}>
                <div className={styles.sectionLabel}>弱い要素</div>
                {bundleQuality.weakElements.length > 0 ? (
                  bundleQuality.weakElements.map((item) => <p key={item}>{item}</p>)
                ) : (
                  <p>いまの選択で大きな欠けはありません。</p>
                )}
              </div>
            </div>

            <Card title="生成済みドラフト" subtitle="ここでは文章を作らず、生成後の密度と安全性を確認します。">
              <div className={styles.generatedPreview}>
                {content || latestReport?.reportMarkdown || "まだドラフトは生成されていません。"}
              </div>
              {latestReport ? (
                <div className={styles.generatedFooter}>
                  <Badge label={reportStatusLabel(latestReport.status)} tone={reportTone(latestReport.status)} />
                  <span className={styles.metaText}>{plainText(latestReport.reportMarkdown).length} 文字</span>
                </div>
              ) : null}
            </Card>
          </div>
        </Card>

        <Card title="entity確認 / 品質警告 / 送付チェック" subtitle="送付前に止めるべきものだけを右に集めます。">
          <div className={styles.columnStack}>
            <div className={styles.issueCard}>
              <div className={styles.issueHead}>
                <strong>未確認 entity</strong>
                <Badge label={`${pendingEntityCount}件`} tone={pendingEntityCount > 0 ? "high" : "low"} />
              </div>
              <p className={styles.metaText}>
                未確認が残っている間は、送付を primary にしません。
              </p>
            </div>

            <div className={styles.issueCard}>
              <div className={styles.issueHead}>
                <strong>品質警告</strong>
                <Badge label={`${bundleQuality.warnings.length}件`} tone={bundleQuality.warnings.length > 0 ? "medium" : "low"} />
              </div>
              {bundleQuality.warnings.length > 0 ? (
                <div className={styles.issueList}>
                  {bundleQuality.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                </div>
              ) : (
                <p className={styles.metaText}>いまの選択で大きな警告はありません。</p>
              )}
            </div>

            {suggestedSessions.length > 0 ? (
              <div className={styles.issueCard}>
                <div className={styles.issueHead}>
                  <strong>追加候補ログ</strong>
                  <Badge label={`${suggestedSessions.length}件`} tone="neutral" />
                </div>
                <div className={styles.issueList}>
                  {suggestedSessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className={styles.suggestionButton}
                      onClick={() => toggleSession(session.id)}
                    >
                      {new Date(session.sessionDate).toLocaleDateString("ja-JP")} / {modeLabel(session.type)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={styles.actionStack}>
              <Button onClick={generate} disabled={generating || selectedSessionIds.length === 0}>
                {generating ? "生成中..." : "この選択で保護者レポートを生成"}
              </Button>
              {latestReport && latestReport.status !== "SENT" ? (
                <Button
                  variant="secondary"
                  disabled={pendingEntityCount > 0}
                  onClick={() => markAsSent(latestReport.id)}
                >
                  {pendingEntityCount > 0 ? "entity確認後に送付可" : "送付準備完了にする"}
                </Button>
              ) : null}
              <Link href={`/app/students/${params.studentId}`}>
                <Button variant="ghost">Student Room に戻る</Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
