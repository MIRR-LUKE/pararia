"use client";

import { useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useTheme, type ThemeMode } from "@/components/providers/ThemeProvider";
import styles from "./settings.module.css";

const THEME_OPTIONS: Array<{ value: ThemeMode; title: string; description: string }> = [
  {
    value: "system",
    title: "システムに合わせる",
    description: "OS のライト / ダーク設定に追従します。",
  },
  {
    value: "light",
    title: "ライト固定",
    description: "日中の確認作業を優先した明るい表示にします。",
  },
  {
    value: "dark",
    title: "ダーク固定",
    description: "夜の録音やレビューでも眩しさを抑えます。",
  },
];

function labelTheme(mode: ThemeMode) {
  if (mode === "light") return "ライト固定";
  if (mode === "dark") return "ダーク固定";
  return "システム追従";
}

export default function SettingsPage() {
  const { themeMode, resolvedTheme, setThemeMode } = useTheme();
  const [org, setOrg] = useState("PARARIA 本校");
  const [campus, setCampus] = useState("本校");
  const [policyDays, setPolicyDays] = useState(30);

  return (
    <div className={styles.page}>
      <AppHeader
        title="設定"
        subtitle="見た目、レビュー運用、音声データの基本方針をここで揃えます。"
      />

      <div className={styles.grid}>
        <Card
          title="表示テーマ"
          subtitle="初期値はシステム追従です。ここで上書きするとこの端末だけに保存されます。"
        >
          <div className={styles.themeStack}>
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.themeOption} ${themeMode === option.value ? styles.themeOptionActive : ""}`}
                onClick={() => setThemeMode(option.value)}
              >
                <div>
                  <div className={styles.themeTitle}>{option.title}</div>
                  <div className={styles.note}>{option.description}</div>
                </div>
                <span className={styles.themeState}>{themeMode === option.value ? "選択中" : ""}</span>
              </button>
            ))}
          </div>

          <div className={styles.previewRow}>
            <div className={styles.previewCard}>
              <span className={styles.previewLabel}>現在の設定</span>
              <strong>{labelTheme(themeMode)}</strong>
            </div>
            <div className={styles.previewCard}>
              <span className={styles.previewLabel}>実際の表示</span>
              <strong>{resolvedTheme === "dark" ? "ダーク" : "ライト"}</strong>
            </div>
          </div>
        </Card>

        <Card
          title="レビュー運用"
          subtitle="送付前の事故を防ぐため、確認待ちは確認キューとして先に出します。"
        >
          <div className={styles.policyList}>
            <div className={styles.policyItem}>
              <strong>要確認の固有名詞</strong>
              <p>送付前レビューと根拠確認の両方に残し、確定名は生徒辞書へ保存します。</p>
            </div>
            <div className={styles.policyItem}>
              <strong>授業前だけで止まった授業</strong>
              <p>Today と送付前レビューに残し、チェックアウトまで消しません。</p>
            </div>
            <div className={styles.policyItem}>
              <strong>生成中の成果物</strong>
              <p>全部が揃うまで待たせず、保存完了から順に見せます。</p>
            </div>
          </div>
        </Card>

        <Card title="組織情報" subtitle="運用メモ用の基本設定です。組織構成の正式管理は今後 Admin 側に寄せます。">
          <div className={styles.field}>
            <label className={styles.label}>組織名</label>
            <input className={styles.input} value={org} onChange={(e) => setOrg(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>拠点名</label>
            <input className={styles.input} value={campus} onChange={(e) => setCampus(e.target.value)} />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => alert("組織情報はこの端末の下書きとして保存しました。")}
          >
            下書き保存
          </Button>
        </Card>

        <Card title="音声データ保持" subtitle="削除前に transcript と要点は残し、元音声だけを期限で整理します。">
          <div className={styles.field}>
            <label className={styles.label}>保持日数</label>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={policyDays}
              onChange={(e) => setPolicyDays(Number(e.target.value))}
            />
            <div className={styles.note}>
              ここでは運用方針を揃えるための値を確認できます。本番の削除はバックグラウンド処理で行います。
            </div>
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={() => alert(`音声保持日数を ${policyDays} 日で更新する設定を保存しました。`)}
          >
            保持方針を更新
          </Button>
        </Card>
      </div>
    </div>
  );
}
