"use client";

import { useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import styles from "./settings.module.css";

export default function SettingsPage() {
  const [org, setOrg] = useState("PARARIA 本校");
  const [campus, setCampus] = useState("本校舎");
  const [policyDays, setPolicyDays] = useState(0);

  return (
    <div>
      <AppHeader title="設定" subtitle="塾情報とデータ保持ポリシー" />
      <div className={styles.grid}>
        <Card title="塾情報">
          <div className={styles.field}>
            <label className={styles.label}>塾名</label>
            <input
              className={styles.input}
              value={org}
              onChange={(e) => setOrg(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>校舎名</label>
            <input
              className={styles.input}
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={() => alert("保存しました（デモ）")}
            style={{ marginTop: 10 }}
          >
            保存
          </Button>
        </Card>

        <Card title="音声データ保持ポリシー">
          <div className={styles.field}>
            <label className={styles.label}>保持日数（AUDIO_RETAIN_DAYS）</label>
            <input
              className={styles.input}
              type="number"
              value={policyDays}
              onChange={(e) => setPolicyDays(Number(e.target.value))}
            />
            <div className={styles.note}>
              テキスト化後、指定日数を超えた音声ファイルは自動削除します。
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => alert("保持ポリシーを更新しました（デモ）")}
            style={{ marginTop: 10 }}
          >
            ポリシーを更新
          </Button>
        </Card>
      </div>
    </div>
  );
}
