"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IntentLink } from "@/components/ui/IntentLink";
import { StatePanel } from "@/components/ui/StatePanel";
import type { DashboardSnapshot } from "@/lib/students/dashboard-snapshot";
import DashboardPageClient from "./DashboardPageClient";
import styles from "./dashboard.module.css";

type Props = {
  canInvite: boolean;
  viewerName?: string | null;
  viewerRole?: string | null;
};

function DashboardFallback() {
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>今日やること</p>
          <h2 className={styles.heroTitle}>押すのは1回。あとは成果物が順に増える。</h2>
          <p className={styles.heroText}>面談と保護者レポートのうち、いま最優先の仕事だけをここに並べます。</p>
        </div>
        <div className={styles.heroActions}>
          <IntentLink href="/app/students">
            <Button className={styles.heroButton}>全生徒を見る</Button>
          </IntentLink>
        </div>
      </section>

      <Card title="今日の優先キュー" subtitle="最初の 5〜8 件だけ見れば、その日の主要な仕事を始められる状態にします。">
        <StatePanel
          kind="processing"
          title="ダッシュボードを開いています..."
          subtitle="今日の優先度が高い生徒を先に並べています。"
        />
      </Card>
    </>
  );
}

export default function DashboardContentClient({ canInvite, viewerName, viewerRole }: Props) {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error ?? "ダッシュボードの取得に失敗しました。");
      }
      setData(body as DashboardSnapshot);
    } catch (nextError: any) {
      setError(nextError?.message ?? "ダッシュボードの取得に失敗しました。");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!data && !error) {
    return <DashboardFallback />;
  }

  if (!data) {
    return (
      <Card title="今日の優先キュー" subtitle="最初の 5〜8 件だけ見れば、その日の主要な仕事を始められる状態にします。">
        <StatePanel
          kind="error"
          title="ダッシュボードを更新できませんでした"
          subtitle={error ?? "データの取得に失敗しました。"}
          action={
            <Button variant="secondary" onClick={() => void refresh()}>
              もう一度読む
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <DashboardPageClient
      initialData={data}
      canInvite={canInvite}
      viewerName={viewerName}
      viewerRole={viewerRole}
      showHeader={false}
    />
  );
}
