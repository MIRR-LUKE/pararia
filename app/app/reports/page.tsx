import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { StatePanel } from "@/components/ui/StatePanel";
import { StatStrip } from "@/components/ui/StatStrip";
import { getAppSession } from "@/lib/server/app-session";
import { getCachedStudentDirectory } from "@/lib/students/get-cached-student-directory";
import { ReportsSectionCard } from "./ReportsSectionCard";
import styles from "./reportDashboard.module.css";
import {
  buildFilterHref,
  buildReportDashboardData,
  normalizeFilter,
  type FilterKey,
} from "./report-dashboard";

function readQueryParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const filterLabels: Record<FilterKey, string> = {
  all: "すべて",
  uncreated: "未作成",
  review: "レビュー待ち",
  share: "共有待ち",
  sent: "送信済み",
  manual: "手動共有",
  delayed: "遅延",
};

function sectionToneLabel(filter: FilterKey) {
  if (filter === "all") return "全件";
  return filterLabels[filter];
}

function rowFilterText(filter: FilterKey) {
  if (filter === "all") {
    return "未作成、レビュー待ち、共有待ち、送信済み、手動共有、遅延をまとめて見られます。";
  }
  return `${filterLabels[filter]} に絞っています。`;
}

export default async function ReportDashboardPage({
  searchParams,
}: {
  searchParams?: { filter?: string | string[] };
}) {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const filter = normalizeFilter(readQueryParam(searchParams?.filter));
  const students = await getCachedStudentDirectory({
    organizationId,
    limit: 200,
  });

  const { rows, queue, delayedQueue, counts } = buildReportDashboardData(students, filter);
  const showResetFilter = filter !== "all";
  const summaryItems = [
    { label: "未作成", value: counts.uncreated, detail: "会話はあるがレポートがまだありません。" },
    { label: "レビュー待ち", value: counts.review, detail: "本文確認の順番に入っています。" },
    { label: "共有待ち", value: counts.share, detail: "送信前の最終チェックが必要です。" },
    { label: "送信済み", value: counts.sent, detail: "保護者へ配信済みです。" },
    { label: "手動共有", value: counts.manual, detail: "個別対応で完了したものです。" },
    { label: "要確認", value: counts.delayed + counts.failedBounced, detail: "遅延と失敗をまとめて追います。" },
  ];

  return (
    <div className={styles.page}>
      <AppHeader
        title="保護者レポート"
        subtitle="未作成 / レビュー待ち / 共有待ち / 送信済み / 手動共有 / 要確認 を一目で切り分けます。"
        viewerName={session.user.name ?? null}
        viewerRole={(session.user as { role?: string | null }).role ?? null}
      />

      <StatStrip items={summaryItems} />

      <section className={styles.filterRow} aria-label="レポートの絞り込み">
        {(Object.keys(filterLabels) as FilterKey[]).map((key) => (
          <Link
            key={key}
            href={buildFilterHref(key)}
            className={filter === key ? styles.filterChipActive : styles.filterChip}
          >
            {filterLabels[key]}
          </Link>
        ))}
      </section>

      <ReportsSectionCard
        title="保護者レポート一覧"
        subtitle={`${
          filter === "all" ? "全件" : sectionToneLabel(filter)
        }を、ワークフロー / 配信状態 / source trace で見分けます。`}
      >
        {rows.length === 0 ? (
          <StatePanel
            kind="empty"
            title="この条件に合うレポートはありません"
            subtitle={rowFilterText(filter)}
            action={
              showResetFilter ? (
                <Link href="/app/reports" className={styles.stateLink}>
                  すべてのレポートに戻る
                </Link>
              ) : null
            }
          />
        ) : (
          <div className={styles.grid}>
            {rows.map((student, index) => (
              <Link
                key={student.id}
                href={`/app/students/${student.id}?panel=report`}
                className={styles.linkCard}
                prefetch={index < 4}
              >
                <div className={styles.cardHeader}>
                  <div className={styles.identity}>
                    <div className={styles.name}>{student.name}</div>
                    <div className={styles.meta}>
                      {student.grade ?? "学年未設定"} · {student.sessionLabel}
                    </div>
                  </div>
                  <div className={styles.badgeRow}>
                    <Badge label={student.workflowLabel} tone={student.tone} />
                    {student.deliveryLabel !== student.workflowLabel ? (
                      <Badge label={student.deliveryLabel} tone={student.secondaryTone} />
                    ) : null}
                  </div>
                </div>

                <p className={styles.oneLiner}>{student.oneLiner}</p>

                <div className={styles.metricGrid}>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>ログ数</span>
                    <strong>{student.reportSourceCount} 件</strong>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>最終更新</span>
                    <strong>{student.updatedLabel}</strong>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>共有状態</span>
                    <strong>{student.deliveryLabel}</strong>
                  </div>
                </div>

                <div className={styles.traceBox}>
                  <span className={styles.metricLabel}>source trace</span>
                  <p className={styles.traceSummary}>{student.sourceTraceLabel}</p>
                  <div className={styles.traceChips} aria-label="選択した source trace">
                    {student.reportSourceCount === 0 ? (
                      <span className={styles.traceChip}>選択なし</span>
                    ) : (
                      student.sourceTraceDetail.split(" / ").map((part) => (
                        <span key={part} className={styles.traceChip}>
                          {part}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div className={styles.footer}>
                  <span className={styles.footerLabel}>Student Room で確認する</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </ReportsSectionCard>

      <ReportsSectionCard
        title="処理中キュー"
        subtitle={`いま触る候補を優先順に並べています。${counts.processing} 件の処理対象があります。`}
      >
        {queue.length === 0 ? (
          <StatePanel
            kind="processing"
            title="処理中のレポートはありません"
            subtitle="レビュー待ちや共有待ちが出てきたら、この場所に並びます。"
          />
        ) : (
          <div className={styles.grid}>
            {queue.map((item, index) => (
              <Link key={item.id} href={item.href} className={styles.linkCard} prefetch={index < 4}>
                <div className={styles.cardHeader}>
                  <div className={styles.identity}>
                    <div className={styles.name}>{item.name}</div>
                    <div className={styles.meta}>{item.grade ?? "学年未設定"}</div>
                  </div>
                  <Badge label={item.label} tone={item.tone} />
                </div>

                <p className={styles.oneLiner}>{item.description}</p>

                <div className={styles.metricGrid}>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>最新状態</span>
                    <strong>{item.latestDeliveryLabel}</strong>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>最終更新</span>
                    <strong>{item.updatedLabel}</strong>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>source trace</span>
                    <strong>{item.reportSourceCount} 件</strong>
                  </div>
                </div>

                <div className={styles.traceBox}>
                  <span className={styles.metricLabel}>source trace</span>
                  <p className={styles.traceSummary}>{item.sourceTraceLabel}</p>
                  <div className={styles.traceChips} aria-label="選択した source trace">
                    {item.reportSourceCount === 0 ? (
                      <span className={styles.traceChip}>選択なし</span>
                    ) : (
                      item.sourceTraceDetail.split(" / ").map((part) => (
                        <span key={part} className={styles.traceChip}>
                          {part}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div className={styles.footer}>
                  <span className={styles.footerLabel}>{item.cta}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </ReportsSectionCard>

      <ReportsSectionCard title="遅延ハイライト" subtitle="24時間以上止まっているものだけを、先に拾えるようにしています。">
        {delayedQueue.length === 0 ? (
          <StatePanel
            kind="empty"
            title="遅延中のレポートはありません"
            subtitle="いまは詰まりがないので、通常の処理キューだけ見れば大丈夫です。"
          />
        ) : (
          <div className={styles.grid}>
            {delayedQueue.map((item, index) => (
              <Link key={item.id} href={item.href} className={styles.linkCard} prefetch={index < 4}>
                <div className={styles.cardHeader}>
                  <div className={styles.identity}>
                    <div className={styles.name}>{item.name}</div>
                    <div className={styles.meta}>{item.grade ?? "学年未設定"}</div>
                  </div>
                  <Badge label="遅延" tone="high" />
                </div>

                <p className={styles.oneLiner}>{item.description}</p>

                <div className={styles.metricGrid}>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>最新状態</span>
                    <strong>{item.latestDeliveryLabel}</strong>
                  </div>
                  <div className={styles.metricItem}>
                    <span className={styles.metricLabel}>最終更新</span>
                    <strong>{item.updatedLabel}</strong>
                  </div>
                </div>

                <div className={styles.traceBox}>
                  <span className={styles.metricLabel}>source trace</span>
                  <p className={styles.traceSummary}>{item.sourceTraceLabel}</p>
                  <div className={styles.traceChips} aria-label="選択した source trace">
                    {item.reportSourceCount === 0 ? (
                      <span className={styles.traceChip}>選択なし</span>
                    ) : (
                      item.sourceTraceDetail.split(" / ").map((part) => (
                        <span key={part} className={styles.traceChip}>
                          {part}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div className={styles.footer}>
                  <span className={styles.footerLabel}>{item.cta}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </ReportsSectionCard>
    </div>
  );
}
