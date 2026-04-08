"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  buildReportDeliverySummary,
  deriveReportDeliveryState,
  reportDeliveryStateLabel,
} from "@/lib/report-delivery";
import styles from "./dashboard.module.css";

type SessionSummary = {
  id: string;
  status: string;
  type: "INTERVIEW" | "LESSON_REPORT";
  sessionDate: string;
  heroStateLabel?: string | null;
  heroOneLiner?: string | null;
  latestSummary?: string | null;
  conversation?: { id: string } | null;
};

type ReportSummary = {
  id: string;
  status: "DRAFT" | "REVIEWED" | "SENT" | string;
  createdAt: string;
  reviewedAt?: string | null;
  sentAt?: string | null;
  deliveryChannel?: string | null;
  sourceLogIds?: string[] | null;
  deliveryEvents?: Array<{
    id?: string;
    eventType: string;
    createdAt: string;
    deliveryChannel?: string | null;
  }>;
};

type StudentRow = {
  id: string;
  name: string;
  grade?: string | null;
  course?: string | null;
  profileCompleteness?: number | null;
  sessions?: SessionSummary[];
  reports?: ReportSummary[];
  _count?: { sessions: number; reports: number };
  recordingLock?: { mode: string; lockedByName: string } | null;
};

type QueueKind = "interview" | "report" | "review" | "share" | "room";

type QueueItem = {
  student: StudentRow;
  kind: QueueKind;
  title: string;
  reason: string;
  cta: string;
  href: string;
  score: number;
};

function toDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function diffHours(start?: string | null, end?: string | null) {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate) return null;
  const diffMs = endDate.getTime() - startDate.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return diffMs / (60 * 60 * 1000);
}

function latestReportSummary(report?: ReportSummary | null) {
  if (!report) return null;
  return buildReportDeliverySummary(report);
}

function reportStateLabel(report?: ReportSummary | null) {
  if (!report) return "保護者レポート未生成";
  const summary = latestReportSummary(report);
  if (summary) return reportDeliveryStateLabel(summary.deliveryState);
  const deliveryState = deriveReportDeliveryState(report);
  return reportDeliveryStateLabel(deliveryState);
}

function summarize(student: StudentRow) {
  const latestSession = student.sessions?.[0];
  const latestReport = student.reports?.[0] ?? null;
  const latestReportSummary = latestReport ? buildReportDeliverySummary(latestReport) : null;

  if (!latestSession) {
    return {
      state: "未開始",
      oneLiner: "まだ会話データがありません。最初の面談から始めます。",
      queue: {
        kind: "interview" as const,
        title: "面談を始める",
        reason: "この生徒にはまだ会話ログがありません。",
        cta: "面談を始める",
        href: `/app/students/${student.id}?panel=recording&mode=INTERVIEW`,
        score: 100,
      },
    };
  }

  if (latestSession.conversation?.id && !latestReport) {
    return {
      state: latestSession.heroStateLabel ?? "レポート作成待ち",
      oneLiner:
        latestSession.heroOneLiner ?? latestSession.latestSummary ?? "ログは生成済みです。必要なログを選んで保護者レポートを作成できます。",
      queue: {
        kind: "report" as const,
        title: "レポートを作る",
        reason: "会話ログはそろっています。保護者レポートをまだ作っていません。",
        cta: "ログを選ぶ",
        href: `/app/students/${student.id}?panel=report`,
        score: 88,
      },
    };
  }

  if (latestReportSummary?.deliveryState === "draft") {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者レポートは下書き済みです。確認して共有まで進められます。",
      queue: {
        kind: "review" as const,
        title: "レビュー待ち",
        reason: "保護者レポートは下書き済みです。確認して送付前に整えます。",
        cta: "レポートを開く",
        href: `/app/students/${student.id}?panel=report`,
        score: 86,
      },
    };
  }

  if (latestReportSummary?.deliveryState === "reviewed") {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner: latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者レポートは確認済みです。共有に進めます。",
      queue: {
        kind: "share" as const,
        title: "共有待ち",
        reason: "保護者レポートは確認済みです。送信または手動共有を完了します。",
        cta: "共有を進める",
        href: `/app/students/${student.id}?panel=report`,
        score: 84,
      },
    };
  }

  if (latestReportSummary && ["failed", "bounced"].includes(latestReportSummary.deliveryState)) {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner: "送信に失敗しています。再送または手動共有を確認してください。",
      queue: {
        kind: "share" as const,
        title: "再送を確認",
        reason: "failed / bounced の履歴があります。送信方法を見直します。",
        cta: "共有を見直す",
        href: `/app/students/${student.id}?panel=report`,
        score: 88,
      },
    };
  }

  if (latestReportSummary && ["sent", "delivered", "resent", "manual_shared"].includes(latestReportSummary.deliveryState)) {
    return {
      state: latestReportSummary.deliveryStateLabel,
      oneLiner:
        latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者共有は完了しています。履歴と次の会話に進めます。",
      queue: {
        kind: "room" as const,
        title: "送付済みを確認",
        reason: "送付後の履歴と次の会話を確認できます。",
        cta: "レポートを見る",
        href: `/app/students/${student.id}`,
        score: 40,
      },
    };
  }

  return {
    state: latestSession.heroStateLabel ?? "更新済み",
    oneLiner:
      latestSession.heroOneLiner ?? latestSession.latestSummary ?? "次の会話に向けて確認内容が整理されています。",
    queue: {
      kind: "room" as const,
      title: "次の会話を見る",
      reason: "次の会話に向けた質問と行動を確認できます。",
      cta: "生徒ルームへ",
      href: `/app/students/${student.id}`,
      score: 40,
    },
  };
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const userRole = (session?.user as { role?: string } | undefined)?.role;
  const canInvite = userRole === "ADMIN" || userRole === "MANAGER";

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = "/api/students?includeRecordingLock=1";
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "生徒情報の取得に失敗しました。");
        setStudents(body.students ?? []);
      } catch (err: any) {
        setError(err?.message ?? "今日の優先キューの読み込みに失敗しました。");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const enriched = useMemo(() => {
    return students.map((student) => {
      const summary = summarize(student);
      return {
        ...student,
        completeness: student.profileCompleteness ?? 0,
        state: summary.state,
        oneLiner: summary.oneLiner,
        queue: summary.queue,
      };
    });
  }, [students]);

  const queue = useMemo(
    () => [...enriched].sort((a, b) => b.queue.score - a.queue.score).slice(0, 8),
    [enriched]
  );

  const stats = useMemo(() => {
    const reportUncreated = enriched.filter((item) => item.queue.kind === "report").length;
    const reviewWait = enriched.filter((item) => latestReportSummary(item.reports?.[0] ?? null)?.deliveryState === "draft").length;
    const shareWait = enriched.filter((item) => latestReportSummary(item.reports?.[0] ?? null)?.deliveryState === "reviewed").length;
    const sent = enriched.filter((item) => {
      const state = latestReportSummary(item.reports?.[0] ?? null)?.deliveryState;
      return state === "sent" || state === "delivered" || state === "resent" || state === "manual_shared";
    }).length;
    const manualShare = enriched.filter(
      (item) => latestReportSummary(item.reports?.[0] ?? null)?.deliveryState === "manual_shared"
    ).length;
    const delivered = enriched.filter(
      (item) => latestReportSummary(item.reports?.[0] ?? null)?.deliveryState === "delivered"
    ).length;
    const resent = enriched.filter((item) => latestReportSummary(item.reports?.[0] ?? null)?.deliveryState === "resent").length;
    const failedBounced = enriched.filter((item) => {
      const state = latestReportSummary(item.reports?.[0] ?? null)?.deliveryState;
      return state === "failed" || state === "bounced";
    }).length;
    const shareDurations = enriched
      .map((item) => {
        const latestReport = item.reports?.[0] ?? null;
        const shareState = latestReportSummary(latestReport)?.deliveryState;
        if (!latestReport || !shareState || !["sent", "delivered", "resent", "manual_shared"].includes(shareState)) {
          return null;
        }
        return diffHours(latestReport.reviewedAt ?? latestReport.createdAt, latestReport.sentAt);
      })
      .filter((value): value is number => typeof value === "number");
    const averageTimeToShareHours =
      shareDurations.length > 0
        ? Number((shareDurations.reduce((sum, value) => sum + value, 0) / shareDurations.length).toFixed(1))
        : null;
    return {
      reportUncreated,
      reviewWait,
      shareWait,
      sent,
      manualShare,
      delivered,
      resent,
      failedBounced,
      averageTimeToShareHours,
      measuredShares: shareDurations.length,
    };
  }, [enriched]);

  const interviewHref = queue.find((item) => item.queue.kind === "interview")?.queue.href ?? "/app/students";

  return (
    <div className={styles.page}>
      <AppHeader
        title="今日の優先キュー"
        subtitle="今すぐ対応が必要な生徒だけを前に出します。ここでは読むより先に、動き始めることを優先します。"
      />

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>今日やること</p>
          <h2 className={styles.heroTitle}>押すのは1回。あとは成果物が順に増える。</h2>
          <p className={styles.heroText}>
            面談と保護者レポートのうち、いま最優先の仕事だけをここに並べます。
          </p>
        </div>
        <div className={styles.heroActions}>
          <Link href={interviewHref}>
            <Button className={styles.heroButton}>面談を始める</Button>
          </Link>
        </div>
      </section>

      <section className={styles.statusStrip}>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>レポート未作成</span>
          <strong>{stats.reportUncreated}</strong>
        </div>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>レビュー待ち</span>
          <strong>{stats.reviewWait}</strong>
        </div>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>共有待ち</span>
          <strong>{stats.shareWait}</strong>
        </div>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>送付済み</span>
          <strong>{stats.sent}</strong>
        </div>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>手動共有</span>
          <strong>{stats.manualShare}</strong>
        </div>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>配達済み</span>
          <strong>{stats.delivered}</strong>
        </div>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>再送</span>
          <strong>{stats.resent}</strong>
        </div>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>送信失敗</span>
          <strong>{stats.failedBounced}</strong>
        </div>
      </section>

      {canInvite ? (
        <Card
          title="ユーザーを招待"
          subtitle="公開サインアップはありません。管理者・室長が招待リンクを発行し、相手に初回パスワードを設定してもらいます。"
        >
          <div className={styles.inviteRow}>
            <input
              className={styles.inviteInput}
              type="email"
              placeholder="招待するメールアドレス"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <Button
              onClick={async () => {
                setInviteBusy(true);
                setInviteMessage(null);
                try {
                  const res = await fetch("/api/invitations", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: inviteEmail, role: "TEACHER" }),
                  });
                  const body = await res.json();
                  if (!res.ok) {
                    setInviteMessage(body?.error ?? "招待の作成に失敗しました。");
                    return;
                  }
                  setInviteMessage(`招待 URL を発行しました。相手にそのまま共有してください。\n${body.inviteUrl ?? ""}`);
                  setInviteEmail("");
                } catch {
                  setInviteMessage("通信に失敗しました。");
                } finally {
                  setInviteBusy(false);
                }
              }}
              disabled={inviteBusy || !inviteEmail.trim()}
            >
              {inviteBusy ? "作成中..." : "招待リンクを作成"}
            </Button>
          </div>
          {inviteMessage ? <p className={styles.inviteMessage}>{inviteMessage}</p> : null}
        </Card>
      ) : null}

      <Card
        title="今日の優先キュー"
        subtitle="最初の 5〜8 件だけ見れば、その日の主要な仕事を始められる状態にします。"
      >
        {error && <div className={styles.error}>{error}</div>}
        {loading ? (
          <div className={styles.empty}>読み込み中です。</div>
        ) : queue.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>今日の優先対応はありません</strong>
            <p>新しい面談を始めるなら、全生徒一覧から対象の生徒を開いてください。</p>
            <Link href="/app/students">
              <Button>全生徒を見る</Button>
            </Link>
          </div>
        ) : (
          <div className={styles.queueList}>
            {queue.map((item) => (
              <div key={item.id} className={styles.queueRow}>
                <div className={styles.queueIdentity}>
                  <div className={styles.queueNameRow}>
                    <strong className={styles.queueName}>{item.name}</strong>
                    {item.grade ? <span className={styles.queueMeta}>{item.grade}</span> : null}
                    <Badge label={item.state} tone={item.queue.kind === "share" ? "high" : "medium"} />
                    {item.recordingLock ? (
                      <Badge
                        label={`${item.recordingLock.lockedByName} 録音中`}
                        tone="high"
                      />
                    ) : null}
                  </div>
                  <p className={styles.queueOneLiner}>{item.oneLiner}</p>
                </div>
                <div className={styles.queueReasonBlock}>
                  <div className={styles.queueTitle}>{item.queue.title}</div>
                  <p className={styles.queueReason}>{item.queue.reason}</p>
                </div>
                <div className={styles.queueActionBlock}>
                  <Link href={item.queue.href}>
                    <Button>{item.queue.cta}</Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className={styles.lowerGrid}>
        <Card
          title="次に確認すること"
          subtitle="生成済みの内容を読む前に、どこで止まっているかだけ分かれば十分です。"
        >
          <div className={styles.miniList}>
            <div className={styles.miniItem}>
              <strong>レポート未作成</strong>
              <span>{stats.reportUncreated} 人</span>
            </div>
            <div className={styles.miniItem}>
              <strong>レビュー待ち</strong>
              <span>{stats.reviewWait} 人</span>
            </div>
            <div className={styles.miniItem}>
              <strong>共有待ち</strong>
              <span>{stats.shareWait} 人</span>
            </div>
            <div className={styles.miniItem}>
              <strong>送付済み</strong>
              <span>{stats.sent} 人</span>
            </div>
            <div className={styles.miniItem}>
              <strong>手動共有</strong>
              <span>{stats.manualShare} 件</span>
            </div>
            <div className={styles.miniItem}>
              <strong>送信失敗</strong>
              <span>{stats.failedBounced} 件</span>
            </div>
            <div className={styles.miniItem}>
              <strong>平均共有時間</strong>
              <span>
                {stats.averageTimeToShareHours !== null ? `${stats.averageTimeToShareHours} 時間` : "まだ算出なし"}
              </span>
            </div>
          </div>
        </Card>

        <Card
          title="全体の状態"
          subtitle="今日の運用と共有速度の輪郭だけを、朝いちで把握できるようにします。"
        >
          <div className={styles.directorySummary}>
            <div>
              <div className={styles.summaryLabel}>登録生徒</div>
              <div className={styles.summaryValue}>{students.length}</div>
            </div>
            <div>
              <div className={styles.summaryLabel}>平均プロフィール充足</div>
              <div className={styles.summaryValue}>
                {students.length > 0
                  ? Math.round(
                      enriched.reduce((acc, item) => acc + item.completeness, 0) /
                        Math.max(1, enriched.length)
                    )
                  : 0}
                %
              </div>
            </div>
            <div>
              <div className={styles.summaryLabel}>平均 time-to-share</div>
              <div className={styles.summaryValue}>
                {stats.averageTimeToShareHours !== null ? `${stats.averageTimeToShareHours}h` : "-"}
              </div>
            </div>
          </div>
          <p className={styles.summaryNote}>
            {stats.measuredShares > 0
              ? `最新の共有完了 ${stats.measuredShares} 件をもとに、レビュー完了から共有完了までの平均時間を計測しています。`
              : "まだ共有完了データが少ないため、平均 time-to-share はこれから蓄積されます。"}
          </p>
        </Card>
      </div>
    </div>
  );
}
