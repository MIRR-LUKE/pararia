import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { getAppSession } from "@/lib/server/app-session";
import styles from "./layout.module.css";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAppSession();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        viewerName={session.user.name ?? null}
        viewerRole={(session.user as { role?: string | null }).role ?? null}
      />
      <div className={styles.main}>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
