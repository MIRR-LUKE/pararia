"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import styles from "./logsList.module.css";

type LogItem = {
  id: string;
  studentId: string;
  sessionId: string | null;
  status: string;
  summaryMarkdown: string | null;
  createdAt: string;
  date: string;
  sessionType?: string | null;
  student?: { id: string; name: string; grade?: string | null };
};

type TabType = "all" | "interview" | "lesson";

function sessionTypeLabel(type?: string | null) {
  return type === "LESSON_REPORT" ? "指導報告" : "面談";
}

function statusLabel(status: string) {
  if (status === "DONE") return "確認可能";
  if (status === "PROCESSING") return "生成中";
  if (status === "PARTIAL") return "途中まで表示";
  if (status === "ERROR") return "要再実行";
  return "状態確認中";
}

function statusTone(status: string): "neutral" | "low" | "medium" | "high" {
  if (status === "DONE") return "low";
  if (status === "ERROR") return "high";
  if (status === "PROCESSING") return "medium";
  return "neutral";
}

function excerpt(markdown?: string | null) {
  if (!markdown) return "まだ要点が出ていません。生成が終わるとここに確認用の要約が出ます。";
  return markdown
    .replace(/^##\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 120);
}

export default function LogsListPage() {
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId");
  const typeParam = searchParams.get("type");
  const tab: TabType =
    typeParam === "lessonReport" ? "lesson" : typeParam === "interview" ? "interview" : "all";
  const [conversations, setConversations] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (studentId) params.set("studentId", studentId);
    params.set("limit", studentId ? "100" : "80");

    fetch(`/api/conversations?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "ログの読み込みに失敗しました。");
        return body;
      })
      .then((body) => setConversations(body.conversations ?? []))
      .catch((fetchError: Error) => setError(fetchError.message))
      .finally(() => setLoading(false));
  }, [studentId]);

  const filtered = useMemo(() => {
    if (tab === "interview") {
      return conversations.filter((item) => item.sessionType !== "LESSON_REPORT");
    }
    if (tab === "lesson") {
      return conversations.filter((item) => item.sessionType === "LESSON_REPORT");
    }
    return conversations;
  }, [conversations, tab]);

  const counts = useMemo(
    () => ({
      all: conversations.length,
      interview: conversations.filter((item) => item.sessionType !== "LESSON_REPORT").length,
      lesson: conversations.filter((item) => item.sessionType === "LESSON_REPORT").length,
    }),
    [conversations]
  );

  const baseLogsPath = studentId ? `/app/logs?studentId=${encodeURIComponent(studentId)}` : "/app/logs";

  return (
    <div className={styles.page}>
      <AppHeader
        title="根拠確認"
        subtitle="AI の判断根拠を確認し、必要ならここから修正を反映します。日常の主導線ではなく、確認専用の裏面です。"
      />

      <section className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>すべて</span>
          <strong>{counts.all}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>面談</span>
          <strong>{counts.interview}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>指導報告</span>
          <strong>{counts.lesson}</strong>
        </div>
      </section>

      <section className={styles.filterRow} aria-label="ログ種別の切り替え">
        <Link href={studentId ? `${baseLogsPath}` : "/app/logs"} className={tab === "all" ? styles.filterChipActive : styles.filterChip}>
          すべて
        </Link>
        <Link href={`${baseLogsPath}${studentId ? "&" : "?"}type=interview`} className={tab === "interview" ? styles.filterChipActive : styles.filterChip}>
          面談
        </Link>
        <Link href={`${baseLogsPath}${studentId ? "&" : "?"}type=lessonReport`} className={tab === "lesson" ? styles.filterChipActive : styles.filterChip}>
          指導報告
        </Link>
      </section>

      <Card title="確認待ちのログ" subtitle="生徒ルームの『根拠を見る』からもここに入れます。必要なものだけを開いてください。">
        {loading ? (
          <div className={styles.empty}>読み込み中です。</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            この条件に当てはまるログはありません。面談か指導報告を録音すると、ここで根拠確認できます。
          </div>
        ) : (
          <div className={styles.list}>
            {filtered.map((log) => (
              <Link key={log.id} href={`/app/logs/${log.id}`} className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTop}>
                    <div>
                      <div className={styles.studentName}>{log.student?.name ?? "生徒未設定"}</div>
                      <div className={styles.meta}>{log.student?.grade ?? "学年未設定"}</div>
                    </div>
                    <div className={styles.badgeRow}>
                      <Badge label={sessionTypeLabel(log.sessionType)} tone="neutral" />
                      <Badge label={statusLabel(log.status)} tone={statusTone(log.status)} />
                    </div>
                  </div>

                  <p className={styles.summary}>{excerpt(log.summaryMarkdown)}</p>

                  <div className={styles.footerRow}>
                    <span className={styles.meta}>{new Date(log.createdAt).toLocaleDateString("ja-JP")}</span>
                    <span className={styles.linkLabel}>開く</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
