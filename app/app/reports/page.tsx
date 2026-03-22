"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import styles from "./reportDashboard.module.css";

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
  sessions?: SessionSummary[];
  reports?: ReportSummary[];
  _count?: { sessions: number; reports: number };
};

function reportStatusLabel(status?: string | null) {
  if (!status) return "未生成";
  if (status === "DRAFT") return "下書きあり";
  if (status === "REVIEWED") return "確認済み";
  if (status === "SENT") return "送付済み";
  return "状態確認中";
}

function toneFromStatus(status?: string | null): "neutral" | "low" | "medium" | "high" {
  if (!status) return "medium";
  if (status === "SENT") return "low";
  if (status === "DRAFT") return "medium";
  return "neutral";
}

export default function ReportDashboardPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"draft" | "share" | "sent">("draft");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/students", { cache: "no-store" });
        const body = await res.json();
        if (res.ok) setStudents(body.students ?? []);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const rows = useMemo(() => {
    return students
      .map((student) => {
        const latestReport = student.reports?.[0] ?? null;
        const latestSession = student.sessions?.[0] ?? null;
        return {
          ...student,
          latestReport,
          latestSession,
          statusLabel: reportStatusLabel(latestReport?.status ?? null),
          oneLiner:
            latestSession?.heroOneLiner ?? latestSession?.latestSummary ?? "今月の会話データから下書きを確認できます。",
        };
      })
      .filter((student) => {
        if (filter === "draft") return Boolean(student.latestSession?.conversation?.id) && !student.latestReport;
        if (filter === "share") return Boolean(student.latestReport && student.latestReport.status !== "SENT");
        return Boolean(student.latestReport?.status === "SENT");
      });
  }, [filter, students]);

  const reviewQueue = useMemo(() => {
    return students
      .map((student) => {
        const latestSession = student.sessions?.[0] ?? null;
        const latestReport = student.reports?.[0] ?? null;
        const needsCheckout = latestSession?.status === "COLLECTING";
        const needsReport = Boolean(latestSession?.conversation?.id) && !latestReport;

        if (!latestSession || (!needsCheckout && !needsReport)) {
          return null;
        }

        return {
          id: student.id,
          name: student.name,
          grade: student.grade,
          latestSession,
          latestReport,
          label: needsCheckout ? "授業が途中です" : "レポート未作成です",
          description: needsCheckout
            ? "チェックインまで完了しています。授業後のチェックアウトで指導報告を完成させます。"
            : "ログは生成済みです。必要なログを選んで保護者レポートを作成できます。",
          href: needsCheckout
            ? `/app/students/${student.id}?panel=recording&mode=LESSON_REPORT&part=CHECK_OUT`
            : `/app/students/${student.id}?panel=report`,
          cta: needsCheckout ? "チェックアウトを録る" : "レポートを作る",
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      name: string;
      grade?: string | null;
      latestSession: SessionSummary;
      latestReport: ReportSummary | null;
      label: string;
      description: string;
      href: string;
      cta: string;
    }>;
  }, [students]);

  const counts = useMemo(() => {
    const draft = students.filter((student) => Boolean(student.sessions?.[0]?.conversation?.id) && !student.reports?.[0]).length;
    const share = students.filter((student) => student.reports?.[0] && student.reports[0].status !== "SENT").length;
    const sent = students.filter((student) => student.reports?.[0]?.status === "SENT").length;
    return { draft, share, sent };
  }, [students]);

  return (
    <div className={styles.page}>
      <AppHeader
        title="送付前レビュー"
        subtitle="ここはレポートを作る場所ではなく、送る前の確認を最小コストで回す確認キューです。"
      />

      <section className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>レポート未作成</span>
          <strong>{counts.draft}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>共有待ち</span>
          <strong>{counts.share}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>送付済み</span>
          <strong>{counts.sent}</strong>
        </div>
      </section>

      <section className={styles.filterRow}>
        {[
          { key: "draft", label: "レポート未作成" },
          { key: "share", label: "共有待ち" },
          { key: "sent", label: "送付済み" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.filterChip} ${filter === item.key ? styles.filterChipActive : ""}`}
            onClick={() => setFilter(item.key as typeof filter)}
          >
            {item.label}
          </button>
        ))}
      </section>

      <Card title="保護者レポート確認キュー" subtitle="ここでは状態確認と Student Room への戻り先だけを揃えます。主作業は Student Room で進めます。">
        {loading ? (
          <div className={styles.empty}>読み込み中です。</div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>この条件に当てはまるレポートはありません。</div>
        ) : (
          <div className={styles.grid}>
            {rows.map((student) => (
              <Link key={student.id} href={`/app/students/${student.id}?panel=report`} className={styles.linkCard}>
                <div className={styles.cardHeader}>
                  <div>
                    <div className={styles.name}>{student.name}</div>
                    <div className={styles.meta}>{student.grade ?? "学年未設定"}</div>
                  </div>
                  <Badge label={student.statusLabel} tone={toneFromStatus(student.latestReport?.status ?? null)} />
                </div>

                <p className={styles.oneLiner}>{student.oneLiner}</p>

                <div className={styles.metricGrid}>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>更新元セッション</span>
                    <strong>{student._count?.sessions ?? 0} 件</strong>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>共有状態</span>
                    <strong>{student.latestReport?.status === "SENT" ? "送付済み" : student.latestReport ? "共有待ち" : "未作成"}</strong>
                  </div>
                </div>

                <div className={styles.footer}>
                  <span className={styles.footerLabel}>確認する</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card title="その他の運用キュー" subtitle="授業途中やログ生成後未共有など、止まりやすい項目だけをここに寄せます。">
        {reviewQueue.length === 0 ? (
          <div className={styles.empty}>いま優先して確認する項目はありません。</div>
        ) : (
          <div className={styles.grid}>
            {reviewQueue.map((item) => (
              <Link key={item.id} href={item.href} className={styles.linkCard}>
                <div className={styles.cardHeader}>
                  <div>
                    <div className={styles.name}>{item.name}</div>
                    <div className={styles.meta}>{item.grade ?? "学年未設定"}</div>
                  </div>
                  <Badge label={item.label} tone="medium" />
                </div>

                <p className={styles.oneLiner}>{item.description}</p>

                <div className={styles.metricGrid}>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>セッション種別</span>
                    <strong>{item.latestSession.type === "LESSON_REPORT" ? "指導報告" : "面談"}</strong>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>次にやること</span>
                    <strong>{item.cta}</strong>
                  </div>
                </div>

                <div className={styles.footer}>
                  <span className={styles.footerLabel}>{item.cta}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
