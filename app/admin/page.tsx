import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformAdminSnapshot } from "@/lib/admin/platform-console";
import { resolvePlatformOperatorForSession } from "@/lib/admin/platform-operators";
import { getAppSession } from "@/lib/server/app-session";
import AdminPlatformPageClient from "./AdminPlatformPageClient";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminPage() {
  const session = await getAppSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const operator = await resolvePlatformOperatorForSession({
    email: session.user.email,
    role: (session.user as { role?: string | null }).role ?? null,
  });

  if (!operator?.permissions.canReadAllCampuses) {
    return (
      <main className={styles.platformShell}>
        <section className={styles.deniedPanel} aria-labelledby="admin-denied-title">
          <p className={styles.eyebrow}>PARARIA Admin</p>
          <h1 id="admin-denied-title">運営管理コンソールへの権限がありません</h1>
          <p>
            この画面は PARARIA 運営側の PlatformOperator 専用です。校舎内の管理者画面は通常のアプリから利用できます。
          </p>
          <Link className={styles.secondaryLink} href="/app/dashboard">
            アプリへ戻る
          </Link>
        </section>
      </main>
    );
  }

  const snapshot = await getPlatformAdminSnapshot({ operator, take: 100 });

  return (
    <AdminPlatformPageClient
      initialSnapshot={snapshot}
      viewerName={session.user.name ?? session.user.email ?? "運営担当者"}
    />
  );
}
