"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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
  status: string;
  createdAt: string;
  sentAt?: string | null;
};

type StudentRow = {
  id: string;
  name: string;
  grade?: string | null;
  course?: string | null;
  profiles?: Array<{ profileData?: any }>;
  sessions?: SessionSummary[];
  reports?: ReportSummary[];
  _count?: { sessions: number; reports: number };
  recordingLock?: { mode: string; lockedByName: string } | null;
};

type QueueKind = "interview" | "lesson" | "report" | "share" | "room";

type QueueItem = {
  student: StudentRow;
  kind: QueueKind;
  title: string;
  reason: string;
  cta: string;
  href: string;
  score: number;
};

function completeness(profileData?: any) {
  const basic = Array.isArray(profileData?.basic) ? profileData.basic.length : 0;
  const personal = Array.isArray(profileData?.personal) ? profileData.personal.length : 0;
  return Math.min(100, (basic + personal) * 6);
}

function summarize(student: StudentRow) {
  const latestSession = student.sessions?.[0];
  const latestReport = student.reports?.[0];

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

  if (latestSession.type === "LESSON_REPORT" && latestSession.status === "COLLECTING") {
    return {
      state: latestSession.heroStateLabel ?? "授業途中",
      oneLiner:
        latestSession.heroOneLiner ?? "授業前の記録だけ保存されています。授業後の記録で完了します。",
      queue: {
        kind: "lesson" as const,
        title: "チェックアウト待ち",
        reason: "授業前チェックインは完了しています。授業後の録音で指導報告を完成できます。",
        cta: "チェックアウトを録る",
        href: `/app/students/${student.id}?panel=recording&mode=LESSON_REPORT&part=CHECK_OUT`,
        score: 95,
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

  if (latestReport && latestReport.status !== "SENT") {
    return {
      state: latestSession.heroStateLabel ?? "共有待ち",
      oneLiner:
        latestSession.heroOneLiner ?? latestSession.latestSummary ?? "保護者レポートは下書き済みです。確認して共有まで進められます。",
      queue: {
        kind: "share" as const,
        title: "共有待ち",
        reason: "保護者レポートは作成済みです。共有まで完了させます。",
        cta: "共有を進める",
        href: `/app/students/${student.id}?panel=report`,
        score: 82,
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
        const res = await fetch("/api/students", { cache: "no-store" });
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
        completeness: completeness(student.profiles?.[0]?.profileData),
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
    const interview = enriched.filter((item) => item.queue.kind === "interview").length;
    const lesson = enriched.filter((item) => item.queue.kind === "lesson").length;
    const report = enriched.filter((item) => item.queue.kind === "report").length;
    const share = enriched.filter((item) => item.queue.kind === "share").length;
    return { interview, lesson, report, share };
  }, [enriched]);

  const interviewHref = queue.find((item) => item.queue.kind === "interview")?.queue.href ?? "/app/students";
  const lessonHref = queue.find((item) => item.queue.kind === "lesson")?.queue.href ?? "/app/students";

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
            面談、授業、保護者レポートのうち、いま最優先の仕事だけをここに並べます。
          </p>
        </div>
        <div className={styles.heroActions}>
          <Link href={interviewHref}>
            <Button className={styles.heroButton}>面談を始める</Button>
          </Link>
          <Link href={lessonHref}>
            <Button variant="secondary" className={styles.heroButtonSecondary}>授業を始める</Button>
          </Link>
        </div>
      </section>

      <section className={styles.statusStrip}>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>面談未実施</span>
          <strong>{stats.interview}</strong>
        </div>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>チェックアウト待ち</span>
          <strong>{stats.lesson}</strong>
        </div>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>レポート未作成</span>
          <strong>{stats.report}</strong>
        </div>
        <div className={styles.statusItem}>
          <span className={styles.statusLabel}>共有待ち</span>
          <strong>{stats.share}</strong>
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
            <p>新しい面談や授業を始めるなら、全生徒一覧から対象の生徒を開いてください。</p>
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
              <strong>面談未実施</strong>
              <span>{stats.interview} 人</span>
            </div>
            <div className={styles.miniItem}>
              <strong>授業後の録音待ち</strong>
              <span>{stats.lesson} 人</span>
            </div>
            <div className={styles.miniItem}>
              <strong>レポート未作成</strong>
              <span>{stats.report} 人</span>
            </div>
            <div className={styles.miniItem}>
              <strong>共有待ち</strong>
              <span>{stats.share} 人</span>
            </div>
          </div>
        </Card>

        <Card
          title="全体の状態"
          subtitle="詳細なKPIではなく、今日の運用を止めるものだけ静かに出します。"
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
          </div>
        </Card>
      </div>
    </div>
  );
}
