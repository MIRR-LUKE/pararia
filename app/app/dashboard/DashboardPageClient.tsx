import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IntentLink } from "@/components/ui/IntentLink";
import { MetricList } from "@/components/ui/MetricList";
import { StatePanel } from "@/components/ui/StatePanel";
import { StatStrip } from "@/components/ui/StatStrip";
import type { DashboardSnapshot } from "@/lib/students/dashboard-snapshot";
import InviteLinkCard from "./InviteLinkCard";
import styles from "./dashboard.module.css";

type Props = {
  initialData: DashboardSnapshot;
  canInvite: boolean;
  viewerName?: string | null;
  viewerRole?: string | null;
};

export default function DashboardPageClient({ initialData, canInvite, viewerName, viewerRole }: Props) {
  const { queue, stats, totalStudents, candidateCount, averageProfileCompleteness } = initialData;
  const interviewHref = queue.find((item) => item.queue.kind === "interview")?.queue.href ?? "/app/students";
  const isSampled = candidateCount < totalStudents;
  const summaryItems = [
    { label: "レポート未作成", value: stats.reportUncreated },
    { label: "レビュー待ち", value: stats.reviewWait },
    { label: "共有待ち", value: stats.shareWait },
    { label: "送付済み", value: stats.sent },
    { label: "手動共有", value: stats.manualShare },
    { label: "配達済み", value: stats.delivered },
    { label: "再送", value: stats.resent },
    { label: "送信失敗", value: stats.failedBounced },
  ];

  return (
    <div className={styles.page}>
      <AppHeader
        title="今日の優先キュー"
        subtitle="今すぐ対応が必要な生徒だけを前に出します。ここでは読むより先に、動き始めることを優先します。"
        viewerName={viewerName}
        viewerRole={viewerRole}
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
          <IntentLink href={interviewHref}>
            <Button className={styles.heroButton}>面談を始める</Button>
          </IntentLink>
        </div>
      </section>

      <StatStrip items={summaryItems} />

      {canInvite ? <InviteLinkCard /> : null}

      <Card
        title="今日の優先キュー"
        subtitle="最初の 5〜8 件だけ見れば、その日の主要な仕事を始められる状態にします。"
      >
        {queue.length === 0 ? (
          <StatePanel
            kind="empty"
            title="今日の優先対応はありません"
            subtitle="新しい面談を始めるなら、全生徒一覧から対象の生徒を開いてください。"
            action={
              <IntentLink href="/app/students">
                <Button>全生徒を見る</Button>
              </IntentLink>
            }
          />
        ) : (
          <div className={styles.queueList}>
            {queue.map((item) => (
              <div key={item.id} className={styles.queueRow}>
                <div className={styles.queueIdentity}>
                  <div className={styles.queueNameRow}>
                    <strong className={styles.queueName}>{item.name}</strong>
                    {item.grade ? <span className={styles.queueMeta}>{item.grade}</span> : null}
                    <Badge label={item.state} tone={item.queue.kind === "share" ? "high" : "medium"} />
                    {item.recordingLock ? <Badge label={`${item.recordingLock.lockedByName} 録音中`} tone="high" /> : null}
                  </div>
                  <p className={styles.queueOneLiner}>{item.oneLiner}</p>
                </div>
                <div className={styles.queueReasonBlock}>
                  <div className={styles.queueTitle}>{item.queue.title}</div>
                  <p className={styles.queueReason}>{item.queue.reason}</p>
                </div>
                <div className={styles.queueActionBlock}>
                  <IntentLink href={item.queue.href}>
                    <Button>{item.queue.cta}</Button>
                  </IntentLink>
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
          <MetricList
            layout="split"
            items={[
              { label: "レポート未作成", value: `${stats.reportUncreated} 人` },
              { label: "レビュー待ち", value: `${stats.reviewWait} 人` },
              { label: "共有待ち", value: `${stats.shareWait} 人` },
              { label: "送付済み", value: `${stats.sent} 人` },
              { label: "手動共有", value: `${stats.manualShare} 件` },
              { label: "送信失敗", value: `${stats.failedBounced} 件` },
              {
                label: "平均共有時間",
                value: stats.averageTimeToShareHours !== null ? `${stats.averageTimeToShareHours} 時間` : "まだ算出なし",
              },
            ]}
          />
        </Card>

        <Card
          title="全体の状態"
          subtitle="今日の運用と共有速度の輪郭だけを、朝いちで把握できるようにします。"
        >
          <MetricList
            layout="split"
            items={[
              { label: "登録生徒", value: totalStudents },
              { label: "平均プロフィール充足", value: `${averageProfileCompleteness}%` },
              {
                label: "平均 time-to-share",
                value: stats.averageTimeToShareHours !== null ? `${stats.averageTimeToShareHours}h` : "-",
              },
            ]}
          />
          <p className={styles.summaryNote}>
            {stats.measuredShares > 0
              ? `共有完了 ${stats.measuredShares} 件をもとに、レビュー完了から共有完了までの平均時間を計測しています。${
                  isSampled ? ` なお、軽量化のため直近 ${candidateCount} 人を優先候補として集計しています。` : ""
                }`
              : isSampled
                ? `軽量化のため直近 ${candidateCount} 人を優先候補として集計しています。共有完了データが増えると平均 time-to-share を表示します。`
                : "まだ共有完了データが少ないため、平均 time-to-share はこれから蓄積されます。"}
          </p>
        </Card>
      </div>
    </div>
  );
}
