import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getLogListPageData } from "@/lib/logs/get-log-list-page-data";
import {
  transcriptReviewStateLabel,
  transcriptReviewSummary,
  transcriptReviewTone,
} from "@/lib/logs/transcript-review-display";
import { getAppSession } from "@/lib/server/app-session";
import DeleteLogButton from "./DeleteLogButton";
import styles from "./logsList.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TabType = "all" | "interview" | "lesson";

function readQueryParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeTab(value?: string): TabType {
  if (value === "lessonReport") return "lesson";
  if (value === "interview") return "interview";
  return "all";
}

function sessionTypeLabel(type?: string | null) {
  return type === "LESSON_REPORT" ? "指導報告" : "面談";
}

function statusLabel(status: string) {
  if (status === "DONE") return "生成完了";
  if (status === "PROCESSING") return "生成中";
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

export default async function LogsListPage({
  searchParams,
}: {
  searchParams?: { studentId?: string | string[]; type?: string | string[] };
}) {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const studentId = readQueryParam(searchParams?.studentId) ?? null;
  const tab = normalizeTab(readQueryParam(searchParams?.type));
  const { conversations, traceByLogId, counts } = await getLogListPageData({
    organizationId,
    studentId,
  });

  const filtered =
    tab === "interview"
      ? conversations.filter((item) => item.sessionType !== "LESSON_REPORT")
      : tab === "lesson"
        ? conversations.filter((item) => item.sessionType === "LESSON_REPORT")
        : conversations;

  const baseLogsPath = studentId ? `/app/logs?studentId=${encodeURIComponent(studentId)}` : "/app/logs";

  return (
    <div className={styles.page}>
      <AppHeader
        title="面談ログ / 指導報告ログ"
        subtitle="ここでは記録の中身だけでなく、どの保護者レポートに使われたかまで追えます。"
        viewerName={session.user.name ?? null}
        viewerRole={(session.user as { role?: string | null }).role ?? null}
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
        <Link href={studentId ? baseLogsPath : "/app/logs"} className={tab === "all" ? styles.filterChipActive : styles.filterChip}>
          すべて
        </Link>
        <Link
          href={`${baseLogsPath}${studentId ? "&" : "?"}type=interview`}
          className={tab === "interview" ? styles.filterChipActive : styles.filterChip}
        >
          面談
        </Link>
        <Link
          href={`${baseLogsPath}${studentId ? "&" : "?"}type=lessonReport`}
          className={tab === "lesson" ? styles.filterChipActive : styles.filterChip}
        >
          指導報告
        </Link>
      </section>

      <Card
        title="保存済みログ"
        subtitle="面談ログと指導報告ログを一覧し、どの保護者レポートに使われたかを確認できます。"
      >
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            この条件に合うログはありません。録音後にログを生成すると、ここに表示されます。
          </div>
        ) : (
          <div className={styles.list}>
            {filtered.map((log, index) => {
              const traces = traceByLogId[log.id] ?? [];
              const trustSummary = transcriptReviewSummary(log.transcriptReview);
              return (
                <article key={log.id} className={styles.row}>
                  <Link href={`/app/logs/${log.id}`} className={styles.rowLink} prefetch={index < 4}>
                    <div className={styles.rowMain}>
                      <div className={styles.rowTop}>
                        <div>
                          <div className={styles.studentName}>{log.student?.name ?? "担当未設定"}</div>
                          <div className={styles.meta}>{log.student?.grade ?? "学年未設定"}</div>
                        </div>
                        <div className={styles.badgeRow}>
                          <Badge label={sessionTypeLabel(log.sessionType)} tone="neutral" />
                          <Badge label={statusLabel(log.status)} tone={statusTone(log.status)} />
                          <Badge
                            label={transcriptReviewStateLabel(log.reviewState)}
                            tone={transcriptReviewTone(log.reviewState, log.transcriptReview)}
                          />
                        </div>
                      </div>

                      <p className={styles.summary}>{excerpt(log.summaryMarkdown)}</p>
                      <div className={styles.trustRow}>
                        <span className={styles.trustLabel}>信頼判断</span>
                        <span className={styles.trustSummary}>{trustSummary}</span>
                      </div>

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

                  <div className={styles.rowActions}>
                    <DeleteLogButton
                      logId={log.id}
                      title={`${sessionTypeLabel(log.sessionType)}ログを削除しますか？`}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
