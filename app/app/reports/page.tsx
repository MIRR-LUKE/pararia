import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { PageLoadingState } from "@/components/ui/PageLoadingState";
import styles from "./reportDashboard.module.css";
import { normalizeFilter, normalizePage, type FilterKey } from "./report-dashboard";
import { ReportsDashboardContent } from "./ReportsDashboardContent";

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

export default async function ReportDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string | string[]; page?: string | string[] }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const filter = normalizeFilter(readQueryParam(resolvedSearchParams.filter));
  const page = normalizePage(readQueryParam(resolvedSearchParams.page));

  return (
    <div className={styles.page}>
      <AppHeader
        title="保護者レポート"
        subtitle="要約を先に出し、必要なものだけ次ページで追う構成にしています。"
        viewerName={null}
        viewerRole={null}
      />

      <section className={styles.filterRow} aria-label="レポートの絞り込み">
        {(Object.keys(filterLabels) as FilterKey[]).map((key) => (
          <Link
            key={key}
            href={key === "all" ? "/app/reports" : `/app/reports?filter=${key}`}
            className={filter === key ? styles.filterChipActive : styles.filterChip}
          >
            {filterLabels[key]}
          </Link>
        ))}
      </section>

      <Suspense
        fallback={
          <PageLoadingState
            title="保護者レポートを読み込んでいます..."
            subtitle="要約・状態・配信順で並べる準備をしています。"
            rows={4}
          />
        }
      >
        <ReportsDashboardContent filter={filter} page={page} />
      </Suspense>
    </div>
  );
}
