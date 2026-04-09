import { notFound, redirect } from "next/navigation";
import { getSettingsSnapshot } from "@/lib/settings/get-settings-snapshot";
import { getAppSession } from "@/lib/server/app-session";
import SettingsPageClient from "./SettingsPageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const initialSettings = await getSettingsSnapshot({
    organizationId,
    viewerRole: (session.user as { role?: string | null }).role ?? undefined,
  });

  if (!initialSettings) {
    notFound();
  }

  return (
    <SettingsPageClient
      initialSettings={initialSettings}
      viewerName={session.user.name ?? null}
      viewerRole={(session.user as { role?: string | null }).role ?? null}
    />
  );
}
