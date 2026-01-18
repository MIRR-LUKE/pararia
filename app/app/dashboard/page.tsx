import { useMemo } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { Button } from "@/components/ui/Button";
import {
  conversationLogTrend,
  getConversationsByStudentId,
  getProfileCompleteness,
  motivationDistribution,
  students,
} from "@/lib/mockData";
import styles from "./dashboard.module.css";
import { Progress } from "@/components/ui/Progress";
import Link from "next/link";

function daysSince(dateStr?: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export default function DashboardPage() {
  const enriched = useMemo(() => {
    return students.map((s) => {
      const logs = getConversationsByStudentId(s.id).sort((a, b) =>
        a.date < b.date ? 1 : -1
      );
      const last = logs[0];
      return {
        ...s,
        conversationCount: logs.length,
        lastConversationDate: last?.date ?? "",
        daysSinceLast: last ? daysSince(last.date) : null,
        completeness: getProfileCompleteness(s.profile),
      };
    });
  }, []);

  const conversationsThisWeek = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(now.getDate() - 6);
    return enriched.reduce((acc, s) => {
      const logs = getConversationsByStudentId(s.id);
      return (
        acc +
        logs.filter((l) => {
          const d = new Date(l.date);
          return d >= cutoff && d <= now;
        }).length
      );
    }, 0);
  }, [enriched]);

  const dormant = enriched.filter((s) => (s.daysSinceLast ?? Infinity) > 14).length;
  const avgCompleteness =
    enriched.reduce((acc, s) => acc + (s.completeness ?? 0), 0) / (enriched.length || 1);

  const followPriority = [...enriched]
    .sort((a, b) => (b.daysSinceLast ?? -1) - (a.daysSinceLast ?? -1))
    .slice(0, 8);

  const kpis = [
    { label: "在籍生徒数", value: students.length },
    { label: "今週の会話ログ", value: conversationsThisWeek },
    { label: "要フォロー(14日超)", value: dormant },
    { label: "カルテ充実度(平均)", value: `${Math.round(avgCompleteness)}%` },
  ];

  return (
    <div>
      <AppHeader
        title="ダッシュボード"
        subtitle="会話ログ蓄積を軸に、フォロー優先度とレポート生成を一目で確認"
        actions={
          <div className={styles.actionRow}>
            <Link href="/app/students">
              <Button variant="primary" size="small">
                録音して会話ログを追加
              </Button>
            </Link>
            <Link href="/app/reports">
              <Button variant="secondary" size="small">
                ワンタッチで保護者レポート
              </Button>
            </Link>
          </div>
        }
      />

      <div className={styles.hero}>
        <div className={styles.heroCard}>
          <h2 className={styles.heroTitle}>🧭 今日の優先フォロー</h2>
          <p className={styles.heroText}>
            「最終会話が古い」「会話ログが少ない」「カルテ充実度が低い」順にフォロー。
          </p>
          <div className={styles.iconRow}>
            <span>🎙 録音→構造化→カルテ更新</span>
            <span>📄 ワンタッチ保護者レポート</span>
            <span>🧩 カルテ充実度アップ</span>
          </div>
          <div className={styles.miniGrid}>
            <Badge label={`要フォロー ${dormant}名`} tone="high" />
            <Badge label={`今週の会話 ${conversationsThisWeek}件`} tone="medium" />
            <Badge label={`カルテ充実度 平均 ${Math.round(avgCompleteness)}%`} tone="low" />
          </div>
        </div>
        <Card title="📊 サマリー">
          <div style={{ display: "grid", gap: 8 }}>
            {kpis.map((kpi) => (
              <div key={kpi.label} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{kpi.label}</span>
                <strong>{kpi.value}</strong>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className={styles.grid}>
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>{kpi.label}</span>
              <span className={styles.kpiValue}>{kpi.value}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className={styles.chartGrid}>
        <Card title="会話ログ数推移（過去6ヶ月）">
          <LineChart data={conversationLogTrend} />
        </Card>
        <Card title="会話量分布（モチベ指標として補助）">
          <BarChart data={motivationDistribution} />
        </Card>
      </div>

      <Card
        title="フォロー優先（最終会話が古い順）"
        subtitle="離塾リスク指標は使いません。会話空白とカルテ充実度で優先度を決めます。"
      >
        <div className={`${styles.row} ${styles.heading}`}>
          <div>生徒名</div>
          <div>学年</div>
          <div>会話ログ</div>
          <div>カルテ充実度</div>
          <div>最終会話</div>
          <div>操作</div>
        </div>
        <div className={styles.list}>
          {followPriority.map((student) => (
            <div key={student.id} className={styles.row}>
              <div style={{ fontWeight: 700 }}>{student.name}</div>
              <div>{student.grade}</div>
              <div>{student.conversationCount ?? 0}件</div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span>{student.completeness ?? 0}%</span>
                  <Progress value={student.completeness ?? 0} />
                </div>
              </div>
              <div>
                {student.lastConversationDate || "未会話"}
                <div className={styles.subtext}>
                  {student.daysSinceLast != null ? `${student.daysSinceLast} 日前` : "―"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link href={`/app/students/${student.id}#record`}>
                  <Button size="small" variant="primary">
                    録音して追加
                  </Button>
                </Link>
                <Link href={`/app/students/${student.id}#report`}>
                  <Button size="small" variant="secondary">
                    レポート生成
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
