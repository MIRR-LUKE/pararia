"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import styles from "./studentDetail.module.css";
import { StudentRecorder } from "./StudentRecorder";

const STATUS_TONE: Record<string, "neutral" | "low" | "medium" | "high"> = {
  PROCESSING: "medium",
  PARTIAL: "medium",
  DONE: "low",
  ERROR: "high",
};

const STATUS_LABEL: Record<string, string> = {
  PROCESSING: "処理中",
  PARTIAL: "一部完了",
  DONE: "完了",
  ERROR: "エラー",
};

type StudentData = {
  id: string;
  name: string;
  nameKana?: string | null;
  grade?: string | null;
  course?: string | null;
  guardianNames?: string | null;
  enrollmentDate?: string | null;
  birthdate?: string | null;
  profiles?: Array<{ profileData?: any }>;
  reports?: Array<{ id: string; reportMarkdown: string; createdAt: string } | null>;
};

type ProfileData = {
  basic?: Array<{ field: string; value: string; confidence: number; evidence_quotes: string[]; updatedAt?: string }>;
  personal?: Array<{ field: string; value: string; confidence: number; evidence_quotes: string[]; updatedAt?: string }>;
  lastUpdatedFromLogId?: string;
};

type ConversationLog = {
  id: string;
  studentId: string;
  status: string;
  summaryMarkdown?: string | null;
  timelineJson?: any;
  nextActionsJson?: any;
  createdAt: string;
};

export default function StudentDetailPage({ params }: { params: { studentId: string } }) {
  const [student, setStudent] = useState<StudentData | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [reports, setReports] = useState<StudentData["reports"]>([]);
  const [logs, setLogs] = useState<ConversationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"profile" | "logs" | "report">("profile");
  const [editingBasic, setEditingBasic] = useState(false);
  const [basicDraft, setBasicDraft] = useState({
    name: "",
    nameKana: "",
    grade: "",
    course: "",
    guardianNames: "",
    enrollmentDate: "",
    birthdate: "",
  });
  const [selectedLogs, setSelectedLogs] = useState<string[]>([]);
  const [usePreviousReport, setUsePreviousReport] = useState(true);
  const [reportMarkdown, setReportMarkdown] = useState("");
  const [reportPdf, setReportPdf] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const tabBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    tabBodyRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  const fetchStudent = useCallback(async () => {
    try {
      const res = await fetch(`/api/students/${params.studentId}`);
      if (!res.ok) {
        setStudent(null);
        setLoading(false);
        return;
      }
      const data = await res.json();
      const fetched = data.student as StudentData;
      setStudent(fetched);
      setReports(fetched.reports ?? []);
      const profileData = (fetched.profiles?.[0]?.profileData ?? {}) as ProfileData;
      setProfile(profileData);
      setBasicDraft({
        name: fetched.name ?? "",
        nameKana: fetched.nameKana ?? "",
        grade: fetched.grade ?? "",
        course: fetched.course ?? "",
        guardianNames: fetched.guardianNames ?? "",
        enrollmentDate: fetched.enrollmentDate ? fetched.enrollmentDate.slice(0, 10) : "",
        birthdate: fetched.birthdate ? fetched.birthdate.slice(0, 10) : "",
      });
    } catch (error) {
      console.error("[StudentDetail] fetchStudent failed", error);
    }
  }, [params.studentId]);

  const refreshLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversations?studentId=${params.studentId}`);
      if (!res.ok) return;
      const data = await res.json();
      const fetchedLogs = (data.conversations ?? []).map((log: any) => ({
        id: log.id,
        studentId: log.studentId,
        status: log.status,
        summaryMarkdown: log.summaryMarkdown,
        timelineJson: log.timelineJson,
        nextActionsJson: log.nextActionsJson,
        createdAt: log.createdAt,
      }));
      fetchedLogs.sort((a: ConversationLog, b: ConversationLog) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setLogs(fetchedLogs);
    } catch (error) {
      console.error("[StudentDetail] refreshLogs failed", error);
    }
  }, [params.studentId]);

  useEffect(() => {
    setLoading(true);
    fetchStudent().finally(() => setLoading(false));
    refreshLogs();
  }, [fetchStudent, refreshLogs]);

  const completeness = useMemo(() => {
    const basicCount = profile?.basic?.length ?? 0;
    const personalCount = profile?.personal?.length ?? 0;
    const total = basicCount + personalCount;
    return Math.min(100, total * 6);
  }, [profile]);

  const latestLog = logs[0];

  const toggleLog = (id: string) => {
    setSelectedLogs((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]
    );
  };

  const handleSaveBasic = async () => {
    if (!student) return;
    try {
      const res = await fetch(`/api/students/${student.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: basicDraft.name,
          nameKana: basicDraft.nameKana,
          grade: basicDraft.grade,
          course: basicDraft.course,
          guardianNames: basicDraft.guardianNames,
          enrollmentDate: basicDraft.enrollmentDate || null,
          birthdate: basicDraft.birthdate || null,
        }),
      });
      if (!res.ok) throw new Error("更新に失敗しました");
      setEditingBasic(false);
      await fetchStudent();
    } catch (e: any) {
      alert(e?.message ?? "更新に失敗しました");
    }
  };

  const handleGenerateReport = async () => {
    if (!student) return;
    if (selectedLogs.length === 0) {
      alert("生成に使用する会話ログを選択してください");
      return;
    }
    try {
      setReportLoading(true);
      setReportPdf(null);
      const res = await fetch("/api/ai/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: student.id,
          logIds: selectedLogs,
          usePreviousReport,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "生成に失敗しました");
      }
      const data = await res.json();
      setReportMarkdown(data.report.reportMarkdown ?? "");
      setReportPdf(data.pdfBase64 ?? null);
      if (data.pdfError) {
        alert(`レポート本文は生成できましたが、PDF生成に失敗しました: ${data.pdfError}`);
      }
      await fetchStudent();
    } catch (e: any) {
      alert(e?.message ?? "生成に失敗しました");
    } finally {
      setReportLoading(false);
    }
  };

  if (loading) return <div className={styles.empty}>読み込み中...</div>;
  if (!student) return <div className={styles.empty}>生徒が見つかりません。</div>;

  return (
    <div>
      <AppHeader
        title={`${student.name}${student.grade ? ` / ${student.grade}` : ""}`}
        subtitle={`最終会話: ${latestLog ? new Date(latestLog.createdAt).toLocaleDateString("ja-JP") : "未会話"} ｜ 会話ログ ${logs.length}件`}
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href="#record">
              <Button size="small" variant="primary">
                録音して会話ログを追加
              </Button>
            </a>
          </div>
        }
      />

      <div className={styles.sectionStack} id="record">
        <Card title="録音・アップロード" subtitle="録音→文字起こし→構造化→カルテ更新を一気通貫で実行">
          <StudentRecorder
            studentName={student.name}
            studentId={student.id}
            fallbackLogId={latestLog?.id}
            onLogCreated={refreshLogs}
          />
        </Card>

        <Card
          title="カルテ概要"
          subtitle="会話が溜まるほど自動で更新。最新プロフィールを表示します。"
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
              <div className={styles.subtext}>最終: {latestLog ? new Date(latestLog.createdAt).toLocaleDateString("ja-JP") : "未会話"}</div>
            </div>
          </div>

          <div className={styles.tabShell}>
            <div className={styles.tabBar}>
              <button
                className={`${styles.tabButton} ${tab === "profile" ? styles.tabActive : ""}`}
                onClick={() => setTab("profile")}
                type="button"
              >
                カルテ
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
                {tab === "profile" && (
                  <div className={styles.cardGrid}>
                    <Card
                      title="生徒基本情報（運営入力）"
                      subtitle="氏名・学年・保護者は手動編集できます"
                      action={
                        <Button size="small" variant="secondary" onClick={() => setEditingBasic((v) => !v)}>
                          {editingBasic ? "閉じる" : "編集"}
                        </Button>
                      }
                    >
                      {editingBasic ? (
                        <div className={styles.fieldList}>
                          <label className={styles.fieldLabel}>氏名</label>
                          <input
                            className={styles.input}
                            value={basicDraft.name}
                            onChange={(e) => setBasicDraft((p) => ({ ...p, name: e.target.value }))}
                          />
                          <label className={styles.fieldLabel}>フリガナ</label>
                          <input
                            className={styles.input}
                            value={basicDraft.nameKana}
                            onChange={(e) => setBasicDraft((p) => ({ ...p, nameKana: e.target.value }))}
                          />
                          <label className={styles.fieldLabel}>学年</label>
                          <input
                            className={styles.input}
                            value={basicDraft.grade}
                            onChange={(e) => setBasicDraft((p) => ({ ...p, grade: e.target.value }))}
                          />
                          <label className={styles.fieldLabel}>コース</label>
                          <input
                            className={styles.input}
                            value={basicDraft.course}
                            onChange={(e) => setBasicDraft((p) => ({ ...p, course: e.target.value }))}
                          />
                          <label className={styles.fieldLabel}>保護者</label>
                          <input
                            className={styles.input}
                            value={basicDraft.guardianNames}
                            onChange={(e) => setBasicDraft((p) => ({ ...p, guardianNames: e.target.value }))}
                          />
                          <label className={styles.fieldLabel}>入塾日</label>
                          <input
                            className={styles.input}
                            type="date"
                            value={basicDraft.enrollmentDate}
                            onChange={(e) => setBasicDraft((p) => ({ ...p, enrollmentDate: e.target.value }))}
                          />
                          <label className={styles.fieldLabel}>生年月日</label>
                          <input
                            className={styles.input}
                            type="date"
                            value={basicDraft.birthdate}
                            onChange={(e) => setBasicDraft((p) => ({ ...p, birthdate: e.target.value }))}
                          />
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <Button size="small" variant="primary" onClick={handleSaveBasic}>
                              保存
                            </Button>
                            <Button size="small" variant="ghost" onClick={() => setEditingBasic(false)}>
                              キャンセル
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className={styles.fieldList}>
                          <div className={styles.fieldRow}>
                            <div className={styles.fieldKey}>氏名</div>
                            <div className={styles.fieldValue}>{student.name}</div>
                          </div>
                          <div className={styles.fieldRow}>
                            <div className={styles.fieldKey}>フリガナ</div>
                            <div className={styles.fieldValue}>{student.nameKana ?? "未設定"}</div>
                          </div>
                          <div className={styles.fieldRow}>
                            <div className={styles.fieldKey}>学年</div>
                            <div className={styles.fieldValue}>{student.grade ?? "未設定"}</div>
                          </div>
                          <div className={styles.fieldRow}>
                            <div className={styles.fieldKey}>コース</div>
                            <div className={styles.fieldValue}>{student.course ?? "未設定"}</div>
                          </div>
                          <div className={styles.fieldRow}>
                            <div className={styles.fieldKey}>保護者</div>
                            <div className={styles.fieldValue}>{student.guardianNames ?? "未設定"}</div>
                          </div>
                        </div>
                      )}
                    </Card>

                    <Card title="カルテ（基本）" subtitle="会話ログから自動抽出">
                      <ProfileList items={profile?.basic ?? []} emptyLabel="基本情報の更新候補がありません" />
                    </Card>
                    <Card title="カルテ（パーソナル）" subtitle="趣味嗜好・関心の記録">
                      <ProfileList items={profile?.personal ?? []} emptyLabel="パーソナル情報の更新候補がありません" />
                    </Card>
                  </div>
                )}

                {tab === "logs" && (
                  <div>
                    {logs.length === 0 ? (
                      <div className={styles.empty}>まだ会話ログがありません。録音して追加してください。</div>
                    ) : (
                      <div className={styles.logList}>
                        {logs.map((log) => (
                          <div key={log.id} className={styles.logRowCard}>
                            <Link href={`/app/logs/${log.id}`} className={styles.logRowLink}>
                              <div className={styles.logRowTop}>
                                <div className={styles.logTitle}>
                                  {new Date(log.createdAt).toLocaleDateString("ja-JP")}
                                </div>
                                <Badge label={STATUS_LABEL[log.status] ?? log.status} tone={STATUS_TONE[log.status] ?? "neutral"} />
                              </div>
                              <div className={styles.logSummary}>
                                {log.summaryMarkdown?.split("\n").slice(0, 2).join(" ") || "会話ログ"}
                              </div>
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {tab === "report" && (
                  <div className={styles.reportRow}>
                    <div className={styles.reportActions}>
                      <div className={styles.fieldGroup}>
                        <div className={styles.fieldLabel}>生成に使う会話ログを選択</div>
                        <div className={styles.listRow}>
                          {logs.map((log) => (
                            <label key={log.id} className={styles.listItem}>
                              <input
                                type="checkbox"
                                checked={selectedLogs.includes(log.id)}
                                onChange={() => toggleLog(log.id)}
                              />
                              <span style={{ marginLeft: 8 }}>
                                {new Date(log.createdAt).toLocaleDateString("ja-JP")} / {log.summaryMarkdown?.slice(0, 30) ?? "会話ログ"}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <label className={styles.fieldRow} style={{ alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={usePreviousReport}
                          onChange={() => setUsePreviousReport((v) => !v)}
                        />
                        <span>前回レポートを参照する</span>
                      </label>

                      <Button size="small" variant="primary" onClick={handleGenerateReport} disabled={reportLoading}>
                        {reportLoading ? "生成中..." : "AIで保護者レポートを生成"}
                      </Button>

                      <div className={styles.subtext}>選択したログからレポートを生成し、PDFも作成します。</div>

                      <Card title="レポート履歴（最新5件）">
                        {reports && reports.length > 0 ? (
                          <div className={styles.listRow}>
                            {reports.map((r) => (
                              <div key={r?.id ?? Math.random()} className={styles.listItem}>
                                {r?.createdAt ? new Date(r.createdAt).toLocaleDateString("ja-JP") : "日付不明"}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className={styles.subtext}>レポートはまだありません。</div>
                        )}
                      </Card>
                    </div>

                    <div className={styles.reportPreview}>
                      <Card title="生成結果（Markdown）">
                        <textarea
                          className={styles.textarea}
                          value={reportMarkdown}
                          onChange={(e) => setReportMarkdown(e.target.value)}
                          placeholder="生成結果がここに表示されます"
                          style={{ minHeight: 240 }}
                        />
                        {reportPdf && (
                          <a
                            href={`data:application/pdf;base64,${reportPdf}`}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.subtext}
                            style={{ display: "inline-block", marginTop: 8 }}
                          >
                            PDFを開く
                          </a>
                        )}
                      </Card>
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

function ProfileList({
  items,
  emptyLabel,
}: {
  items: Array<{ field: string; value: string; confidence: number; evidence_quotes: string[]; updatedAt?: string }>;
  emptyLabel: string;
}) {
  if (!items || items.length === 0) {
    return <div className={styles.subtext}>{emptyLabel}</div>;
  }
  return (
    <div className={styles.fieldList}>
      {items.map((item, idx) => (
        <div key={`${item.field}-${idx}`} className={styles.fieldRow}>
          <div className={styles.fieldKey}>{item.field}</div>
          <div className={styles.fieldValue}>{item.value}</div>
          <div className={styles.fieldMeta}>confidence {item.confidence}</div>
          {item.evidence_quotes?.length > 0 && (
            <div className={styles.fieldMeta}>引用: {item.evidence_quotes.join(" / ")}</div>
          )}
        </div>
      ))}
    </div>
  );
}
