import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminOperationsSnapshot } from "@/lib/admin/get-admin-operations-snapshot";
import { resolvePlatformOperatorForSession } from "@/lib/admin/platform-operators";
import { getAppSession } from "@/lib/server/app-session";
import styles from "../../../admin.module.css";
import AdminCampusOperationsClient from "./AdminCampusOperationsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ organizationId: string }>;
};

export default async function AdminCampusOperationsPage({ params }: PageProps) {
  const session = await getAppSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const operator = await resolvePlatformOperatorForSession({
    email: session.user.email,
    role: (session.user as { role?: string | null }).role ?? null,
  });

  if (!operator?.permissions.canPrepareWriteActions) {
    redirect("/admin");
  }

  const { organizationId } = await params;
  const snapshot = await getAdminOperationsSnapshot({
    organizationId,
    viewerRole: session.user.role,
    viewerEmail: session.user.email,
  });

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
            <span className={styles.scopePill}>復旧操作</span>
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
              <Link className={styles.textLink} href={`/admin/campuses/${organizationId}`}>
                {snapshot.organization.name}
              </Link>
              <span>/</span>
              <span>復旧操作</span>
            </nav>
            <div className={styles.detailTitleRow}>
              <div>
                <p className={styles.eyebrow}>ジョブ操作</p>
                <h1>{snapshot.organization.name}</h1>
              </div>
            </div>
          </div>
        </section>

        <AdminCampusOperationsClient
          organizationId={organizationId}
          initialSnapshot={snapshot}
          canExecute={operator.permissions.canExecuteDangerousActions}
        />
      </div>
    </main>
  );
}
