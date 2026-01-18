"use client";

import { useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import styles from "./sessionForm.module.css";

export default function NewSessionPage({
  params,
}: {
  params: { studentId: string };
}) {
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");

  const handleAudio = async () => {
    setUploading(true);
    setTimeout(() => {
      setUploading(false);
      alert("文字起こしが完了しました（デモ）");
    }, 800);
  };

  return (
    <div>
      <AppHeader
        title="面談記録"
        subtitle="手入力メモまたは音声アップロードで記録します"
      />
      <Card
        title="生徒ID"
        subtitle="API連携時はこのIDでConversationを紐づけます"
      >
        {params.studentId}
      </Card>
      <div className={styles.grid}>
        <Card title="手入力メモで記録">
          <div className={styles.stack}>
            <div>
              <div className={styles.label}>今日の面談内容</div>
              <textarea
                className={styles.textarea}
                rows={6}
                placeholder="面談の内容を入力..."
              />
            </div>
            <div>
              <div className={styles.label}>テーマ</div>
              <select className={styles.select}>
                <option>進路</option>
                <option>勉強</option>
                <option>生活</option>
                <option>メンタル</option>
                <option>部活</option>
                <option>家庭</option>
              </select>
            </div>
            <Button
              type="button"
              onClick={() => alert("保存しました（ダミー）")}
              variant="primary"
            >
              保存してAI解析
            </Button>
          </div>
        </Card>

        <Card title="音声から記録" subtitle="音声→文字起こし→AI解析">
          <div className={styles.panel}>
            <div className={styles.label}>音声ファイル</div>
            <input
              className={styles.input}
              type="file"
              accept="audio/*"
              onChange={(e) =>
                setFileName(e.target.files?.[0]?.name ?? "ファイル未選択")
              }
            />
            {fileName && <div style={{ color: "var(--muted)" }}>{fileName}</div>}
            <Button
              type="button"
              variant="secondary"
              onClick={handleAudio}
              disabled={uploading}
            >
              {uploading ? "文字起こし中…" : "アップロードして文字起こし"}
            </Button>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              ストレージには一時保存し、`AUDIO_RETAIN_DAYS` を超えたら削除する設計です。
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
