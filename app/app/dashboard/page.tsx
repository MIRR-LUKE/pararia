import { redirect } from "next/navigation";
import DashboardPageClient from "./DashboardPageClient";
import { getDashboardSnapshot } from "@/lib/students/dashboard-snapshot";
import { getAppSession } from "@/lib/server/app-session";

export default async function DashboardPage() {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const initialData = await getDashboardSnapshot({
    organizationId,
    candidateLimit: 24,
    queueLimit: 8,
  });

  const userRole = (session.user as { role?: string } | undefined)?.role;
  const canInvite = userRole === "ADMIN" || userRole === "MANAGER";

  return (
    <DashboardPageClient
      initialData={initialData}
      canInvite={canInvite}
      viewerName={session.user.name ?? null}
      viewerRole={(session.user as { role?: string | null }).role ?? null}
    />
  );
}
