import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { getAppSession } from "@/lib/server/app-session";
import DashboardContentClient from "./DashboardContentClient";
import styles from "./dashboard.module.css";

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
      <DashboardContentClient canInvite={canInvite} viewerName={viewerName} viewerRole={viewerRole} />
    </div>
  );
}
