"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import styles from "./[logId]/logDetail.module.css";
import { getStudentById } from "@/lib/mockData";
import { Icon } from "@/components/ui/Icon";
import { DEFAULT_TEACHER_FULL_NAME } from "@/lib/constants";

type JobStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

type TimelineItem = {
  topic: string;
  summary: string;
};

type ConversationLog = {
  id: string;
  studentId: string;
  userId?: string | null;
  summary: string;
  timeline?: TimelineItem[] | null;
  nextActions: string[] | null;
  structuredDelta: any;
  rawTextOriginal?: string;
  rawTextCleaned?: string;
  formattedTranscript?: string | null;
  summaryStatus?: JobStatus;
  extractStatus?: JobStatus;
  summaryError?: string | null;
  extractError?: string | null;
  createdAt: string;
  student?: {
    id: string;
    name: string;
  } | null;
  user?: {
    id: string;
    name: string;
  } | null;
};

type Props = {
  logId: string;
  showHeader?: boolean;
  onBack?: () => void;
};

export function LogDetailView({ logId, showHeader = true, onBack }: Props) {
  const router = useRouter();
  const [log, setLog] = useState<ConversationLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"insights" | "transcript">("insights");
  const [regenerating, setRegenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedSummary, setEditedSummary] = useState("");
  const [editedFormattedTranscript, setEditedFormattedTranscript] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function fetchLog() {
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
        setEditedSummary(data.conversation.summary || "");
        setEditedFormattedTranscript(data.conversation.formattedTranscript || "");
      } catch (e: any) {
        console.error("[LogDetailView] Failed to fetch log:", e);
        setError(e?.message ?? "ログの取得に失敗しました");
        setLog(null);
      } finally {
        setLoading(false);
      }
    }
    fetchLog();
  }, [logId]);

  // Note: LLM processing is completed before navigating to this page
  // No polling needed here

  const handleRegenerate = async () => {
    if (!log || regenerating) return;
    
    if (!confirm("会話ログを再生成しますか？\n\nサマリー、タイムライン、全文整形が再生成されます。数分かかる場合があります。")) {
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

      const data = await res.json();
      
      // ステータスをリセットして再取得
      setLog((prev) => prev ? {
        ...prev,
        summary: "",
        title: null,
        timeline: null,
        nextActions: null,
        formattedTranscript: null,
        summaryStatus: "PENDING",
        extractStatus: "PENDING",
        summaryError: null,
        extractError: null,
      } : null);

      // ポーリングを開始して完了を待つ
      const maxWaitTime = 300000; // 5分
      const pollInterval = 2000; // 2秒ごと
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        
        try {
          const statusRes = await fetch(`/api/conversations/${logId}`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            const updatedLog = statusData.conversation;
            const summaryDone = updatedLog.summaryStatus === "SUCCESS";
            const extractDone = updatedLog.extractStatus === "SUCCESS";
            
            if (summaryDone && extractDone) {
              setLog(updatedLog);
              alert("再生成が完了しました！");
              break;
            }
            
            // 途中経過を更新
            setLog(updatedLog);
          }
        } catch (pollError) {
          console.error("[LogDetailView] Poll error:", pollError);
        }
      }

      // 最終的な状態を取得
      const finalRes = await fetch(`/api/conversations/${logId}`);
      if (finalRes.ok) {
        const finalData = await finalRes.json();
        setLog(finalData.conversation);
      }
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
      
      // Navigate back to student page
      if (data.studentId) {
        router.push(`/app/students/${data.studentId}#logs`);
      } else if (student) {
        router.push(`/app/students/${student.id}#logs`);
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
          summary: editedSummary,
          formattedTranscript: editedFormattedTranscript,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || `保存に失敗しました (${res.status})`);
      }

      const data = await res.json();
      setLog(data.conversation);
      setEditing(false);
      alert("保存しました");
    } catch (e: any) {
      console.error("[LogDetailView] Save failed:", e);
      alert(`保存に失敗しました: ${e?.message ?? "不明なエラー"}`);
    } finally {
      setSaving(false);
    }
  };

  const student = log?.student
    ? { id: log.student.id, name: log.student.name }
    : log
    ? getStudentById(log.studentId)
    : undefined;
  const pickShortName = (name?: string) => {
    if (!name) return "";
    const cleaned = name.trim();
    if (!cleaned) return "";
    const parts = cleaned.split(/[\s　]+/).filter(Boolean);
    if (parts.length > 1) return parts[0];
    const hasLatin = /[A-Za-z]/.test(cleaned);
    if (!hasLatin && cleaned.length >= 3) return cleaned.slice(0, 2);
    return cleaned;
  };
  const formatStudentLabel = (name?: string) => {
    if (!name) return "生徒";
    const base = pickShortName(name);
    if (!base || base === "生徒") return "生徒";
    return /[様さん先生くん君]$/.test(base) ? base : `${base}さん`;
  };
  const formatTeacherLabel = (name?: string) => {
    const base = pickShortName(name || DEFAULT_TEACHER_FULL_NAME);
    if (!base || base === "講師") return "講師";
    return /[様さん先生くん君]$/.test(base) ? base : `${base}先生`;
  };
  const studentLabel = formatStudentLabel(student?.name);
  const teacherLabel = formatTeacherLabel(log?.user?.name ?? DEFAULT_TEACHER_FULL_NAME);

  const goBackToList = () => {
    if (onBack) return onBack();
    if (student) {
      router.push(`/app/students/${student.id}#logs`);
    } else {
      router.push("/app/students");
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <p>読み込み中...</p>
      </div>
    );
  }

  if (error || !log) {
    return (
      <div style={{ padding: 24 }}>
        <p>{error || "ログが見つかりません。"}</p>
        <Button onClick={goBackToList}>戻る</Button>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Button size="small" variant="secondary" onClick={goBackToList}>
            <Icon name="arrowLeft" /> 会話ログ一覧に戻る
          </Button>
          {!showHeader && student && (
            <Button size="small" variant="ghost" onClick={() => router.push(`/app/students/${student.id}`)}>
              <Icon name="arrowLeft" /> カルテへ戻る
            </Button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {editing ? (
            <>
              <Button
                size="small"
                variant="primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "保存中..." : "保存"}
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setEditedSummary(log?.summary || "");
                  setEditedFormattedTranscript(log?.formattedTranscript || "");
                }}
                disabled={saving}
              >
                キャンセル
              </Button>
            </>
          ) : (
            <>
              <Button
                size="small"
                variant="secondary"
                onClick={() => setEditing(true)}
              >
                編集
              </Button>
              {log && log.rawTextOriginal && (
                <div style={{ position: "relative" }}>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    title="サマリー・タイムライン・全文整形を再生成します"
                  >
                    再生成
                  </Button>
                  {regenerating && (
                    <div className={styles.regeneratingOverlay}>
                      <div className={styles.loadingBar}>
                        <div className={styles.loadingBarFill}></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <Button
                size="small"
                variant="secondary"
                onClick={handleDelete}
                style={{ color: "#dc2626" }}
              >
                削除
              </Button>
            </>
          )}
        </div>
      </div>

      {showHeader && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Badge label={`生徒: ${student?.name ?? log.student?.name ?? "不明"}`} />
            <Badge label={`担当: ${log.user?.name ?? "不明"}`} />
            <Badge label={`日付: ${new Date(log.createdAt).toLocaleDateString("ja-JP")}`} />
          </div>
        </div>
      )}

      <Card 
        title="会話ログ（意思決定のための資産）" 
        subtitle="このログは記録ではなく、講師の次の行動を決めるための資産です。"
      >
        <div className={styles.tabBar}>
          <button
            type="button"
            className={`${styles.tabButton} ${tab === "insights" ? styles.tabActive : ""}`}
            onClick={() => setTab("insights")}
          >
            要約・抽出
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${tab === "transcript" ? styles.tabActive : ""}`}
            onClick={() => setTab("transcript")}
          >
            全文データ
          </button>
        </div>

        {tab === "transcript" ? (
            <div className={styles.section}>
                <div className={styles.block}>
              <h3 className={styles.heading}>全文データ</h3>
              <div className={styles.subtext}>
                話題ごとに見出しをつけ、講師と生徒の発言を分けて整形したテキストです。
              </div>
              {editing ? (
                <textarea
                  value={editedFormattedTranscript}
                  onChange={(e) => setEditedFormattedTranscript(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: "400px",
                    padding: "12px",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    fontFamily: "inherit",
                    fontSize: "14px",
                    lineHeight: "1.6",
                  }}
                />
              ) : log.formattedTranscript ? (
                <div 
                  className={styles.raw}
                  dangerouslySetInnerHTML={{ 
                    __html: log.formattedTranscript
                      .split('\n')
                      .map((line, idx, arr) => {
                        // 見出し（## で始まる行）
                        if (line.startsWith('## ')) {
                          return `<h3>${line.replace(/^## /, '')}</h3>`;
                        }
                        const escapeRegExp = (value: string) =>
                          value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        // 講師/生徒の発言
                        if (line.includes('**')) {
                          const teacherRegex = new RegExp(`\\*\\*${escapeRegExp(teacherLabel)}\\*\\*:`, 'g');
                          const studentRegex = new RegExp(`\\*\\*${escapeRegExp(studentLabel)}\\*\\*:`, 'g');
                          const formatted = line
                            .replace(teacherRegex, `<strong class="speaker-teacher">${teacherLabel}:</strong>`)
                            .replace(studentRegex, `<strong class="speaker-student">${studentLabel}:</strong>`)
                            .replace(/\*\*話者不明\*\*:/g, '<strong class="speaker-unknown">話者不明:</strong>')
                            .replace(/\*\*講師\*\*:/g, '<strong class="speaker-teacher">講師:</strong>')
                            .replace(/\*\*生徒\*\*:/g, '<strong class="speaker-student">生徒:</strong>');
                          return `<p class="speech-line">${formatted}</p>`;
                        }
                        // 空行
                        if (line.trim() === '') {
                          return '';
                        }
                        // 通常の行
                        return `<p>${line}</p>`;
                      })
                      .filter(Boolean)
                      .join('')
                  }}
                />
              ) : (
                <div className={styles.raw}>{log.rawTextOriginal || log.rawTextCleaned || "（まだありません）"}</div>
              )}
            </div>
              </div>
        ) : (
        <div className={styles.section}>
          {/* ① 会話サマリー */}
          <div className={styles.summaryBlock}>
            <div className={styles.summaryHeader}>
              <h3 className={styles.summaryTitle}>会話サマリー</h3>
              <span className={styles.summarySubtitle}>この会話で何が分かり、何が更新されたか</span>
            </div>
            {log.summaryStatus && log.summaryStatus !== "SUCCESS" ? (
              <div className={styles.loadingCard}>
                <div className={styles.loadingHeader}>
                  <span className={styles.spinner} aria-hidden />
                  <div>
                    <div className={styles.loadingTitle}>再生成中</div>
                    <div className={styles.loadingHint}>
                      全文データは先に確認できます。数十秒〜数分で自動反映されます。
                    </div>
                  </div>
                  <span className={styles.loadingTag}>Job A / GPT-4o</span>
                </div>
                <div className={styles.loadingSkeleton}>
                  <span />
                  <span />
                  <span />
                </div>
                {log.summaryStatus === "FAILED" && (
                  <div className={styles.loadingError}>失敗: {log.summaryError || "不明なエラー"}</div>
                )}
              </div>
            ) : editing ? (
              <textarea
                value={editedSummary}
                onChange={(e) => setEditedSummary(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: "300px",
                  padding: "12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontFamily: "inherit",
                  fontSize: "14px",
                  lineHeight: "1.6",
                }}
              />
            ) : (
              <div 
                className={styles.summaryContent}
                dangerouslySetInnerHTML={{ 
                  __html: (() => {
                    // MarkdownをHTMLに変換する関数
                    const renderMarkdown = (text: string): string => {
                      // HTMLエスケープ（基本的なXSS対策）
                      const escapeHtml = (str: string) => {
                        const map: Record<string, string> = {
                          '&': '&amp;',
                          '<': '&lt;',
                          '>': '&gt;',
                          '"': '&quot;',
                          "'": '&#039;',
                        };
                        return str.replace(/[&<>"']/g, (m) => map[m]);
                      };
                      
                      // 段落に分割（空行2つ以上で分割）
                      const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
                      
                      return paragraphs.map(para => {
                        let processed = para.trim();
                        
                        // HTMLエスケープ（ただし、Markdown構文は保護）
                        // まず、太字マーカーを一時的に置換
                        processed = processed.replace(/\*\*(.*?)\*\*/g, (match, content) => {
                          return `__BOLD_START__${escapeHtml(content)}__BOLD_END__`;
                        });
                        
                        // 残りのテキストをエスケープ
                        processed = escapeHtml(processed);
                        
                        // 太字マーカーを<strong>タグに戻す
                        processed = processed.replace(/__BOLD_START__(.*?)__BOLD_END__/g, '<strong>$1</strong>');
                        
                        // 段落内の改行を<br>に変換
                        processed = processed.replace(/\n/g, '<br>');
                        
                        return `<p>${processed}</p>`;
                      }).join('');
                    };
                    
                    return renderMarkdown(log.summary);
                  })()
                }}
              />
            )}
            </div>

          {/* ② タイムライン */}
          {log.extractStatus && log.extractStatus !== "SUCCESS" ? (
            <div className={styles.block}>
              <h3 className={styles.heading}>抽出（タイムライン/ToDo/カルテ更新）</h3>
              <div className={styles.loadingCard}>
                <div className={styles.loadingHeader}>
                  <span className={styles.spinner} aria-hidden />
                  <div>
                    <div className={styles.loadingTitle}>抽出を再生成中</div>
                    <div className={styles.loadingHint}>
                      タイムライン・ToDo・カルテ更新の更新を進めています。
                    </div>
                  </div>
                  <span className={styles.loadingTag}>Job B / GPT-4o mini</span>
                </div>
                <div className={styles.loadingSkeleton}>
                  <span />
                  <span />
                </div>
                {log.extractStatus === "FAILED" && (
                  <div className={styles.loadingError}>失敗: {log.extractError || "不明なエラー"}</div>
                )}
              </div>
            </div>
          ) : (
            <>
              <TimelineList items={log.timeline ?? []} />

              {/* ③ ToDo（次アクション） */}
              <ActionList items={log.nextActions ?? []} />

              {/* ④ カルテ更新事項 */}
              <PersonalDeltaList delta={log.structuredDelta ?? {}} logId={log.id} />
            </>
          )}
        </div>
        )}
          </Card>
        </div>
  );
}

function TimelineList({ items }: { items: TimelineItem[] }) {
  if (!items || items.length === 0) return null;
  
  return (
    <div className={styles.timelineBlock}>
      <div className={styles.timelineHeader}>
        <h3 className={styles.timelineTitle}>タイムライン</h3>
        <span className={styles.timelineSubtitle}>話題単位で会話の流れを把握</span>
            </div>
      <div className={styles.timelineList}>
        {items.map((item, idx) => (
          <div key={idx} className={styles.timelineItem}>
            <div className={styles.timelineTopic}>{item.topic}</div>
            <div className={styles.timelineSummary}>{item.summary}</div>
          </div>
        ))}
                      </div>
                    </div>
  );
}

function ActionList({ items }: { items: string[] }) {
  if (!items || items.length === 0) return null;
  
  return (
    <div className={styles.actionBlock}>
      <div className={styles.actionHeader}>
        <h3 className={styles.actionTitle}>ToDo（結論・次アクション）</h3>
        <span className={styles.actionSubtitle}>実行可能な具体的な行動</span>
                  </div>
      <div className={styles.actionList}>
        {items.map((item, idx) => (
          <div key={idx} className={styles.actionItem}>
            <span className={styles.actionNumber}>{idx + 1}</span>
            <span className={styles.actionText}>{item}</span>
                </div>
              ))}
            </div>
          </div>
  );
}

function PersonalDeltaList({ delta, logId }: { delta: any; logId: string }) {
  const EMOTION_KEYWORDS = ["感情", "気分", "情緒", "ストレス", "不安", "焦り", "安心", "緊張", "落ち込み", "やる気", "モチベ"];
  const INTEREST_KEYWORDS = ["興味", "趣味", "関心", "アニメ", "ゲーム", "恋愛", "音楽", "スポーツ", "推し", "ドラマ", "部活"];
  const includesKeyword = (text: string, keywords: string[]) =>
    keywords.some((k) => text.toLowerCase().includes(k.toLowerCase()));

  const personal = Object.entries(delta?.personal ?? {});

  const buckets: Record<
    string,
    { label: string; items: Array<{ title: string; detail?: string; confidence: number }> }
  > = {};

  personal.forEach(([key, value]: any) => {
    const val = typeof value?.value === "string" ? value.value.trim() : "";
    if (!val) return;
    const categoryRaw = String(value?.category ?? "");
    const text = `${key} ${val}`;
    const isEmotion =
      includesKeyword(categoryRaw, EMOTION_KEYWORDS) ||
      includesKeyword(text, EMOTION_KEYWORDS);
    const isInterest =
      includesKeyword(categoryRaw, INTEREST_KEYWORDS) ||
      includesKeyword(text, INTEREST_KEYWORDS);

    let bucketKey = "";
    let label = "";
    if (isEmotion && !isInterest) {
      bucketKey = "感情";
      label = "今の感情";
    } else if (isInterest) {
      bucketKey = "興味関心";
      label = "興味関心";
    } else {
      return;
    }

    if (!buckets[bucketKey]) {
      buckets[bucketKey] = { label, items: [] };
    }
    const conf = typeof value?.confidence === "number" ? value.confidence : 0.6;
    buckets[bucketKey].items.push({
      title: val,
      detail: typeof value?.detail === "string" ? value.detail.trim() : undefined,
      confidence: conf,
    });
  });

  const grouped = Object.entries(buckets);
  
  return (
    <div className={styles.personalDeltaBlock}>
      <div className={styles.personalDeltaHeader}>
        <h3 className={styles.personalDeltaTitle}>カルテ更新事項</h3>
        <span className={styles.personalDeltaSubtitle}>この会話で更新された今の感情 / 興味関心</span>
      </div>
      
      {grouped.length === 0 ? (
        <div className={styles.personalDeltaEmpty}>
          <span className={styles.emptyIcon}>
            <Icon name="list" />
          </span>
          <span>今回はパーソナル情報の更新はありません</span>
        </div>
      ) : (
        <div className={styles.personalDeltaList}>
          {grouped.map(([category, data]) => (
            <div key={category} className={styles.personalDeltaCategory}>
              <div className={styles.personalDeltaCategoryTitle}>{category}</div>
              {(() => {
                const top = data.items
                  .slice()
                  .sort((a, b) => b.confidence - a.confidence)[0];
                if (!top?.title || !top?.detail) return null;
                const confidenceLabel = top.confidence >= 0.8 ? "高" : top.confidence >= 0.6 ? "中" : "低";

                return (
                  <div key={data.label} className={styles.personalDeltaItem}>
                    <div className={styles.personalDeltaItemHeader}>
                      <span className={styles.personalDeltaFieldName}>{data.label}</span>
                      <span
                        className={styles.personalDeltaConfidence}
                        data-level={top.confidence >= 0.8 ? "high" : top.confidence >= 0.6 ? "medium" : "low"}
                      >
                        確実性: {confidenceLabel} ({Math.round(top.confidence * 100)}%)
                      </span>
                    </div>
                    <div className={styles.personalDeltaValue}>{top.title}</div>
                    <div className={styles.personalDeltaDetail}>{top.detail}</div>
                    <div className={styles.personalDeltaSource}>
                      <span className={styles.sourceLabel}>根拠:</span>
                      <Link href={`/app/logs/${logId}`} className={styles.sourceLogId}>
                        この会話ログ（{logId.substring(0, 8)}...）
                      </Link>
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeltaList({ delta }: { delta: any }) {
  const basics = Object.entries(delta?.basics ?? {});
  if (basics.length === 0) return null;
  return (
    <div className={styles.fieldGroup}>
      <div className={styles.fieldLabel}>カルテ更新差分（基本情報）</div>
      <div className={styles.deltaGrid}>
        <div>
          <div className={styles.deltaTitle}>基本情報</div>
          {basics.map(([key, value]: any) => (
            <div key={key} className={styles.deltaItem}>
              <span className={styles.fieldKey}>{key}</span>
              <span>{value?.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
