"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  AdminAttentionItem,
  AdminCampusStatus,
  AdminJobHealthSummary,
  PlatformAdminSnapshot,
} from "@/lib/admin/platform-admin-types";
import styles from "./admin.module.css";

type CampusFilter = AdminCampusStatus | "all";

const statusFilters: Array<{ value: CampusFilter; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "needs_attention", label: "要対応" },
  { value: "active", label: "稼働中" },
  { value: "onboarding", label: "導入中" },
  { value: "suspended", label: "停止中" },
];

function formatDateTime(value: string | null) {
  if (!value) return "未記録";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未記録";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatElapsed(seconds: number | null) {
  if (seconds === null) return "不明";
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}時間`;
  return `${Math.floor(hours / 24)}日`;
}

function campusTone(status: AdminCampusStatus) {
  if (status === "needs_attention") return styles.toneCritical;
  if (status === "suspended") return styles.toneMuted;
  if (status === "onboarding") return styles.toneInfo;
  return styles.toneGood;
}

function severityTone(severity: AdminAttentionItem["severity"]) {
  if (severity === "critical") return styles.toneCritical;
  if (severity === "warning") return styles.toneWarning;
  return styles.toneInfo;
}

function jobTone(group: AdminJobHealthSummary) {
  if (group.failed > 0 || group.stale > 0) return styles.toneCritical;
  if (group.running > 0 || group.queued > 0) return styles.toneInfo;
  return styles.toneGood;
}

function contractStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "active") return "契約中";
  if (normalized === "trial") return "試用中";
  if (normalized === "onboarding") return "導入中";
  if (normalized === "suspended") return "停止中";
  if (normalized === "cancelled" || normalized === "canceled") return "解約済み";
  return status || "未設定";
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export default function AdminPlatformPageClient({
  initialSnapshot,
  viewerName,
}: {
  initialSnapshot: PlatformAdminSnapshot;
  viewerName: string;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CampusFilter>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams({ take: "100", status });
        const normalizedQuery = normalize(query);
        if (normalizedQuery) params.set("q", normalizedQuery);
        const response = await fetch(`/api/admin/platform?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("管理データを更新できませんでした。");
        const nextSnapshot = (await response.json()) as PlatformAdminSnapshot;
        setSnapshot(nextSnapshot);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : "管理データを更新できませんでした。");
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, status]);

  async function loadMoreCampuses() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        take: "100",
        skip: String(snapshot.campuses.campuses.length),
        status,
      });
      const normalizedQuery = normalize(query);
      if (normalizedQuery) params.set("q", normalizedQuery);
      const response = await fetch(`/api/admin/platform?${params.toString()}`);
      if (!response.ok) throw new Error("次の校舎を読み込めませんでした。");
      const nextSnapshot = (await response.json()) as PlatformAdminSnapshot;
      setSnapshot((current) => ({
        ...nextSnapshot,
        campuses: {
          ...nextSnapshot.campuses,
          campuses: [...current.campuses.campuses, ...nextSnapshot.campuses.campuses],
        },
      }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "次の校舎を読み込めませんでした。");
    } finally {
      setIsLoading(false);
    }
  }

  const campuses = snapshot.campuses.campuses;
  const attention = snapshot.attention.slice(0, 8);
  const normalCampusCount = Math.max(
    0,
    snapshot.summary.campusCount - snapshot.summary.needsAttentionCampusCount
  );

  return (
    <main className={styles.platformShell}>
      <div className={styles.pageFrame}>
        <header className={styles.topBar}>
          <div className={styles.brandBlock}>
            <Link className={styles.brandLink} href="/admin" aria-label="PARARIA Admin ホーム">
              PARARIA Admin
            </Link>
            <span className={styles.scopePill}>全校舎</span>
            <Link className={styles.secondaryLink} href="/admin/audit">
              監査
            </Link>
          </div>
          <div className={styles.operatorPill} aria-label="ログイン中の運営担当者">
            <strong>{viewerName}</strong>
            <span>{snapshot.operator?.role ?? "PlatformOperator"}</span>
          </div>
        </header>

        <section className={styles.heroBand} aria-labelledby="admin-home-title">
          <p className={styles.eyebrow}>運営管理コンソール</p>
          <div className={styles.heroCopy}>
            <h1 id="admin-home-title">全校舎の状況</h1>
            <p>要対応を上から確認し、校舎名で詳細へ進みます。</p>
          </div>
        </section>

        <section className={styles.statGrid} aria-label="全体状況">
          <div className={styles.statCard}>
            <span>校舎数</span>
            <strong>{snapshot.summary.campusCount.toLocaleString("ja-JP")}</strong>
          </div>
          <div className={styles.statCard}>
            <span>要対応</span>
            <strong>{snapshot.summary.needsAttentionCampusCount.toLocaleString("ja-JP")}</strong>
          </div>
          <div className={styles.statCard}>
            <span>処理中</span>
            <strong>{snapshot.summary.runningJobCount.toLocaleString("ja-JP")}</strong>
          </div>
          <div className={styles.statCard}>
            <span>正常</span>
            <strong>{normalCampusCount.toLocaleString("ja-JP")}</strong>
          </div>
        </section>

        <section className={styles.primaryGrid}>
          <section className={styles.panel} aria-labelledby="attention-title">
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>今日見るところ</p>
                <h2 id="attention-title">要対応一覧</h2>
              </div>
              <span className={styles.generatedAt}>更新 {formatDateTime(snapshot.generatedAt)}</span>
            </div>
            {attention.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>今すぐ対応が必要な校舎はありません。</strong>
                <span>校舎一覧で利用状況を確認し、問い合わせがあれば校舎詳細を開いてください。</span>
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">状態</th>
                      <th scope="col">校舎</th>
                      <th scope="col">何が起きているか</th>
                      <th scope="col">経過</th>
                      <th scope="col">次にすること</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attention.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <span className={`${styles.statusPill} ${severityTone(item.severity)}`}>
                            {item.statusLabel}
                          </span>
                        </td>
                        <td>{item.campusName ?? "校舎未特定"}</td>
                        <td>
                          <strong className={styles.tableTitle}>{item.title}</strong>
                          <span className={styles.tableHint}>{item.causeLabel}</span>
                        </td>
                        <td>{formatElapsed(item.elapsedSeconds)}</td>
                        <td>
                          {item.campusId ? (
                            <Link
                              aria-label={`${item.campusName ?? "対象校舎"}の${item.nextActionLabel}`}
                              className={styles.textLink}
                              href={`/admin/campuses/${item.campusId}`}
                            >
                              {item.nextActionLabel}
                            </Link>
                          ) : (
                            <span className={styles.tableHint}>運営ログを確認</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className={styles.sidePanel} aria-labelledby="health-title">
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>処理状況</p>
                <h2 id="health-title">詰まりの早期発見</h2>
              </div>
            </div>
            <div className={styles.healthList}>
              {snapshot.jobHealth.groups.map((group) => (
                <div className={styles.healthRow} key={group.kind}>
                  <div>
                    <strong>{group.label}</strong>
                    <span>
                      待ち {group.queued} / 実行 {group.running}
                    </span>
                  </div>
                  <span className={`${styles.statusPill} ${jobTone(group)}`}>
                    {group.failed + group.stale > 0 ? "要対応" : group.running + group.queued > 0 ? "処理中" : "正常"}
                  </span>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className={styles.panel} aria-labelledby="campus-list-title">
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>校舎ディレクトリ</p>
              <h2 id="campus-list-title">校舎を探す</h2>
            </div>
            <span className={styles.generatedAt}>
              表示 {campuses.length.toLocaleString("ja-JP")} / {snapshot.campuses.totalCount.toLocaleString("ja-JP")}
            </span>
          </div>

          <div className={styles.toolbar} role="search">
            <label className={styles.searchField}>
              <span>校舎名・契約・担当者・IDで検索</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例: 渋谷校"
              />
            </label>
            <div className={styles.filterTabs} aria-label="状態で絞り込み">
              {statusFilters.map((option) => (
                <button
                  aria-pressed={status === option.value}
                  className={status === option.value ? styles.filterTabActive : styles.filterTab}
                  key={option.value}
                  type="button"
                  onClick={() => setStatus(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {loadError ? (
            <div className={styles.emptyState} role="alert">
              <strong>{loadError}</strong>
              <span>時間を置いて再度読み込むか、条件を変えてください。</span>
            </div>
          ) : campuses.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>条件に合う校舎がありません。</strong>
              <span>検索語を短くするか、状態フィルタを「すべて」に戻してください。</span>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">状態</th>
                    <th scope="col">校舎</th>
                    <th scope="col">契約</th>
                    <th scope="col">生徒</th>
                    <th scope="col">処理</th>
                    <th scope="col">最終更新</th>
                    <th scope="col">詳細</th>
                  </tr>
                </thead>
                <tbody>
                  {campuses.map((campus) => (
                    <tr key={campus.id}>
                      <td>
                        <span className={`${styles.statusPill} ${campusTone(campus.status)}`}>
                          {campus.statusLabel}
                        </span>
                      </td>
                      <td>
                        <strong className={styles.tableTitle}>{campus.name}</strong>
                        <span className={styles.tableHint}>
                          {campus.csOwnerName ? `CS: ${campus.csOwnerName}` : campus.customerLabel}
                        </span>
                      </td>
                      <td>
                        <strong className={styles.tableTitle}>{contractStatusLabel(campus.contractStatus)}</strong>
                        <span className={styles.tableHint}>
                          {campus.contractRenewalDate ? `更新 ${formatDateTime(campus.contractRenewalDate)}` : campus.planCode}
                        </span>
                      </td>
                      <td>
                        {campus.activeStudentCount.toLocaleString("ja-JP")}
                        {campus.studentLimit ? ` / ${campus.studentLimit.toLocaleString("ja-JP")}` : ""}
                      </td>
                      <td>
                        待ち {campus.queuedJobCount} / 実行 {campus.runningJobCount}
                      </td>
                      <td>{formatDateTime(campus.lastActivityAt)}</td>
                      <td>
                        <Link
                          aria-label={`${campus.name}の詳細を見る`}
                          className={styles.detailLink}
                          href={`/admin/campuses/${campus.id}`}
                        >
                          詳細を見る
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {snapshot.campuses.page.hasMore ? (
            <div className={styles.loadMoreRow}>
              <button className={styles.loadMoreButton} type="button" onClick={loadMoreCampuses} disabled={isLoading}>
                {isLoading ? "読み込み中" : "さらに表示"}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
