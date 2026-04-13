import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IntentLink } from "@/components/ui/IntentLink";
import { StatePanel } from "@/components/ui/StatePanel";
import DashboardPageClient from "./DashboardPageClient";
import { getDashboardSnapshot } from "@/lib/students/dashboard-snapshot";
import { getAppSession } from "@/lib/server/app-session";
import styles from "./dashboard.module.css";

async function DashboardContent({
  organizationId,
  canInvite,
  viewerName,
  viewerRole,
}: {
  organizationId: string;
  canInvite: boolean;
  viewerName?: string | null;
  viewerRole?: string | null;
}) {
  const initialData = await getDashboardSnapshot({
    organizationId,
    candidateLimit: 24,
    queueLimit: 8,
  });

  return (
    <DashboardPageClient
      initialData={initialData}
      canInvite={canInvite}
      viewerName={viewerName}
      viewerRole={viewerRole}
      showHeader={false}
    />
  );
}

function DashboardFallback() {
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>今日やること</p>
          <h2 className={styles.heroTitle}>押すのは1回。あとは成果物が順に増える。</h2>
          <p className={styles.heroText}>
            面談と保護者レポートのうち、いま最優先の仕事だけをここに並べます。
          </p>
        </div>
        <div className={styles.heroActions}>
          <IntentLink href="/app/students">
            <Button className={styles.heroButton}>全生徒を見る</Button>
          </IntentLink>
        </div>
      </section>

      <Card
        title="今日の優先キュー"
        subtitle="最初の 5〜8 件だけ見れば、その日の主要な仕事を始められる状態にします。"
      >
        <StatePanel
          kind="processing"
          title="ダッシュボードを開いています..."
          subtitle="今日の優先度が高い生徒を先に並べています。"
        />
      </Card>
    </>
  );
}

export default async function DashboardPage() {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const userRole = (session.user as { role?: string } | undefined)?.role;
  const canInvite = userRole === "ADMIN" || userRole === "MANAGER";
  const viewerName = session.user.name ?? null;
  const viewerRole = (session.user as { role?: string | null }).role ?? null;

  return (
    <div className={styles.page}>
      <AppHeader
        title="今日の優先キュー"
        subtitle="今すぐ対応が必要な生徒だけを前に出します。ここでは読むより先に、動き始めることを優先します。"
        viewerName={viewerName}
        viewerRole={viewerRole}
      />
      <Suspense fallback={<DashboardFallback />}>
        <DashboardContent
          organizationId={organizationId}
          canInvite={canInvite}
          viewerName={viewerName}
          viewerRole={viewerRole}
        />
      </Suspense>
    </div>
  );
}
