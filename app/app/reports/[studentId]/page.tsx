"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import styles from "./report.module.css";
import {
  getConversationsByStudentId,
  getProfileCompleteness,
  getReportByStudentId,
  getStudentById,
} from "@/lib/mockData";

export default function ReportPage({ params }: { params: { studentId: string } }) {
  const [period, setPeriod] = useState("thisMonth");
  const [content, setContent] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const student = useMemo(() => getStudentById(params.studentId), [params.studentId]);
  const reports = useMemo(() => getReportByStudentId(params.studentId), [params.studentId]);
  const selectedReport = reports[selectedIdx];

  const logs = useMemo(
    () => getConversationsByStudentId(params.studentId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [params.studentId]
  );
  const lastLog = logs[0];
  const completeness = student ? getProfileCompleteness(student.profile) : 0;

  useEffect(() => {
    setSelectedIdx(0);
    setContent(reports[0]?.content ?? "ここにレポートが表示されます。");
  }, [params.studentId, reports]);

  const onGenerate = () => {
    setContent(
      `AIがレポートを生成しました（デモ）。前回レポ以降の会話ログ ${logs.length} 件を参照しています。`
    );
  };

  return (
    <div>
      <AppHeader
        title="保護者レポート"
        subtitle="前回レポ以降のログをワンタッチで反映。必要に応じてログ選択も可能。"
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button type="button" variant="primary" onClick={onGenerate}>
              ワンタッチ生成
            </Button>
            <Link href={`/app/students/${params.studentId}#logs`}>
              <Button type="button" variant="secondary">
                ログを選んで生成
              </Button>
            </Link>
          </div>
        }
      />

      <Card>
        <div className={styles.form}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>📄 {student?.name ?? "生徒"} の保護者向けレポート</div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              参照範囲: 前回レポ以降（デフォルト）。最終会話: {lastLog?.date ?? "未会話"} / カルテ充実度 {completeness}%。
            </div>
          </div>
          <select
            className={styles.select}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="thisMonth">今月</option>
            <option value="lastMonth">先月</option>
            <option value="custom">カスタム</option>
          </select>
          <Button type="button" onClick={onGenerate}>
            ワンタッチ生成
          </Button>
        </div>
      </Card>

      <Card title="📚 レポート履歴" subtitle="前回レポが常に参照され、連続性を担保します">
        {reports.length === 0 ? (
          <div style={{ padding: 12, color: "var(--muted)" }}>
            レポートはまだありません。ワンタッチ生成から作成してください。
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <select
              className={styles.select}
              value={selectedIdx}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setSelectedIdx(idx);
                setContent(reports[idx]?.content ?? "");
              }}
            >
              {reports.map((r, idx) => (
                <option key={`${r.date}-${idx}`} value={idx}>
                  {r.title} / {r.date}
                </option>
              ))}
            </select>
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 12,
                background: "#f8fafc",
              }}
            >
              <div style={{ fontWeight: 800 }}>{selectedReport?.title}</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>{selectedReport?.date}</div>
            </div>
          </div>
        )}
      </Card>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h3 className={styles.title}>🧭 ログサマリー（構造化のみ）</h3>
          <div className={styles.timeline}>
            {logs.slice(0, 5).map((log) => (
              <div key={log.id} className={styles.event}>
                <span className={styles.pill}>{log.date}</span>
                <span>{log.summary}</span>
                <div className={styles.pillRow}>
                  {(log.keyTopics ?? []).map((t) => (
                    <span key={t} className={styles.pill}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {logs.length === 0 && (
              <div style={{ color: "var(--muted)", padding: 12 }}>会話ログがありません。</div>
            )}
          </div>
        </div>

        <div className={styles.card}>
          <h3 className={styles.title}>🗂 カルテ充実度</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Badge label={`充実度 ${completeness}%`} />
              <Badge label={`最終会話 ${lastLog?.date ?? "未会話"}`} tone="medium" />
              <Badge label={`ログ ${logs.length}件`} tone="low" />
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "#f8fafc" }}>
              <div style={{ fontWeight: 700 }}>カルテを育てるには</div>
              <ul style={{ margin: 6, paddingLeft: 18, color: "var(--muted)" }}>
                <li>雑談も含めて録音→構造化ログにする</li>
                <li>重要発言（keyQuotes）を3-7件残す</li>
                <li>カルテ更新差分を確認し、足りない項目を追加質問</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <Card title="生成結果（編集可）" subtitle="保護者に送る前に整形。Markdown/PDF対応予定">
        <textarea
          className={styles.textarea}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button type="button" variant="primary">
            確定して保存
          </Button>
          <Button type="button" variant="secondary">
            コピー用テキスト
          </Button>
          <Button type="button" variant="ghost">
            PDFプレビュー（実装予定）
          </Button>
        </div>
      </Card>
    </div>
  );
}
