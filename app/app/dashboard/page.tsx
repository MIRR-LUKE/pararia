import { redirect } from "next/navigation";
import { auth } from "@/auth";
import DashboardPageClient from "./DashboardPageClient";
import { getDashboardSnapshot } from "@/lib/students/dashboard-snapshot";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const initialData = await getDashboardSnapshot({
    organizationId,
    candidateLimit: 50,
    queueLimit: 8,
  });

  const userRole = (session.user as { role?: string } | undefined)?.role;
  const canInvite = userRole === "ADMIN" || userRole === "MANAGER";

  return <DashboardPageClient initialData={initialData} canInvite={canInvite} />;
}
