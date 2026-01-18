"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  getConversationsByStudentId,
  getProfileCompleteness,
  getReportByStudentId,
  students,
} from "@/lib/mockData";
import styles from "./reportDashboard.module.css";

type ReportCard = {
  id: string;
  name: string;
  grade: string;
  teacher: string;
  lastSent?: string;
  total: number;
  lastConversation?: string;
  conversationCount?: number;
  completeness?: number;
};

type CycleOption = { label: string; days: number };

const cycleOptions: CycleOption[] = [
  { label: "2週間ごと", days: 14 },
  { label: "3週間ごと", days: 21 },
  { label: "4週間ごと", days: 28 },
];

function analyzeStatus(lastSent: string | undefined, cycleDays: number) {
  if (!lastSent) {
    return {
      statusLabel: "未送信",
      tone: "high" as const,
      nextDueLabel: "すぐ送付",
      overdue: true,
      dueSoon: true,
    };
  }
  const last = new Date(lastSent);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  const nextDue = new Date(last);
  nextDue.setDate(nextDue.getDate() + cycleDays);
  const nextDueLabel = nextDue.toISOString().slice(0, 10);
  const remaining = cycleDays - diffDays;
  if (remaining <= 0) {
    return {
      statusLabel: "送付遅延",
      tone: "high" as const,
      nextDueLabel: `期限: ${nextDueLabel}`,
      overdue: true,
      dueSoon: false,
    };
  }
  if (remaining <= 5) {
    return {
      statusLabel: "もうすぐ送付",
      tone: "medium" as const,
      nextDueLabel: `期限: ${nextDueLabel}`,
      overdue: false,
      dueSoon: true,
    };
  }
  return {
    statusLabel: "送付済",
    tone: "low" as const,
    nextDueLabel: `次回目安: ${nextDueLabel}`,
    overdue: false,
    dueSoon: false,
  };
}

export default function ReportDashboardPage() {
  const [cycle, setCycle] = useState<CycleOption>(cycleOptions[1]);

  const cards: ReportCard[] = students.map((s) => {
    const reports = getReportByStudentId(s.id);
    const lastSent = reports[0]?.date;
    const logs = getConversationsByStudentId(s.id).sort((a, b) =>
      a.date < b.date ? 1 : -1
    );
    const lastLog = logs[0];
    return {
      id: s.id,
      name: s.name,
      grade: s.grade,
      teacher: s.teacher,
      lastSent,
      total: reports.length,
      lastConversation: lastLog?.date,
      conversationCount: logs.length,
      completeness: getProfileCompleteness(s.profile),
    };
  });

  const enriched = useMemo(
    () =>
      cards.map((card) => {
        const status = analyzeStatus(card.lastSent, cycle.days);
        return { ...card, status };
      }),
    [cards, cycle.days]
  );

  const unsent = enriched.filter((c) => c.status.overdue).length;
  const dueSoon = enriched.filter((c) => c.status.dueSoon && !c.status.overdue).length;
  const sentThisMonth = enriched.filter((c) => c.lastSent?.startsWith("2025-11")).length;

  return (
    <div className={styles.page}>
      <AppHeader
        title="保護者レポートダッシュボード"
        subtitle="前回レポ以降のログを自動選択し、ワンタッチでPDF/Markdownを生成"
      />

      <div className={styles.controlRow}>
        <div className={styles.controlLabel}>レポート送信サイクル</div>
        <select
          className={styles.select}
          value={cycle.days}
          onChange={(e) => {
            const days = Number(e.target.value);
            const option = cycleOptions.find((c) => c.days === days) ?? cycleOptions[1];
            setCycle(option);
          }}
        >
          {cycleOptions.map((opt) => (
            <option key={opt.days} value={opt.days}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className={styles.controlNote}>設定したサイクルで「遅延／要送付」を自動判定</div>
      </div>

      <div className={styles.statsRow}>
        <Card>
          <div className={styles.statLabel}>対象生徒</div>
          <div className={styles.statValue}>{cards.length}名</div>
        </Card>
        <Card>
          <div className={styles.statLabel}>遅延・未送信</div>
          <div className={styles.statValue} style={{ color: "#dc2626" }}>
            {unsent}名
          </div>
        </Card>
        <Card>
          <div className={styles.statLabel}>送付期限が近い</div>
          <div className={styles.statValue} style={{ color: "#f59e0b" }}>
            {dueSoon}名
          </div>
        </Card>
        <Card>
          <div className={styles.statLabel}>今月送付済み</div>
          <div className={styles.statValue} style={{ color: "#2563eb" }}>
            {sentThisMonth}名
          </div>
        </Card>
      </div>

      <Card title="📋 生徒別レポート状況" subtitle="カードをクリックすると作成・編集ページへ">
        <div className={styles.grid}>
          {enriched.map((card) => (
            <Link key={card.id} href={`/app/reports/${card.id}`} className={styles.linkCard}>
              <div className={styles.cardHeader}>
                <div className={styles.headerMain}>
                  <div className={styles.name}>{card.name}</div>
                  <div className={styles.meta}>
                    {card.grade} / 担当: {card.teacher}
                  </div>
                </div>
                <div className={styles.headerSide}>
                  <Badge label={card.status.statusLabel} tone={card.status.tone} />
                  <div className={styles.smallMuted}>{card.status.nextDueLabel}</div>
                </div>
              </div>

              <div className={styles.metricGrid}>
                <div className={styles.metricItem}>
                  <div className={styles.metricLabel}>最終会話</div>
                  <div className={styles.metricValue}>{card.lastConversation ?? "未会話"}</div>
                </div>
                <div className={styles.metricItem}>
                  <div className={styles.metricLabel}>会話ログ</div>
                  <div className={styles.metricValue}>{card.conversationCount ?? 0}件</div>
                </div>
                <div className={styles.metricItem}>
                  <div className={styles.metricLabel}>カルテ充実度</div>
                  <div className={styles.metricValue}>{card.completeness ?? 0}%</div>
                </div>
                <div className={styles.metricItem}>
                  <div className={styles.metricLabel}>累計レポート</div>
                  <div className={styles.metricValue}>{card.total}件</div>
                </div>
              </div>

              <div className={styles.cardFooter}>
                <div className={styles.footerLeft}>
                  <span className={styles.cyclePill}>{cycle.label}</span>
                  {card.lastSent ? (
                    <span className={styles.smallMuted}>前回: {card.lastSent}</span>
                  ) : (
                    <span className={styles.smallMuted}>前回: 未送信</span>
                  )}
                </div>
                <div className={styles.footerRight}>
                  {(card.status.overdue || card.status.dueSoon || card.total === 0) && (
                    <span className={styles.alert}>
                      {card.total === 0 ? "未送信" : card.status.statusLabel}
                    </span>
                  )}
                  <span className={styles.primaryCta}>ワンタッチ生成 →</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
