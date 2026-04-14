import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { getAppSession } from "@/lib/server/app-session";
import LogsListClient from "./LogsListClient";
import styles from "./logsList.module.css";

type TabType = "all" | "interview" | "lesson";

function readQueryParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeTab(value?: string): TabType {
  if (value === "lessonReport") return "lesson";
  if (value === "interview") return "interview";
  return "all";
}

function LogsTabFilters({ studentId, tab }: { studentId: string | null; tab: TabType }) {
  const baseLogsPath = studentId ? `/app/logs?studentId=${encodeURIComponent(studentId)}` : "/app/logs";

  return (
    <section className={styles.filterRow} aria-label="ログ種別の切り替え">
      <Link
        href={studentId ? baseLogsPath : "/app/logs"}
        className={tab === "all" ? styles.filterChipActive : styles.filterChip}
      >
        すべて
      </Link>
      <Link
        href={`${baseLogsPath}${studentId ? "&" : "?"}type=interview`}
        className={tab === "interview" ? styles.filterChipActive : styles.filterChip}
      >
        面談
      </Link>
      <Link
        href={`${baseLogsPath}${studentId ? "&" : "?"}type=lessonReport`}
        className={tab === "lesson" ? styles.filterChipActive : styles.filterChip}
      >
        指導報告
      </Link>
    </section>
  );
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
  const tab = normalizeTab(readQueryParam(resolvedSearchParams.type));

  return (
    <div className={styles.page}>
      <AppHeader
        title="面談ログ / 指導報告ログ"
        subtitle="ここでは記録の中身だけでなく、どの保護者レポートに使われたかまで追えます。"
        viewerName={session.user.name ?? null}
        viewerRole={(session.user as { role?: string | null }).role ?? null}
      />
      <LogsTabFilters studentId={studentId} tab={tab} />
      <LogsListClient studentId={studentId} tab={tab} />
    </div>
  );
}
