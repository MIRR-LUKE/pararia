import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminTeacherAppDeviceSupportSnapshot } from "@/lib/admin/platform-device-support";
import { resolvePlatformOperatorForSession } from "@/lib/admin/platform-operators";
import { getAppSession } from "@/lib/server/app-session";
import styles from "../../../admin.module.css";

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

function roleLabel(role: string) {
  if (role === "ADMIN") return "管理者";
  if (role === "MANAGER") return "室長";
  if (role === "TEACHER" || role === "INSTRUCTOR") return "講師";
  return role;
}

function deviceTone(status: string) {
  if (status === "REVOKED") return styles.toneMuted;
  return styles.toneGood;
}

function sessionTone(count: number) {
  if (count > 0) return styles.toneInfo;
  return styles.toneMuted;
}

function KeyValueRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.keyValueRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default async function AdminCampusDevicesPage({ params }: PageProps) {
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
  const snapshot = await getAdminTeacherAppDeviceSupportSnapshot({ operator, organizationId });
  if (!snapshot) {
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
            <span className={styles.scopePill}>端末支援</span>
          </div>
          <div className={styles.operatorPill}>
            <strong>{session.user.name ?? "運営担当者"}</strong>
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
              <Link className={styles.textLink} href={`/admin/campuses/${snapshot.campus.id}`}>
                {snapshot.campus.name}
              </Link>
              <span>/</span>
              <span>Teacher App 端末</span>
            </nav>
            <div className={styles.detailTitleRow}>
              <div>
                <p className={styles.eyebrow}>ユーザー / Teacher App 端末支援</p>
                <h1>{snapshot.campus.name}</h1>
              </div>
              <span className={styles.scopePill}>確認専用</span>
            </div>
          </div>
        </section>

        <section className={styles.statGrid} aria-label="端末とユーザーの要約">
          <div className={styles.statCard}>
            <span>有効端末</span>
            <strong>{snapshot.devices.active.toLocaleString("ja-JP")}</strong>
          </div>
          <div className={styles.statCard}>
            <span>停止済み端末</span>
            <strong>{snapshot.devices.revoked.toLocaleString("ja-JP")}</strong>
          </div>
          <div className={styles.statCard}>
            <span>アクティブ認証</span>
            <strong>{snapshot.devices.activeAuthSessionCount.toLocaleString("ja-JP")}</strong>
          </div>
          <div className={styles.statCard}>
            <span>利用者</span>
            <strong>{snapshot.users.total.toLocaleString("ja-JP")}</strong>
          </div>
        </section>

        <section className={styles.detailGrid}>
          <section className={styles.detailSection} aria-labelledby="user-summary-title">
            <h2 id="user-summary-title">ユーザー概況</h2>
            <div className={styles.keyValueGrid}>
              {Object.entries(snapshot.users.byRole).map(([role, count]) => (
                <KeyValueRow key={role} label={roleLabel(role)} value={count.toLocaleString("ja-JP")} />
              ))}
              <KeyValueRow label="招待中" value={snapshot.users.pendingInvitationCount.toLocaleString("ja-JP")} />
              <KeyValueRow label="期限切れ招待" value={snapshot.users.expiredInvitationCount.toLocaleString("ja-JP")} />
              <KeyValueRow label="停止中ユーザー" value={snapshot.users.suspendedUserCount.toLocaleString("ja-JP")} />
            </div>
          </section>

          <section className={styles.detailSection} aria-labelledby="device-summary-title">
            <h2 id="device-summary-title">端末概況</h2>
            <div className={styles.keyValueGrid}>
              <KeyValueRow label="登録端末" value={snapshot.devices.total.toLocaleString("ja-JP")} />
              <KeyValueRow label="14日以内に確認" value={snapshot.devices.recentlySeen.toLocaleString("ja-JP")} />
              <KeyValueRow label="有効認証セッション" value={snapshot.devices.activeAuthSessionCount.toLocaleString("ja-JP")} />
              <KeyValueRow label="生成日時" value={formatDateTime(snapshot.generatedAt)} />
            </div>
          </section>

          <section className={`${styles.detailSection} ${styles.detailSectionWide}`} aria-labelledby="readonly-title">
            <h2 id="readonly-title">支援メモ</h2>
            <div className={styles.emptyState}>
              <strong>この画面は確認専用です。</strong>
              <span>端末停止や認証セッション破棄は、このIssueでは露出していません。必要な場合は監査付きの運営操作として扱います。</span>
            </div>
          </section>

          <section className={`${styles.detailSection} ${styles.detailSectionWide}`} aria-labelledby="device-list-title">
            <div className={styles.panelHeader}>
              <h2 id="device-list-title">Teacher App 端末一覧</h2>
              <span className={styles.generatedAt}>最大100件</span>
            </div>
            {snapshot.devices.rows.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>登録済みのTeacher App端末はありません。</strong>
                <span>校舎側でTeacher App端末を登録すると、ここに確認用の状態が表示されます。</span>
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">端末</th>
                      <th scope="col">状態</th>
                      <th scope="col">最終確認</th>
                      <th scope="col">認証</th>
                      <th scope="col">登録者</th>
                      <th scope="col">停止状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.devices.rows.map((device) => (
                      <tr key={device.id}>
                        <td>
                          <strong className={styles.tableTitle}>{device.label}</strong>
                          <span className={styles.tableHint}>{device.lastClientLabel}</span>
                        </td>
                        <td>
                          <span className={`${styles.statusPill} ${deviceTone(device.status)}`}>
                            {device.statusLabel}
                          </span>
                        </td>
                        <td>
                          <span className={styles.tableTitle}>{formatDateTime(device.lastSeenAt)}</span>
                          <span className={styles.tableHint}>最終認証: {formatDateTime(device.lastAuthenticatedAt)}</span>
                        </td>
                        <td>
                          <span className={`${styles.statusPill} ${sessionTone(device.activeAuthSessionCount)}`}>
                            有効 {device.activeAuthSessionCount.toLocaleString("ja-JP")}
                          </span>
                        </td>
                        <td>
                          <span className={styles.tableTitle}>{device.registeredBy.name}</span>
                          <span className={styles.tableHint}>{device.registeredBy.roleLabel}</span>
                        </td>
                        <td>
                          <span className={styles.tableTitle}>{device.revokeStateLabel}</span>
                          <span className={styles.tableHint}>
                            停止済みセッション: {device.revokedAuthSessionCount.toLocaleString("ja-JP")}
                          </span>
                        </td>
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
