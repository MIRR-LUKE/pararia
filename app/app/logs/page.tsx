"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { deriveReportDeliveryState, reportDeliveryStateLabel } from "@/lib/report-delivery";
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

type LatestReport = {
  id: string;
  status: string;
  createdAt: string;
  reviewedAt?: string | null;
  sentAt?: string | null;
  deliveryChannel?: string | null;
  sourceLogIds?: string[] | null;
  deliveryEvents?: Array<{
    eventType: string;
    createdAt: string;
    deliveryChannel?: string | null;
  }>;
};

type StudentRow = {
  id: string;
  name: string;
  grade?: string | null;
  sessions?: Array<{ id: string; conversation?: { id: string } | null }>;
  reports?: LatestReport[];
};

type TabType = "all" | "interview" | "lesson";

type TraceRow = {
  studentId: string;
  studentName: string;
  reportId: string;
  reportLabel: string;
  sourceCount: number;
};

function sessionTypeLabel(type?: string | null) {
  return type === "LESSON_REPORT" ? "指導報告" : "面談";
}

function statusLabel(status: string) {
  if (status === "DONE") return "生成完了";
  if (status === "PROCESSING") return "生成中";
  if (status === "PARTIAL") return "一部表示";
  if (status === "ERROR") return "エラー";
  return "処理中";
}

function statusTone(status: string): "neutral" | "low" | "medium" | "high" {
  if (status === "DONE") return "low";
  if (status === "ERROR") return "high";
  if (status === "PROCESSING") return "medium";
  return "neutral";
}

function excerpt(markdown?: string | null) {
  if (!markdown) return "まだ要約はありません。録音が終わると、ここに要点が出ます。";
  const lines = markdown
    .replace(/\r/g, "")
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^■\s+/, "")
        .replace(/^\*\*([^*]+)\*\*:\s*/, "")
    )
    .filter(Boolean)
    .filter(
      (line) =>
        !/^(対象生徒|面談日|面談時間|担当チューター|面談目的|指導日|教科・単元|対象期間|作成日):/.test(line)
    );
  const candidate = lines.find((line) => !/^[•・\-*]\s+/.test(line)) ?? lines[0] ?? "";
  return candidate.replace(/^[•・\-*]\s+/, "").replace(/\*\*/g, "").trim().slice(0, 140);
}

function reportDeliveryLabel(report?: LatestReport | null) {
  if (!report) return "未使用";
  return reportDeliveryStateLabel(deriveReportDeliveryState(report));
}

export default function LogsListPage() {
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId");
  const typeParam = searchParams.get("type");
  const tab: TabType =
    typeParam === "lessonReport" ? "lesson" : typeParam === "interview" ? "interview" : "all";
  const [conversations, setConversations] = useState<LogItem[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const conversationParams = new URLSearchParams();
    if (studentId) conversationParams.set("studentId", studentId);
    conversationParams.set("limit", studentId ? "100" : "80");

    Promise.all([
      fetch(`/api/conversations?${conversationParams.toString()}`, { cache: "no-store" }).then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "ログ一覧の読み込みに失敗しました。");
        return body.conversations ?? [];
      }),
      fetch("/api/students?limit=200", { cache: "no-store" }).then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "生徒情報の読み込みに失敗しました。");
        return body.students ?? [];
      }),
    ])
      .then(([conversationRows, studentRows]) => {
        setConversations(conversationRows);
        setStudents(studentRows);
      })
      .catch((fetchError: Error) => setError(fetchError.message))
      .finally(() => setLoading(false));
  }, [studentId]);

  const filtered = useMemo(() => {
    if (tab === "interview") return conversations.filter((item) => item.sessionType !== "LESSON_REPORT");
    if (tab === "lesson") return conversations.filter((item) => item.sessionType === "LESSON_REPORT");
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

  const traceByLogId = useMemo(() => {
    const map = new Map<string, TraceRow[]>();

    for (const student of students) {
      const report = student.reports?.[0];
      if (!report?.sourceLogIds?.length) continue;
      const reportLabel = reportDeliveryLabel(report);
      for (const logId of report.sourceLogIds) {
        const current = map.get(logId) ?? [];
        current.push({
          studentId: student.id,
          studentName: student.name,
          reportId: report.id,
          reportLabel,
          sourceCount: report.sourceLogIds.length,
        });
        map.set(logId, current);
      }
    }

    return map;
  }, [students]);

  const baseLogsPath = studentId ? `/app/logs?studentId=${encodeURIComponent(studentId)}` : "/app/logs";

  return (
    <div className={styles.page}>
      <AppHeader
        title="面談ログ / 指導報告ログ"
        subtitle="ここでは記録の中身だけでなく、どの保護者レポートに使われたかまで追えます。"
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

      <Card title="保存済みログ" subtitle="面談ログと指導報告ログを一覧し、どの保護者レポートに使われたかを確認できます。">
        {loading ? (
          <div className={styles.empty}>読み込み中です。</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            この条件に合うログはありません。録音後にログを生成すると、ここに表示されます。
          </div>
        ) : (
          <div className={styles.list}>
            {filtered.map((log) => {
              const traces = traceByLogId.get(log.id) ?? [];
              return (
                <Link key={log.id} href={`/app/logs/${log.id}`} className={styles.row}>
                  <div className={styles.rowMain}>
                    <div className={styles.rowTop}>
                      <div>
                        <div className={styles.studentName}>{log.student?.name ?? "担当未設定"}</div>
                        <div className={styles.meta}>{log.student?.grade ?? "学年未設定"}</div>
                      </div>
                      <div className={styles.badgeRow}>
                        <Badge label={sessionTypeLabel(log.sessionType)} tone="neutral" />
                        <Badge label={statusLabel(log.status)} tone={statusTone(log.status)} />
                      </div>
                    </div>

                    <p className={styles.summary}>{excerpt(log.summaryMarkdown)}</p>

                    <div className={styles.tracePanel}>
                      <div className={styles.traceLabel}>このログが使われた保護者レポート</div>
                      {traces.length === 0 ? (
                        <p className={styles.traceEmpty}>まだ source trace はありません。</p>
                      ) : (
                        <div className={styles.traceChips}>
                          {traces.map((trace) => (
                            <span key={`${trace.reportId}-${trace.studentId}`} className={styles.traceChip}>
                              {trace.studentName} / {trace.reportLabel} / {trace.sourceCount}件
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className={styles.footerRow}>
                      <span className={styles.meta}>{new Date(log.createdAt).toLocaleDateString("ja-JP")}</span>
                      <span className={styles.linkLabel}>開く</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
