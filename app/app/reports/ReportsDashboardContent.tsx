import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { StatePanel } from "@/components/ui/StatePanel";
import { StatStrip } from "@/components/ui/StatStrip";
import { getAppSession } from "@/lib/server/app-session";
import { getCachedStudentDirectory } from "@/lib/students/get-cached-student-directory";
import { ReportsSectionCard } from "./ReportsSectionCard";
import styles from "./reportDashboard.module.css";
import {
  buildPageHref,
  buildPaginationWindow,
  buildReportDashboardData,
  type FilterKey,
} from "./report-dashboard";

function ReportPager({
  filter,
  page,
  totalPages,
  totalItems,
  startIndex,
  endIndex,
}: {
  filter: FilterKey;
  page: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
}) {
  if (totalPages <= 1) {
    return (
      <div className={styles.pager}>
        <span className={styles.pagerMeta}>{totalItems} 件をまとめて表示しています。</span>
      </div>
    );
  }

  return (
    <div className={styles.pager}>
      <span className={styles.pagerMeta}>
        {startIndex + 1}-{endIndex} 件 / {totalItems} 件
      </span>
      <div className={styles.pagerActions} aria-label="レポートのページ切り替え">
        {page > 1 ? (
          <Link href={buildPageHref(filter, page - 1)} className={styles.pagerLink}>
            前へ
          </Link>
        ) : (
          <span className={styles.pagerLinkDisabled}>前へ</span>
        )}
        <span className={styles.pagerPage}>
          {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={buildPageHref(filter, page + 1)} className={styles.pagerLink}>
            次へ
          </Link>
        ) : (
          <span className={styles.pagerLinkDisabled}>次へ</span>
        )}
      </div>
    </div>
  );
}

export async function ReportsDashboardContent({ filter, page }: { filter: FilterKey; page: number }) {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const pageSize = 18;
  const students = await getCachedStudentDirectory({
    organizationId,
    limit: 200,
  });

  const { rows, queue, delayedQueue, counts } = buildReportDashboardData(students, filter);
  const pagination = buildPaginationWindow(rows.length, page, pageSize);
  const visibleRows = rows.slice(pagination.startIndex, pagination.endIndex);

  const summaryItems = [
    { label: "未作成", value: counts.uncreated, detail: "会話はあるがレポートがまだありません。" },
    { label: "レビュー待ち", value: counts.review, detail: "本文確認の順番に入っています。" },
    { label: "共有待ち", value: counts.share, detail: "送信前の最終チェックが必要です。" },
    { label: "送信済み", value: counts.sent, detail: "保護者へ配信済みです。" },
    { label: "手動共有", value: counts.manual, detail: "個別対応で完了したものです。" },
    { label: "要確認", value: counts.delayed + counts.failedBounced, detail: "遅延と失敗をまとめて追います。" },
  ];

  const sectionToneLabel = (value: FilterKey) => (value === "all" ? "全件" : filterLabels[value]);
  const rowFilterText = (value: FilterKey) => {
    if (value === "all") {
      return "未作成、レビュー待ち、共有待ち、送信済み、手動共有、遅延をまとめて見られます。";
    }
    return `${filterLabels[value]} に絞っています。`;
  };

  const showResetFilter = filter !== "all";

  return (
    <>
      <StatStrip items={summaryItems} />

      <ReportsSectionCard
        title="保護者レポート一覧"
        subtitle={`${filter === "all" ? "全件" : sectionToneLabel(filter)}を、要約 → 状態 → 配信の順で見分けます。`}
        action={
          <ReportPager
            filter={filter}
            page={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={rows.length}
            startIndex={pagination.startIndex}
            endIndex={pagination.endIndex}
          />
        }
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
          <>
            <div className={styles.listSummary}>
              <span className={styles.listSummaryLabel}>表示中</span>
              <strong>
                {pagination.startIndex + 1}-{pagination.endIndex} 件
              </strong>
              <span className={styles.listSummaryMeta}>要約を先に見て、必要なら次ページで追えます。</span>
            </div>

            <div className={styles.grid}>
              {visibleRows.map((student, index) => (
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
                      <span className={styles.metricLabel}>最終更新</span>
                      <strong>{student.updatedLabel}</strong>
                    </div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>共有状態</span>
                      <strong>{student.deliveryLabel}</strong>
                    </div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>次の確認</span>
                      <strong>個別画面で詳細を確認</strong>
                    </div>
                  </div>

                  <div className={styles.footer}>
                    <span className={styles.footerLabel}>Student Room で確認する</span>
                  </div>
                </Link>
              ))}
            </div>

            <ReportPager
              filter={filter}
              page={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={rows.length}
              startIndex={pagination.startIndex}
              endIndex={pagination.endIndex}
            />
          </>
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
                    <span className={styles.metricLabel}>次の確認</span>
                    <strong>個別画面で詳細を確認</strong>
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

                <div className={styles.footer}>
                  <span className={styles.footerLabel}>{item.cta}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </ReportsSectionCard>
    </>
  );
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
