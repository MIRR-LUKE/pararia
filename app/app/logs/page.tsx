import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { getAppSession } from "@/lib/server/app-session";
import LogsListClient from "./LogsListClient";
import styles from "./logsList.module.css";

function readQueryParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LogsListPage({
  searchParams,
}: {
  searchParams?: Promise<{ studentId?: string | string[]; type?: string | string[] }>;
}) {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const studentId = readQueryParam(resolvedSearchParams.studentId) ?? null;

  return (
    <div className={styles.page}>
      <AppHeader
        title="面談ログ"
        subtitle="ここでは記録の中身だけでなく、どの保護者レポートに使われたかまで追えます。"
        viewerName={session.user.name ?? null}
        viewerRole={(session.user as { role?: string | null }).role ?? null}
      />
      <LogsListClient studentId={studentId} />
    </div>
  );
}
