import Link from "next/link";
import { redirect } from "next/navigation";
import { searchPlatformAuditLogs, type PlatformAuditSearchFilters } from "@/lib/admin/platform-audit-search";
import { resolvePlatformOperatorForSession } from "@/lib/admin/platform-operators";
import { getAppSession } from "@/lib/server/app-session";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AuditPageSearchParams = {
  from?: string | string[];
  to?: string | string[];
  operator?: string | string[];
  campus?: string | string[];
  action?: string | string[];
  status?: string | string[];
};

function first(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function buildFilters(searchParams: AuditPageSearchParams): PlatformAuditSearchFilters {
  return {
    from: first(searchParams.from),
    to: first(searchParams.to),
    operator: first(searchParams.operator),
    campus: first(searchParams.campus),
    action: first(searchParams.action),
    status: first(searchParams.status),
    take: 20,
  };
}

function buildExportHref(filters: PlatformAuditSearchFilters, format: "csv" | "json") {
  const params = new URLSearchParams({ format, take: "1000" });
  for (const key of ["from", "to", "operator", "campus", "action", "status"] as const) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  return `/api/admin/audit/export?${params.toString()}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusTone(status: string) {
  if (status === "SUCCESS") return styles.toneGood;
  if (status === "PREPARED") return styles.toneInfo;
  if (status === "ERROR" || status === "DENIED") return styles.toneCritical;
  if (status === "CANCELLED") return styles.toneWarning;
  return styles.toneMuted;
}

function riskTone(risk: string) {
  if (risk === "CRITICAL" || risk === "HIGH") return styles.toneCritical;
  if (risk === "MEDIUM") return styles.toneWarning;
  return styles.toneMuted;
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams?: Promise<AuditPageSearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const session = await getAppSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const operator = await resolvePlatformOperatorForSession({
    email: session.user.email,
    role: (session.user as { role?: string | null }).role ?? null,
  });

  if (!operator?.permissions.canReadAuditLogs) {
    return (
      <main className={styles.platformShell}>
        <section className={styles.deniedPanel} aria-labelledby="audit-denied-title">
          <p className={styles.eyebrow}>PARARIA Admin</p>
          <h1 id="audit-denied-title">監査ログを見る権限がありません</h1>
          <p>監査ログは限られた運営権限の担当者だけが閲覧できます。</p>
          <Link className={styles.secondaryLink} href="/admin">
            管理トップへ戻る
          </Link>
        </section>
      </main>
    );
  }

  const filters = buildFilters(resolvedSearchParams);
  const result = await searchPlatformAuditLogs(filters);

  return (
    <main className={styles.platformShell}>
      <div className={styles.pageFrame}>
        <header className={styles.topBar}>
          <div className={styles.brandBlock}>
            <Link className={styles.brandLink} href="/admin">
              PARARIA Admin
            </Link>
            <span className={styles.scopePill}>監査ログ</span>
          </div>
          <div className={styles.operatorPill} aria-label="ログイン中の運営担当者">
            <strong>{session.user.name ?? session.user.email ?? "運営担当者"}</strong>
            <span>{operator.role}</span>
          </div>
        </header>

        <section className={styles.heroBand} aria-labelledby="audit-title">
          <p className={styles.eyebrow}>読み取り専用</p>
          <div className={styles.heroCopy}>
            <h1 id="audit-title">監査ログ検索</h1>
            <p>誰が、いつ、どの校舎に、何をしたかを確認します。初期表示は最近の重要操作20件だけです。</p>
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="audit-filter-title">
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>絞り込み</p>
              <h2 id="audit-filter-title">条件を指定</h2>
            </div>
          </div>

          <form className={styles.toolbar} action="/admin/audit">
            <label className={styles.searchField}>
              <span>開始日</span>
              <input name="from" type="date" defaultValue={first(resolvedSearchParams.from)} />
            </label>
            <label className={styles.searchField}>
              <span>終了日</span>
              <input name="to" type="date" defaultValue={first(resolvedSearchParams.to)} />
            </label>
            <label className={styles.searchField}>
              <span>操作者</span>
              <input name="operator" type="search" placeholder="名前またはメール" defaultValue={first(resolvedSearchParams.operator)} />
            </label>
            <label className={styles.searchField}>
              <span>校舎</span>
              <input name="campus" type="search" placeholder="校舎名またはID" defaultValue={first(resolvedSearchParams.campus)} />
            </label>
            <label className={styles.searchField}>
              <span>操作種別</span>
              <input name="action" type="search" placeholder="例: export" defaultValue={first(resolvedSearchParams.action)} />
            </label>
            <label className={styles.searchField}>
              <span>結果</span>
              <input name="status" type="search" placeholder="SUCCESS / ERROR / DENIED" defaultValue={first(resolvedSearchParams.status)} />
            </label>
            <button className={styles.loadMoreButton} type="submit">
              検索
            </button>
            <Link className={styles.secondaryLink} href="/admin/audit">
              条件を消す
            </Link>
          </form>
        </section>

        <section className={styles.panel} aria-labelledby="audit-results-title">
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>{result.defaultImportantOnly ? "最近の重要操作" : "検索結果"}</p>
              <h2 id="audit-results-title">監査ログ</h2>
            </div>
            <span className={styles.generatedAt}>
              表示 {result.logs.length.toLocaleString("ja-JP")} / {result.totalCount.toLocaleString("ja-JP")}
            </span>
          </div>

          <div className={styles.toolbar} aria-label="監査ログのエクスポート">
            <span className={styles.tableHint}>エクスポートは監査ログに記録されます。</span>
            <div className={styles.brandBlock}>
              <a className={styles.detailLink} href={buildExportHref(filters, "csv")}>
                CSV
              </a>
              <a className={styles.detailLink} href={buildExportHref(filters, "json")}>
                JSON
              </a>
            </div>
          </div>

          {result.logs.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>条件に合う監査ログはありません。</strong>
              <span>期間や操作者の条件を広げてください。</span>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">日時</th>
                    <th scope="col">操作者</th>
                    <th scope="col">校舎</th>
                    <th scope="col">操作</th>
                    <th scope="col">結果</th>
                    <th scope="col">理由</th>
                    <th scope="col">リスク</th>
                  </tr>
                </thead>
                <tbody>
                  {result.logs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.createdAt)}</td>
                      <td>
                        <strong className={styles.tableTitle}>{log.operator.name ?? "運営担当者"}</strong>
                        <span className={styles.tableHint}>{log.operator.email ?? "記録なし"}</span>
                      </td>
                      <td>
                        <strong className={styles.tableTitle}>{log.target.organizationName ?? "全体"}</strong>
                        <span className={styles.tableHint}>{log.target.organizationId ?? log.target.type ?? "対象なし"}</span>
                      </td>
                      <td>
                        <strong className={styles.tableTitle}>{log.action}</strong>
                        <span className={styles.tableHint}>{log.target.id ?? "対象IDなし"}</span>
                      </td>
                      <td>
                        <span className={`${styles.statusPill} ${statusTone(log.status)}`}>{log.status}</span>
                      </td>
                      <td>{log.reason ?? "記録なし"}</td>
                      <td>
                        <span className={`${styles.statusPill} ${riskTone(log.risk)}`}>{log.risk}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
