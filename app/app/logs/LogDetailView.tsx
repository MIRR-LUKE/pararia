"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import styles from "./[logId]/logDetail.module.css";

type ConversationStatus = "PROCESSING" | "PARTIAL" | "DONE" | "ERROR";

type TimelineItem = {
  title: string;
  what_happened: string;
  coach_point: string;
  student_state: string;
  evidence_quotes: string[];
};

type NextAction = {
  owner: "COACH" | "STUDENT" | "PARENT";
  action: string;
  due: string | null;
  metric: string;
  why: string;
};

type ProfileDeltaItem = {
  field: string;
  value: string;
  confidence: number;
  evidence_quotes: string[];
};

type ProfileDelta = {
  basic: ProfileDeltaItem[];
  personal: ProfileDeltaItem[];
};

type ConversationJob = {
  id: string;
  type: string;
  status: string;
  model?: string | null;
  lastError?: string | null;
};

type ConversationLog = {
  id: string;
  studentId: string;
  status: ConversationStatus;
  summaryMarkdown?: string | null;
  timelineJson?: TimelineItem[] | null;
  nextActionsJson?: NextAction[] | null;
  profileDeltaJson?: ProfileDelta | null;
  formattedTranscript?: string | null;
  createdAt: string;
  student?: {
    id: string;
    name: string;
  } | null;
  user?: {
    id: string;
    name: string;
  } | null;
  jobs?: ConversationJob[];
};

type Props = {
  logId: string;
  showHeader?: boolean;
  onBack?: () => void;
};

const STATUS_LABEL: Record<ConversationStatus, string> = {
  PROCESSING: "処理中",
  PARTIAL: "一部完了",
  DONE: "完了",
  ERROR: "エラー",
};

export function LogDetailView({ logId, showHeader = true, onBack }: Props) {
  const router = useRouter();
  const [log, setLog] = useState<ConversationLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "timeline" | "todo" | "transcript">("summary");
  const [regenerating, setRegenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedSummary, setEditedSummary] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchLog = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/conversations/${logId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("ログが見つかりません");
        } else {
          setError(`エラー: ${res.status}`);
        }
        setLog(null);
        return;
      }
      const data = await res.json();
      setLog(data.conversation);
      setEditedSummary(data.conversation.summaryMarkdown || "");
    } catch (e: any) {
      console.error("[LogDetailView] Failed to fetch log:", e);
      setError(e?.message ?? "ログの取得に失敗しました");
      setLog(null);
    } finally {
      setLoading(false);
    }
  }, [logId]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const runJobsUntilDone = useCallback(async () => {
    const maxWaitTime = 300000; // 5分
    const pollInterval = 2500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        await fetch(`/api/jobs/run?limit=2`, { method: "POST" });
      } catch (jobError) {
        console.warn("[LogDetailView] Job runner error:", jobError);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      const res = await fetch(`/api/conversations/${logId}`);
      if (res.ok) {
        const data = await res.json();
        setLog(data.conversation);
        if (data.conversation.status === "DONE") break;
      }
    }
  }, [logId]);

  useEffect(() => {
    if (!log) return;
    if (log.status === "PROCESSING" || log.status === "PARTIAL") {
      runJobsUntilDone();
    }
  }, [log, runJobsUntilDone]);

  const handleRegenerate = async () => {
    if (!log || regenerating) return;

    if (!confirm("会話ログを再生成しますか？\n\nSummary/Timeline/ToDo/全文が再生成されます。")) {
      return;
    }

    try {
      setRegenerating(true);
      const res = await fetch(`/api/conversations/${logId}/regenerate`, {
        method: "POST",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || `再生成に失敗しました (${res.status})`);
      }

      await fetchLog();
      await runJobsUntilDone();
    } catch (e: any) {
      console.error("[LogDetailView] Regenerate failed:", e);
      alert(`再生成に失敗しました: ${e?.message ?? "不明なエラー"}`);
    } finally {
      setRegenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!log) return;

    if (!confirm("会話ログを削除しますか？\n\nこの操作は取り消せません。")) {
      return;
    }

    try {
      const res = await fetch(`/api/conversations/${logId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || `削除に失敗しました (${res.status})`);
      }

      const data = await res.json();
      alert("会話ログを削除しました");

      if (data.studentId) {
        router.push(`/app/students/${data.studentId}#logs`);
      } else {
        router.push("/app/students");
      }
    } catch (e: any) {
      console.error("[LogDetailView] Delete failed:", e);
      alert(`削除に失敗しました: ${e?.message ?? "不明なエラー"}`);
    }
  };

  const handleSave = async () => {
    if (!log || saving) return;

    try {
      setSaving(true);
      const res = await fetch(`/api/conversations/${logId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summaryMarkdown: editedSummary,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || `保存に失敗しました (${res.status})`);
      }

      const data = await res.json();
      setLog(data.conversation);
      setEditing(false);
    } catch (e: any) {
      console.error("[LogDetailView] Save failed:", e);
      alert(`保存に失敗しました: ${e?.message ?? "不明なエラー"}`);
    } finally {
      setSaving(false);
    }
  };

  const summaryLines = useMemo(() => {
    if (!log?.summaryMarkdown) return [];
    return log.summaryMarkdown.split("\n").filter((line) => line.trim().length > 0);
  }, [log?.summaryMarkdown]);

  if (loading) return <div className={styles.subtext}>読み込み中...</div>;
  if (error) return <div className={styles.subtext}>{error}</div>;
  if (!log) return <div className={styles.subtext}>ログがありません。</div>;

  return (
    <div className={styles.section}>
      {showHeader && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>会話ログ詳細</div>
              <div className={styles.subtext}>
                {log.student?.name ?? "生徒"} / {new Date(log.createdAt).toLocaleDateString("ja-JP")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Badge label={STATUS_LABEL[log.status]} tone={log.status === "DONE" ? "low" : "medium"} />
              <Button size="small" variant="secondary" onClick={handleRegenerate} disabled={regenerating}>
                再生成
              </Button>
              <Button size="small" variant="ghost" onClick={handleDelete}>
                削除
              </Button>
              <Link href={`/app/students/${log.studentId}#logs`}>
                <Button size="small" variant="ghost">← 会話ログ一覧へ</Button>
              </Link>
            </div>
          </div>
        </Card>
      )}

      <div className={styles.filterChips}>
        {([
          { key: "summary", label: "要点" },
          { key: "timeline", label: "タイムライン" },
          { key: "todo", label: "ToDo" },
          { key: "transcript", label: "全文" },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${styles.chipButton} ${tab === t.key ? styles.active : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "summary" && (
        <div className={styles.cardGrid}>
          <Card
            title="面談サマリー"
            subtitle="事実・指導の核・次回方針を統合"
            action={
              <div style={{ display: "flex", gap: 6 }}>
                {editing ? (
                  <>
                    <Button size="small" variant="primary" onClick={handleSave} disabled={saving}>
                      {saving ? "保存中…" : "保存"}
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => setEditing(false)}>
                      キャンセル
                    </Button>
                  </>
                ) : (
                  <Button size="small" variant="secondary" onClick={() => setEditing(true)}>
                    編集
                  </Button>
                )}
              </div>
            }
          >
            {editing ? (
              <textarea
                className={styles.raw}
                value={editedSummary}
                onChange={(e) => setEditedSummary(e.target.value)}
                style={{ minHeight: 240 }}
              />
            ) : (
              <div className={styles.raw}>
                {summaryLines.map((line, idx) => {
                  if (line.startsWith("## ")) {
                    return <h3 key={idx}>{line.replace("## ", "").trim()}</h3>;
                  }
                  const html = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
                  return <p key={idx} dangerouslySetInnerHTML={{ __html: html }} />;
                })}
                {summaryLines.length === 0 && <div className={styles.subtext}>サマリー生成中...</div>}
              </div>
            )}
          </Card>

          <Card title="カルテ更新（今回の抽出）" subtitle="basic / personal の更新候補">
            <div className={styles.twoCol}>
              <div className={styles.block}>
                <div className={styles.heading}>基本情報</div>
                {log.profileDeltaJson?.basic?.length ? (
                  log.profileDeltaJson.basic.map((item, idx) => (
                    <div key={`${item.field}-${idx}`}>
                      <div style={{ fontWeight: 700 }}>{item.field}</div>
                      <div>{item.value}</div>
                      <div className={styles.subtext}>confidence {item.confidence}</div>
                      <div className={styles.subtext}>引用: {(item.evidence_quotes ?? []).join(" / ")}</div>
                    </div>
                  ))
                ) : (
                  <div className={styles.subtext}>更新候補なし</div>
                )}
              </div>
              <div className={styles.block}>
                <div className={styles.heading}>パーソナル</div>
                {log.profileDeltaJson?.personal?.length ? (
                  log.profileDeltaJson.personal.map((item, idx) => (
                    <div key={`${item.field}-${idx}`}>
                      <div style={{ fontWeight: 700 }}>{item.field}</div>
                      <div>{item.value}</div>
                      <div className={styles.subtext}>confidence {item.confidence}</div>
                      <div className={styles.subtext}>引用: {(item.evidence_quotes ?? []).join(" / ")}</div>
                    </div>
                  ))
                ) : (
                  <div className={styles.subtext}>更新候補なし</div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === "timeline" && (
        <Card title="話題タイムライン" subtitle="話題ごとの要約と根拠引用">
          <div className={styles.timeline}>
            {log.timelineJson?.length ? (
              log.timelineJson.map((item, idx) => (
                <div key={`${item.title}-${idx}`} className={styles.block}>
                  <div className={styles.heading}>{item.title}</div>
                  <div className={styles.subtext}>何が分かったか</div>
                  <div>{item.what_happened}</div>
                  <div className={styles.subtext}>指導ポイント</div>
                  <div>{item.coach_point}</div>
                  <div className={styles.subtext}>生徒の状態</div>
                  <div>{item.student_state}</div>
                  <div className={styles.badgeList}>
                    {(item.evidence_quotes ?? []).map((q, qidx) => (
                      <span key={`${qidx}-${q}`} className={styles.pill}>
                        {q}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.subtext}>タイムライン生成中...</div>
            )}
          </div>
        </Card>
      )}

      {tab === "todo" && (
        <Card title="次アクション" subtitle="担当・期限・指標を明確に">
          <div className={styles.todoList}>
            {log.nextActionsJson?.length ? (
              log.nextActionsJson.map((action, idx) => (
                <div key={`${action.action}-${idx}`} className={styles.todoRow}>
                  <div className={styles.pill}>{action.owner}</div>
                  <div className={styles.todoContent}>
                    <div style={{ fontWeight: 700 }}>{action.action}</div>
                    <div className={styles.subtext}>期限: {action.due ?? "次回面談まで"}</div>
                    <div className={styles.subtext}>指標: {action.metric}</div>
                    <div className={styles.subtext}>根拠: {action.why}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.subtext}>ToDo生成中...</div>
            )}
          </div>
        </Card>
      )}

      {tab === "transcript" && (
        <Card title="全文（整形済み）" subtitle="話者ラベルと段落で読みやすく整理">
          <div className={styles.raw}>
            {(log.formattedTranscript || "").split("\n").map((line, idx) => {
              if (line.startsWith("**")) {
                const match = line.match(/^\*\*(.+?)\*\*:\s*(.*)$/);
                if (match) {
                  const speaker = match[1];
                  const text = match[2];
                  const className = speaker.includes("先生")
                    ? styles["speaker-teacher"]
                    : speaker.includes("さん")
                    ? styles["speaker-student"]
                    : styles["speaker-unknown"];
                  return (
                    <div key={idx} className={styles["speech-line"]}>
                      <span className={className}>{speaker}:</span> {text}
                    </div>
                  );
                }
              }
              return <p key={idx}>{line}</p>;
            })}
            {!log.formattedTranscript && <div className={styles.subtext}>全文生成中...</div>}
          </div>
        </Card>
      )}
    </div>
  );
}
