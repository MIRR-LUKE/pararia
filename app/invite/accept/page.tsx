import { Suspense } from "react";
import { InviteAcceptForm } from "./InviteAcceptForm";
import styles from "@/app/login/login.module.css";

function AcceptInner({ searchParams }: { searchParams: { token?: string } }) {
  const token = typeof searchParams.token === "string" ? searchParams.token : "";
  if (!token) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.errorText}>招待リンクが不正です。token パラメータがありません。</p>
        </div>
      </div>
    );
  }
  return <InviteAcceptForm token={token} />;
}

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  return (
    <Suspense>
      <AcceptInner searchParams={resolvedSearchParams} />
    </Suspense>
  );
}
