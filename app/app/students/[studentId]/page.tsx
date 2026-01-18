"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import styles from "./studentDetail.module.css";
import {
  getProfileCompleteness,
  getStudentById,
} from "@/lib/mockData";
import { StudentRecorder } from "./StudentRecorder";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import Link from "next/link";

type ConversationLog = {
  id: string;
  studentId: string;
  summary: string;
  title: string | null;
  keyQuotes: string[] | null;
  keyTopics: string[] | null;
  nextActions: string[] | null;
  structuredDelta?: {
    personal?: Record<string, { value: string; updatedAt?: string; sourceLogId?: string }>;
    basics?: Record<string, { value: string; updatedAt?: string; sourceLogId?: string }>;
  } | null;
  createdAt: string;
  date: string;
};

// lightweight inline icons (no external deps)
const IconMic = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1.5a3.5 3.5 0 0 0-3.5 3.5v6a3.5 3.5 0 1 0 7 0v-6A3.5 3.5 0 0 0 12 1.5Z" />
    <path d="M19 10.5a7 7 0 1 1-14 0" />
    <path d="M12 21v-3" />
  </svg>
);
const IconReport = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M7 3h8l4 4v14H7z" />
    <path d="M15 3v4h4" />
    <path d="M10 13h6" />
    <path d="M10 17h6" />
    <path d="M10 9h2" />
  </svg>
);
const IconSpark = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2v4" />
    <path d="M12 18v4" />
    <path d="m4.93 4.93 2.83 2.83" />
    <path d="m16.24 16.24 2.83 2.83" />
    <path d="M2 12h4" />
    <path d="M18 12h4" />
    <path d="m4.93 19.07 2.83-2.83" />
    <path d="m16.24 7.76 2.83-2.83" />
  </svg>
);
const IconCards = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="13" height="16" rx="2" />
    <path d="M15 7h4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4" />
  </svg>
);

type TabKey = "personal" | "basics" | "logs" | "report";

export default function StudentDetailPage({ params }: { params: { studentId: string } }) {
  const student = getStudentById(params.studentId);
  const [logs, setLogs] = useState<ConversationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("personal");
  const tabBodyRef = useRef<HTMLDivElement | null>(null);
  const [mergedPersonal, setMergedPersonal] = useState<Record<
    string,
    { value: string; updatedAt?: string; sourceLogId?: string }
  >>(student?.profile.personal ?? {});
  const profileForView = student
    ? { ...student.profile, personal: mergedPersonal }
    : null;
  const completeness = profileForView ? getProfileCompleteness(profileForView) : 0;

  useEffect(() => {
    tabBodyRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  const refreshLogs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/conversations?studentId=${params.studentId}`);
      if (res.ok) {
        const data = await res.json();
        const fetchedLogs = (data.conversations || []).map((log: any) => ({
          id: log.id,
          studentId: log.studentId,
          summary: log.summary,
          title: log.title as string | null,
          keyQuotes: log.keyQuotes as string[] | null,
          keyTopics: log.keyTopics as string[] | null,
          nextActions: log.nextActions as string[] | null,
          structuredDelta: log.structuredDelta ?? null,
          createdAt: log.createdAt,
          date: new Date(log.createdAt).toLocaleDateString("ja-JP"),
        }));
        const sorted = fetchedLogs.sort(
          (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setLogs(sorted);
      }
    } catch (error) {
      console.error("[StudentDetailPage] Failed to fetch logs:", error);
    } finally {
      setLoading(false);
    }
  }, [params.studentId]);

  useEffect(() => {
    refreshLogs();
  }, [refreshLogs]);

  const handleDeleteLog = async (id: string) => {
    const ok = window.confirm("本当に削除しますか？");
    if (!ok) return;
    try {
      setDeletingId(id);
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "削除に失敗しました");
      }
      setLogs((prev) => prev.filter((log) => log.id !== id));
    } catch (error: any) {
      console.error("[StudentDetailPage] Failed to delete log:", error);
      alert(error?.message ?? "削除に失敗しました");
    } finally {
      setDeletingId(null);
      refreshLogs();
    }
  };

  useEffect(() => {
    if (!student) return;
    const merged: Record<string, { value: string; updatedAt?: string; sourceLogId?: string }> = {
      ...(student.profile.personal ?? {}),
    };
    const sortedByDate = [...logs].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    sortedByDate.forEach((log) => {
      const personal = log.structuredDelta?.personal ?? {};
      Object.entries(personal).forEach(([key, value]) => {
        if (!value?.value) return;
        merged[key] = {
          ...value,
          updatedAt: value.updatedAt ?? log.createdAt,
          sourceLogId: value.sourceLogId ?? log.id,
        };
      });
    });
    setMergedPersonal(merged);
  }, [logs, student]);

  const latestLog = logs[0];
  const fallbackLogId = latestLog?.id;

  if (!student) return notFound();

  return (
    <div>
      <AppHeader
        title={`${student.name} / ${student.grade}`}
        subtitle={`担当: ${student.teacher} ｜ 最終会話: ${latestLog?.date ?? "未会話"} ｜ 会話ログ ${
          logs.length
        }件`}
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href="#report">
            <Button size="small" variant="secondary">
                ワンタッチで保護者レポート
              </Button>
            </a>
            <a href="#record">
              <Button size="small" variant="primary">
                録音して会話ログを追加
            </Button>
          </a>
          </div>
        }
      />

      <div className={styles.heroGrid}>
        <div className={styles.heroCard}>
          <div className={styles.heroIcon}>
            <IconMic />
          </div>
          <div>
            <div className={styles.heroTitle}>録音1クリック</div>
            <div className={styles.heroText}>会話を録れば自動で要約・タグ化・カルテ更新</div>
          </div>
        </div>
        <div className={styles.heroCard}>
          <div className={styles.heroIcon}>
            <IconSpark />
          </div>
          <div>
            <div className={styles.heroTitle}>カルテ充実がスコア</div>
            <div className={styles.heroText}>充実度{completeness}%・ログ{logs.length}件。話すほど伸びる</div>
          </div>
        </div>
        <div className={styles.heroCard}>
          <div className={styles.heroIcon}>
            <IconReport />
          </div>
          <div>
            <div className={styles.heroTitle}>保護者レポはワンタッチ</div>
            <div className={styles.heroText}>前回以降のログ＋前回レポを自動参照してPDF/Markdown生成</div>
          </div>
        </div>
      </div>

      <div className={styles.sectionStack} id="record">
        <Card title="録音・アップロード" subtitle="録音→文字起こし→構造化→カルテ更新を一気通貫で実行">
          <div className={styles.quickRow}>
            <div className={styles.quickLeft}>
              <div className={styles.chip}>
                <IconMic />
                会話ログでカルテを育てる
              </div>
              <div className={styles.chipSecondary}>
                <IconCards />
                重要発言 / タグ / 次アクション / 更新差分 を自動付与
              </div>
            </div>
            <div className={styles.quickRight}>
              <span className={styles.subtext}>最終会話: {latestLog?.date ?? "未会話"}</span>
              <span className={styles.subtext}>カルテ充実度: {completeness}%</span>
            </div>
          </div>
        <StudentRecorder
          studentName={student.name}
          studentId={student.id}
          fallbackLogId={fallbackLogId}
          onLogCreated={refreshLogs}
        />
      </Card>

        <Card
          title="カルテ概要"
          subtitle="会話が溜まるほど自動で更新。各項目に最終更新日と根拠（ログ）を表示。"
        >
          <div className={styles.metricsRow}>
            <div className={styles.metric}>
              <div className={styles.metricLabel}>カルテ充実度</div>
              <div className={styles.metricValue}>
                {completeness}%
                <Progress value={completeness} />
              </div>
            </div>
            <div className={styles.metric}>
              <div className={styles.metricLabel}>会話ログ</div>
              <div className={styles.metricValue}>{logs.length} 件</div>
              <div className={styles.subtext}>最終: {latestLog?.date ?? "未会話"}</div>
            </div>
            <div className={styles.metric}>
              <div className={styles.metricLabel}>モチベーション</div>
              <div className={styles.metricValue}>{student.motivationScore}</div>
              <Progress value={student.motivationScore} />
            </div>
          </div>
          <div className={styles.tabShell}>
            <div className={styles.tabBar}>
              <button
                className={`${styles.tabButton} ${tab === "personal" ? styles.tabActive : ""}`}
                onClick={() => setTab("personal")}
                type="button"
              >
                パーソナル
              </button>
              <button
                className={`${styles.tabButton} ${tab === "basics" ? styles.tabActive : ""}`}
                onClick={() => setTab("basics")}
                type="button"
              >
                基本情報
              </button>
              <button
                className={`${styles.tabButton} ${tab === "logs" ? styles.tabActive : ""}`}
                onClick={() => setTab("logs")}
                type="button"
              >
                会話ログ
              </button>
              <button
                className={`${styles.tabButton} ${tab === "report" ? styles.tabActive : ""}`}
                onClick={() => setTab("report")}
                type="button"
              >
                保護者レポート
              </button>
            </div>
            <div className={styles.tabBody}>
              <div ref={tabBodyRef} className={styles.tabBodyInner}>
              {tab === "personal" && <ProfileSection fields={mergedPersonal} />}
              {tab === "basics" && <ProfileSection fields={student.profile.basics} />}
              {tab === "logs" && (
                <div>
                  {loading ? (
                    <div className={styles.empty}>読み込み中...</div>
                  ) : logs.length === 0 ? (
                    <div className={styles.empty}>まだ会話ログがありません。録音して追加してください。</div>
                  ) : (
                    <div className={styles.logList}>
                      {logs.map((log) => (
                        <div key={log.id} className={styles.logRowCard}>
                          <button
                            type="button"
                            className={styles.logDeleteButton}
                            onClick={() => handleDeleteLog(log.id)}
                            disabled={deletingId === log.id}
                          >
                            {deletingId === log.id ? "削除中…" : "削除"}
                          </button>
                          <Link href={`/app/logs/${log.id}`} className={styles.logRowLink}>
                            <div className={styles.logRowTop}>
                              <div className={styles.logTitle}>{log.date}</div>
                            </div>
                            <div className={styles.logSummary}>
                              {log.title || log.summary.split("\n\n")[0] || "会話ログ"}
                            </div>
                            {log.keyTopics && log.keyTopics.length > 0 ? (
                              <div className={styles.pillRow}>
                                {log.keyTopics.map((t) => (
                                  <span key={t} className={styles.pill}>
                                    {t}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {tab === "report" && (
                <div>
                  <div className={styles.reportRow}>
                    <div className={styles.reportActions}>
                      <Button size="small" variant="primary">
                        ワンタッチで生成（前回以降の全ログ）
                      </Button>
                      <Button size="small" variant="secondary">
                        ログを選んで生成
                      </Button>
                      <div className={styles.subtext}>
                        デフォルトは「前回レポ以降の全ログ＋前回レポ参照」で連続性を担保します。
                      </div>
                    </div>
                    <div className={styles.reportPreview}>
                      <div className={styles.subtext}>生成結果（Markdown / PDFプレビュー）</div>
                      <div className={styles.previewBox}>
                        生成するとここにMarkdownとPDFプレビュー（iframe）が表示されます。
                      </div>
                    </div>
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ProfileSection({
  fields,
}: {
  fields: Record<string, { value: string; updatedAt?: string; sourceLogId?: string }>;
}) {
  const entries = Object.entries(fields ?? {});
  if (entries.length === 0)
    return <div className={styles.subtext}>まだ情報がありません。会話ログを追加してください。</div>;
  return (
    <div className={styles.fieldList}>
      {entries.map(([key, field]) => (
        <div key={key} className={styles.fieldRow}>
          <div className={styles.fieldKey}>{key}</div>
          <div className={styles.fieldValue}>{field.value || "未設定"}</div>
          <div className={styles.fieldMeta}>
            {field.updatedAt ? `更新: ${field.updatedAt}` : "更新: -"}
            {field.sourceLogId && (
              <Link href={`/app/logs/${field.sourceLogId}`} className={styles.fieldLink}>
                根拠: {field.sourceLogId}（会話ログへ）
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProfileTabs({
  personal,
  basics,
}: {
  personal: Record<string, { value: string; updatedAt?: string; sourceLogId?: string }>;
  basics: Record<string, { value: string; updatedAt?: string; sourceLogId?: string }>;
}) {
  const [tab, setTab] = useState<"personal" | "basics">("personal");
  const isPersonal = tab === "personal";
  const activeFields = isPersonal ? personal : basics;
  return (
    <div className={styles.tabShell}>
      <div className={styles.tabBar}>
        <button
          className={`${styles.tabButton} ${isPersonal ? styles.tabActive : ""}`}
          onClick={() => setTab("personal")}
          type="button"
        >
          パーソナル（会話から自動抽出）
        </button>
        <button
          className={`${styles.tabButton} ${!isPersonal ? styles.tabActive : ""}`}
          onClick={() => setTab("basics")}
          type="button"
        >
          基本情報（運営入力/管理者）
        </button>
      </div>
      <div className={styles.tabBody}>
        <ProfileSection fields={activeFields} />
      </div>
    </div>
  );
}

function FieldList({ label, items, pill }: { label: string; items: string[]; pill?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={styles.fieldGroup}>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={pill ? styles.pillRow : styles.listRow}>
        {items.map((item) =>
          pill ? (
            <span key={item} className={styles.pill}>
              {item}
            </span>
          ) : (
            <div key={item} className={styles.listItem}>
              {item}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function DeltaList({ delta }: { delta: any }) {
  const personal = Object.entries(delta?.personal ?? {});
  const basics = Object.entries(delta?.basics ?? {});
  if (personal.length === 0 && basics.length === 0) {
    return (
      <div className={styles.fieldGroup}>
        <div className={styles.fieldLabel}>カルテ更新差分</div>
        <div className={styles.subtext}>今回の会話で更新された項目はありません。</div>
      </div>
    );
  }
  return (
    <div className={styles.fieldGroup}>
      <div className={styles.fieldLabel}>カルテ更新差分</div>
      <div className={styles.deltaGrid}>
        {personal.length > 0 && (
          <div>
            <div className={styles.deltaTitle}>パーソナル</div>
            {personal.map(([key, value]: any) => (
              <div key={key} className={styles.deltaItem}>
                <span className={styles.fieldKey}>{key}</span>
                <span>{value?.value}</span>
              </div>
            ))}
          </div>
        )}
        {basics.length > 0 && (
          <div>
            <div className={styles.deltaTitle}>基本情報</div>
            {basics.map(([key, value]: any) => (
              <div key={key} className={styles.deltaItem}>
                <span className={styles.fieldKey}>{key}</span>
                <span>{value?.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
