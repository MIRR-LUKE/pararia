"use client";

import { useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import styles from "./settings.module.css";

const FOUNDATION_NOTES = [
  {
    title: "ダークキャンバス",
    description: "MCP の Student Room を基準に、ページ全体を深いチャコールで統一します。",
    swatchClassName: "canvasSwatch",
  },
  {
    title: "2 段階の面",
    description: "主要カードは `#262626`、操作面は `#303030` を使い、奥行きを小さく保ちます。",
    swatchClassName: "panelSwatch",
  },
  {
    title: "アクセント",
    description: "黄緑タグ、シアンの担当バッジ、紫の校舎ボタンを全画面で再利用します。",
    swatchClassName: "accentSwatch",
  },
];

const OPERATIONS = [
  {
    title: "要確認の固有名詞",
    description: "送付前レビューと根拠確認の両方に残し、確定名は生徒辞書へ保存します。",
  },
  {
    title: "授業前だけで止まった授業",
    description: "概要キューと送付前レビューに残し、チェックアウトまで消しません。",
  },
  {
    title: "生成中の成果物",
    description: "全部がそろうまで待たせず、保存完了から順に見せます。",
  },
];

export default function SettingsPage() {
  const [org, setOrg] = useState("PARARIA 本校");
  const [campus, setCampus] = useState("渋谷校");
  const [policyDays, setPolicyDays] = useState(30);

  return (
    <div className={styles.page}>
      <AppHeader
        title="システム設定"
        subtitle="Student Room のビジュアル基盤と、録音から送付前確認までの運用ルールをここでそろえます。"
      />

      <div className={styles.grid}>
        <Card
          title="UI 基盤"
          subtitle="このプロジェクトでは、Student Room の Figma を全体のトークンとコンポーネントの土台として扱います。"
        >
          <div className={styles.foundationGrid}>
            {FOUNDATION_NOTES.map((item) => (
              <div key={item.title} className={styles.foundationCard}>
                <div className={`${styles.foundationSwatch} ${styles[item.swatchClassName]}`} aria-hidden />
                <div className={styles.foundationTitle}>{item.title}</div>
                <div className={styles.note}>{item.description}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="レビュー運用"
          subtitle="送付前の事故を防ぐため、確認待ちは確認キューとして先に出します。"
        >
          <div className={styles.policyList}>
            {OPERATIONS.map((item) => (
              <div key={item.title} className={styles.policyItem}>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card title="組織情報" subtitle="運用メモ用の基本設定です。正式な組織管理は今後この設定面から分離して拡張します。">
          <div className={styles.field}>
            <label className={styles.label}>組織名</label>
            <input className={styles.input} value={org} onChange={(e) => setOrg(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>拠点名</label>
            <input className={styles.input} value={campus} onChange={(e) => setCampus(e.target.value)} />
          </div>
          <Button type="button" variant="secondary" onClick={() => alert("組織情報はこの端末の下書きとして保存しました。")}>
            下書きを保存
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
              ここでは運用方針の値だけを管理します。本番の削除処理自体はバックグラウンドジョブで実行します。
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
