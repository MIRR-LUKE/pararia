import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPlatformCampusDetail } from "@/lib/admin/platform-console";
import { resolvePlatformOperatorForSession } from "@/lib/admin/platform-operators";
import type { AdminCampusStatus, AdminJobHealthSummary } from "@/lib/admin/platform-admin-types";
import { getAppSession } from "@/lib/server/app-session";
import styles from "../../admin.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ organizationId: string }>;
};

function formatDateTime(value: string | null) {
  if (!value) return "未記録";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未記録";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBoolean(value: boolean) {
  return value ? "必要" : "不要";
}

function campusTone(status: AdminCampusStatus) {
  if (status === "needs_attention") return styles.toneCritical;
  if (status === "suspended") return styles.toneMuted;
  if (status === "onboarding") return styles.toneInfo;
  return styles.toneGood;
}

function jobTone(group: AdminJobHealthSummary) {
  if (group.failed > 0 || group.stale > 0) return styles.toneCritical;
  if (group.running > 0 || group.queued > 0) return styles.toneInfo;
  return styles.toneGood;
}

function roleLabel(role: string) {
  if (role === "ADMIN") return "管理者";
  if (role === "MANAGER") return "室長";
  if (role === "TEACHER" || role === "INSTRUCTOR") return "講師";
  return role;
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

function KeyValueRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.keyValueRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default async function AdminCampusDetailPage({ params }: PageProps) {
  const session = await getAppSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const operator = await resolvePlatformOperatorForSession({
    email: session.user.email,
    role: (session.user as { role?: string | null }).role ?? null,
  });

  if (!operator?.permissions.canReadAllCampuses) {
    redirect("/admin");
  }

  const { organizationId } = await params;
  const detail = await getPlatformCampusDetail({ operator, organizationId });
  if (!detail) {
    notFound();
  }

  return (
    <main className={styles.platformShell}>
      <div className={styles.pageFrame}>
        <header className={styles.topBar}>
          <div className={styles.brandBlock}>
            <Link className={styles.brandLink} href="/admin">
              PARARIA Admin
            </Link>
            <span className={styles.scopePill}>校舎詳細</span>
            <Link className={styles.secondaryLink} href="/admin/audit">
              監査
            </Link>
          </div>
          <div className={styles.operatorPill}>
            <strong>{session.user.name ?? session.user.email ?? "運営担当者"}</strong>
            <span>{operator.role}</span>
          </div>
        </header>

        <section className={styles.heroBand}>
          <div className={styles.detailHeader}>
            <nav className={styles.breadcrumb} aria-label="パンくず">
              <Link className={styles.textLink} href="/admin">
                全校舎
              </Link>
              <span>/</span>
              <span>{detail.campus.name}</span>
            </nav>
            <div className={styles.detailTitleRow}>
              <div>
                <p className={styles.eyebrow}>校舎詳細</p>
                <h1>{detail.campus.name}</h1>
              </div>
              <span className={`${styles.statusPill} ${campusTone(detail.campus.status)}`}>
                {detail.campus.statusLabel}
              </span>
            </div>
          </div>
        </section>

        <section className={styles.statGrid} aria-label="校舎の要約">
          <div className={styles.statCard}>
            <span>未対応</span>
            <strong>{detail.campus.openIssueCount.toLocaleString("ja-JP")}</strong>
          </div>
          <div className={styles.statCard}>
            <span>生徒</span>
            <strong>{detail.campus.activeStudentCount.toLocaleString("ja-JP")}</strong>
          </div>
          <div className={styles.statCard}>
            <span>利用者</span>
            <strong>{detail.users.total.toLocaleString("ja-JP")}</strong>
          </div>
          <div className={styles.statCard}>
            <span>端末</span>
            <strong>{detail.devices.active.toLocaleString("ja-JP")}</strong>
          </div>
        </section>

        <section className={styles.detailGrid}>
          <section className={styles.detailSection} aria-labelledby="overview-title">
            <h2 id="overview-title">概要</h2>
            <div className={styles.keyValueGrid}>
              <KeyValueRow label="契約プラン" value={detail.campus.planCode} />
              <KeyValueRow label="生徒上限" value={detail.campus.studentLimit ?? "未設定"} />
              <KeyValueRow label="標準言語" value={detail.overview.defaultLocale} />
              <KeyValueRow label="時間帯" value={detail.overview.defaultTimeZone} />
              <KeyValueRow label="保護者同意" value={formatBoolean(detail.overview.guardianConsentRequired)} />
              <KeyValueRow label="最終更新" value={formatDateTime(detail.campus.lastActivityAt)} />
            </div>
          </section>

          <section className={styles.detailSection} aria-labelledby="contract-title">
            <h2 id="contract-title">契約・担当</h2>
            <div className={styles.keyValueGrid}>
              <KeyValueRow label="契約状態" value={contractStatusLabel(detail.contract.status)} />
              <KeyValueRow label="更新日" value={formatDateTime(detail.contract.renewalDate)} />
              <KeyValueRow label="請求先" value={detail.contract.billingContactName ?? "未設定"} />
              <KeyValueRow label="営業担当" value={detail.contract.salesOwnerName ?? "未設定"} />
              <KeyValueRow label="CS担当" value={detail.contract.csOwnerName ?? "未設定"} />
            </div>
          </section>

          <section className={styles.detailSection} aria-labelledby="usage-title">
            <h2 id="usage-title">利用状況</h2>
            <div className={styles.keyValueGrid}>
              <KeyValueRow label="面談ログ" value={detail.overview.conversationCount.toLocaleString("ja-JP")} />
              <KeyValueRow label="面談セッション" value={detail.overview.sessionCount.toLocaleString("ja-JP")} />
              <KeyValueRow label="レポート" value={detail.overview.reportCount.toLocaleString("ja-JP")} />
              <KeyValueRow label="アーカイブ生徒" value={detail.campus.archivedStudentCount.toLocaleString("ja-JP")} />
            </div>
          </section>

          <section className={styles.detailSection} aria-labelledby="user-title">
            <h2 id="user-title">ユーザー</h2>
            <div className={styles.keyValueGrid}>
              {Object.entries(detail.users.byRole).map(([role, count]) => (
                <KeyValueRow key={role} label={roleLabel(role)} value={count.toLocaleString("ja-JP")} />
              ))}
              <KeyValueRow label="招待中" value={detail.users.pendingInvitationCount.toLocaleString("ja-JP")} />
              <KeyValueRow label="期限切れ招待" value={detail.users.expiredInvitationCount.toLocaleString("ja-JP")} />
            </div>
          </section>

          <section className={`${styles.detailSection} ${styles.detailSectionWide}`} aria-labelledby="jobs-title">
            <div className={styles.panelHeader}>
              <h2 id="jobs-title">ジョブ</h2>
              <Link className={styles.detailLink} href={`/admin/campuses/${detail.campus.id}/operations`}>
                復旧操作を開く
              </Link>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">種類</th>
                    <th scope="col">状態</th>
                    <th scope="col">処理待ち</th>
                    <th scope="col">実行中</th>
                    <th scope="col">要確認</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.jobs.groups.map((group) => (
                    <tr key={group.kind}>
                      <td>
                        <strong className={styles.tableTitle}>{group.label}</strong>
                      </td>
                      <td>
                        <span className={`${styles.statusPill} ${jobTone(group)}`}>
                          {group.failed + group.stale > 0 ? "要対応" : group.running + group.queued > 0 ? "処理中" : "正常"}
                        </span>
                      </td>
                      <td>{group.queued.toLocaleString("ja-JP")}</td>
                      <td>{group.running.toLocaleString("ja-JP")}</td>
                      <td>{(group.failed + group.stale).toLocaleString("ja-JP")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.detailSection} aria-labelledby="devices-title">
            <div className={styles.panelHeader}>
              <h2 id="devices-title">端末</h2>
              <Link className={styles.detailLink} href={`/admin/campuses/${detail.campus.id}/devices`}>
                端末を見る
              </Link>
            </div>
            <div className={styles.keyValueGrid}>
              <KeyValueRow label="有効" value={detail.devices.active.toLocaleString("ja-JP")} />
              <KeyValueRow label="無効化済み" value={detail.devices.revoked.toLocaleString("ja-JP")} />
              <KeyValueRow label="合計" value={detail.devices.total.toLocaleString("ja-JP")} />
            </div>
          </section>

          <section className={styles.detailSection} aria-labelledby="support-note-title">
            <h2 id="support-note-title">メモ</h2>
            <div className={styles.emptyState}>
              <strong>{detail.contract.supportNote ?? "サポートメモは未設定です。"}</strong>
              <span>{detail.contract.usageLimitNote ?? "利用上限や契約上の注意事項があればここに表示します。"}</span>
            </div>
          </section>

          <section className={`${styles.detailSection} ${styles.detailSectionWide}`} aria-labelledby="audit-title">
            <div className={styles.panelHeader}>
              <h2 id="audit-title">監査</h2>
              <Link className={styles.detailLink} href={`/admin/audit?campus=${detail.campus.id}`}>
                監査ログを開く
              </Link>
            </div>
            {detail.audits.recentPlatformActions.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>この校舎への運営操作はまだ記録されていません。</strong>
                <span>書き込み操作を追加する場合は、理由と影響範囲を残してから実行します。</span>
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">日時</th>
                      <th scope="col">操作</th>
                      <th scope="col">結果</th>
                      <th scope="col">対象</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.audits.recentPlatformActions.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatDateTime(entry.createdAt)}</td>
                        <td>{entry.action}</td>
                        <td>{entry.status}</td>
                        <td>{entry.targetType ?? "校舎"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
