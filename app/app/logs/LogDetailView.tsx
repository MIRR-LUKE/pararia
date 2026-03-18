"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import styles from "./[logId]/logDetail.module.css";

type ConversationStatus = "PROCESSING" | "PARTIAL" | "DONE" | "ERROR";
type TabKey = "summary" | "evidence" | "entities" | "transcript";

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

type StudentState = {
  label: string;
  oneLiner: string;
  rationale: string[];
  confidence: number;
};

type ProfileSection = {
  category: string;
  status: string;
  highlights: Array<{ label: string; value: string; isNew?: boolean; isUpdated?: boolean }>;
  nextQuestion: string;
};

type LessonReportArtifact = {
  todayGoal?: string;
  covered?: string[];
  blockers?: string[];
  homework?: string[];
  nextLessonFocus?: string[];
};

type EntityCandidate = {
  id: string;
  kind: string;
  rawValue: string;
  canonicalValue?: string | null;
  confidence: number;
  status: string;
};

type OperationalLog = {
  theme: string;
  facts: string[];
  changes: string[];
  assessment: string[];
  nextChecks: string[];
  parentShare: string[];
  entities: EntityCandidate[];
};

type ReuseBlock = {
  type: "fact" | "change" | "assessment" | "next" | "parent";
  text: string;
};

type ConversationJob = {
  id: string;
  type: string;
  status: string;
  lastError?: string | null;
};

type ConversationLog = {
  id: string;
  studentId: string;
  status: ConversationStatus;
  summaryMarkdown?: string | null;
  operationalSummaryMarkdown?: string | null;
  operationalLog?: OperationalLog | null;
  reuseBlocks?: ReuseBlock[] | null;
  timelineJson?: TimelineItem[] | null;
  nextActionsJson?: NextAction[] | null;
  studentStateJson?: StudentState | null;
  profileSectionsJson?: ProfileSection[] | null;
  lessonReportJson?: LessonReportArtifact | null;
  formattedTranscript?: string | null;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  rawSegments?: Array<{ text?: string }> | null;
  createdAt: string;
  student?: {
    id: string;
    name: string;
    grade?: string | null;
  } | null;
  session?: {
    id: string;
    type: string;
    status: string;
    sessionDate: string;
    pendingEntityCount: number;
  } | null;
  jobs?: ConversationJob[];
  entities?: EntityCandidate[];
};

type Props = {
  logId: string;
  showHeader?: boolean;
  onBack?: () => void;
};

const TAB_LABELS: Array<{ key: TabKey; label: string }> = [
  { key: "summary", label: "要点" },
  { key: "evidence", label: "根拠" },
  { key: "entities", label: "要確認の固有名詞" },
  { key: "transcript", label: "文字起こし" },
];

const STATUS_LABEL: Record<ConversationStatus, string> = {
  PROCESSING: "処理中",
  PARTIAL: "一部完了",
  DONE: "確認可能",
  ERROR: "エラー",
};

const ENTITY_KIND_LABELS: Record<string, string> = {
  SCHOOL: "学校名",
  TARGET_SCHOOL: "志望校",
  MATERIAL: "教材",
  EXAM: "模試・検定",
  CRAM_SCHOOL: "塾名",
  TEACHER: "先生名",
  METRIC: "数値情報",
  OTHER: "その他",
};

const ENTITY_STATUS_LABELS: Record<string, string> = {
  PENDING: "未確認",
  CONFIRMED: "確認済み",
  IGNORED: "無視",
};

const OWNER_LABELS: Record<string, string> = {
  COACH: "講師",
  STUDENT: "生徒",
  PARENT: "保護者",
};

function toneFromStatus(status: ConversationStatus): "neutral" | "low" | "medium" | "high" {
  if (status === "DONE") return "low";
  if (status === "ERROR") return "high";
  if (status === "PROCESSING") return "medium";
  return "neutral";
}

function entityTone(status?: string | null): "neutral" | "low" | "medium" | "high" {
  if (status === "CONFIRMED") return "low";
  if (status === "PENDING") return "high";
  return "neutral";
}

function labelEntityKind(kind?: string | null) {
  if (!kind) return "未分類";
  return ENTITY_KIND_LABELS[kind] ?? kind;
}

function labelEntityStatus(status?: string | null) {
  if (!status) return "未設定";
  return ENTITY_STATUS_LABELS[status] ?? status;
}

function labelOwner(owner?: string | null) {
  if (!owner) return "担当者";
  return OWNER_LABELS[owner] ?? owner;
}

function sessionTypeLabel(type?: string | null) {
  return type === "LESSON_REPORT" ? "指導報告" : "面談";
}

function plainText(markdown?: string | null) {
  if (!markdown) return "";
  return markdown
    .replace(/\r/g, "")
    .replace(/#+\s*/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .trim();
}

function renderMarkdownBlocks(markdown?: string | null) {
  if (!markdown) return null;

  return markdown
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      if (line.startsWith("## ")) {
        return (
          <h3 key={index} className={styles.markdownHeading}>
            {line.replace("## ", "").trim()}
          </h3>
        );
      }

      if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        return (
          <p key={index} className={styles.markdownListItem}>
            {line.replace(/^[-*]\s+/, "").trim()}
          </p>
        );
      }

      return <p key={index}>{line}</p>;
    });
}

export function LogDetailView({ logId, showHeader = true, onBack }: Props) {
  const router = useRouter();
  const [log, setLog] = useState<ConversationLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("summary");
  const [regenerating, setRegenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedSummary, setEditedSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [entityDrafts, setEntityDrafts] = useState<Record<string, string>>({});
  const [entityBusy, setEntityBusy] = useState(false);
  const [entityError, setEntityError] = useState<string | null>(null);

  const fetchLog = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/conversations/${logId}`);
      if (!res.ok) {
        setError(res.status === 404 ? "会話ログが見つかりません。" : `読み込みに失敗しました (${res.status})`);
        setLog(null);
        return;
      }

      const data = await res.json();
      setLog(data.conversation);
      setEditedSummary(data.conversation.operationalSummaryMarkdown || data.conversation.summaryMarkdown || "");
    } catch (fetchError: any) {
      setError(fetchError?.message ?? "会話ログの取得に失敗しました。");
      setLog(null);
    } finally {
      setLoading(false);
    }
  }, [logId]);

  useEffect(() => {
    void fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    if (!log?.entities?.length) {
      setEntityDrafts({});
      return;
    }

    setEntityDrafts(
      Object.fromEntries(log.entities.map((entity) => [entity.id, entity.canonicalValue ?? entity.rawValue]))
    );
  }, [log?.entities, log?.id]);

  const runJobsUntilDone = useCallback(async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 300000) {
      try {
        await fetch("/api/jobs/run?limit=4&concurrency=2", { method: "POST" });
      } catch {
        // ignore job runner errors here
      }

      await new Promise((resolve) => setTimeout(resolve, 2500));
      const res = await fetch(`/api/conversations/${logId}`);
      if (!res.ok) continue;
      const data = await res.json();
      setLog(data.conversation);
      if (data.conversation.status === "DONE" || data.conversation.status === "ERROR") {
        setEditedSummary(data.conversation.operationalSummaryMarkdown || data.conversation.summaryMarkdown || "");
        break;
      }
    }
  }, [logId]);

  useEffect(() => {
    if (!log) return;
    if (log.status === "PROCESSING" || log.status === "PARTIAL") {
      void runJobsUntilDone();
    }
  }, [log, runJobsUntilDone]);

  const handleRegenerate = async () => {
    if (!log || regenerating) return;
    if (!confirm("このログを再生成します。現在の要約や派生成果物は上書きされます。")) return;

    try {
      setRegenerating(true);
      const res = await fetch(`/api/conversations/${logId}/regenerate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `再生成に失敗しました (${res.status})`);
      await fetchLog();
      await runJobsUntilDone();
    } catch (regenerateError: any) {
      alert(regenerateError?.message ?? "再生成に失敗しました。");
    } finally {
      setRegenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!log) return;
    if (!confirm("この会話ログを削除します。関連ジョブも一緒に削除されます。")) return;

    try {
      const res = await fetch(`/api/conversations/${logId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "削除に失敗しました。");
      if (onBack) onBack();
      else if (body.studentId) router.push(`/app/students/${body.studentId}`);
      else router.push("/app/students");
    } catch (deleteError: any) {
      alert(deleteError?.message ?? "削除に失敗しました。");
    }
  };

  const handleSave = async () => {
    if (!log || saving) return;
    try {
      setSaving(true);
      const res = await fetch(`/api/conversations/${logId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summaryMarkdown: editedSummary }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `保存に失敗しました (${res.status})`);
      setLog(body.conversation);
      setEditing(false);
    } catch (saveError: any) {
      alert(saveError?.message ?? "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  const handleFormat = async () => {
    try {
      const res = await fetch(`/api/conversations/${logId}/format`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "文字起こし整形に失敗しました。");
      await runJobsUntilDone();
    } catch (formatError: any) {
      alert(formatError?.message ?? "文字起こし整形に失敗しました。");
    }
  };

  const handleApplyEntityEdits = async () => {
    if (!log?.session?.id || entityBusy) return;
    const targets = (log.entities ?? []).filter((entity) => {
      const draft = (entityDrafts[entity.id] ?? entity.canonicalValue ?? entity.rawValue).trim();
      return entity.status === "PENDING" || draft !== (entity.canonicalValue ?? entity.rawValue);
    });
    if (targets.length === 0) return;

    try {
      setEntityBusy(true);
      setEntityError(null);
      await Promise.all(
        targets.map(async (entity) => {
          const res = await fetch(`/api/sessions/${log.session?.id}/entities/${entity.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "confirm",
              canonicalValue: (entityDrafts[entity.id] ?? entity.canonicalValue ?? entity.rawValue).trim(),
            }),
          });

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error ?? "固有名詞確認の反映に失敗しました。");
          }
        })
      );
      await fetchLog();
    } catch (applyError: any) {
      setEntityError(applyError?.message ?? "固有名詞確認の反映に失敗しました。");
    } finally {
      setEntityBusy(false);
    }
  };

  const handleIgnoreEntity = async (entityId: string) => {
    if (!log?.session?.id || entityBusy) return;
    try {
      setEntityBusy(true);
      setEntityError(null);
      const res = await fetch(`/api/sessions/${log.session.id}/entities/${entityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ignore" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "固有名詞の除外に失敗しました。");
      await fetchLog();
    } catch (ignoreError: any) {
      setEntityError(ignoreError?.message ?? "固有名詞の除外に失敗しました。");
    } finally {
      setEntityBusy(false);
    }
  };

  const processingSteps = useMemo(() => {
    const jobs = log?.jobs ?? [];
    return jobs.map((job) => {
      const status =
        job.status === "DONE"
          ? "完了"
          : job.status === "ERROR"
            ? "エラー"
            : job.status === "RUNNING"
              ? "進行中"
              : "待機";
      return `${job.type} ${status}`;
    });
  }, [log?.jobs]);

  const transcript = useMemo(() => {
    if (!log) return "";
    if (log.formattedTranscript?.trim()) return log.formattedTranscript;
    if (log.rawTextCleaned?.trim()) return log.rawTextCleaned;
    if (log.rawTextOriginal?.trim()) return log.rawTextOriginal;
    if (log.rawSegments?.length) {
      return log.rawSegments
        .map((segment) => (segment?.text ?? "").trim())
        .filter(Boolean)
        .join("\n");
    }
    return "";
  }, [log]);

  if (loading) return <div className={styles.subtext}>読み込み中です。</div>;
  if (error) return <div className={styles.subtext}>{error}</div>;
  if (!log) return <div className={styles.subtext}>会話ログがありません。</div>;

  return (
    <div className={styles.page}>
      {showHeader ? (
        <Card>
          <div className={styles.headerRow}>
            <div className={styles.headerMain}>
              <div className={styles.eyebrow}>Proof Surface</div>
              <h1 className={styles.title}>会話ログ詳細</h1>
              <p className={styles.subtitle}>
                {log.student?.name ?? "生徒未設定"}
                {log.student?.grade ? ` / ${log.student.grade}` : ""}
                {` / ${new Date(log.createdAt).toLocaleDateString("ja-JP")} / ${sessionTypeLabel(log.session?.type)}`}
              </p>
            </div>

            <div className={styles.headerActions}>
              <Badge label={STATUS_LABEL[log.status]} tone={toneFromStatus(log.status)} />
              <Button size="small" variant="secondary" onClick={handleRegenerate} disabled={regenerating}>
                {regenerating ? "再生成中..." : "再生成"}
              </Button>
              <Button size="small" variant="ghost" onClick={() => router.push(`/app/students/${log.studentId}`)}>
                生徒ルームへ
              </Button>
              <Button size="small" variant="ghost" onClick={handleDelete}>
                削除
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {(log.status === "PROCESSING" || log.status === "PARTIAL") && (
        <div className={styles.progressBanner} aria-live="polite">
          <div>
            <strong>生成中です。成果物は順に埋まります。</strong>
            <div className={styles.subtext}>必要ならこの画面を開いたまま待てます。</div>
          </div>
          {processingSteps.length > 0 ? (
            <div className={styles.stepList}>
              {processingSteps.map((step) => (
                <span key={step} className={styles.stepPill}>
                  {step}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <div className={styles.tabBar}>
        {TAB_LABELS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.tabButton} ${tab === item.key ? styles.tabActive : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "summary" ? (
        <div className={styles.stack}>
          <Card
            title="会話ログ要約"
            subtitle="今回の会話テーマ / 事実 / 変化 / 見立て / 次確認 / 親共有 をこの順で固定します。"
            action={
              editing ? (
                <div className={styles.inlineActions}>
                  <Button size="small" onClick={handleSave} disabled={saving}>
                    {saving ? "保存中..." : "保存"}
                  </Button>
                  <Button size="small" variant="ghost" onClick={() => setEditing(false)}>
                    キャンセル
                  </Button>
                </div>
              ) : (
                <Button size="small" variant="secondary" onClick={() => setEditing(true)}>
                  編集
                </Button>
              )
            }
          >
            {editing ? (
              <textarea
                className={styles.summaryEditor}
                value={editedSummary}
                onChange={(event) => setEditedSummary(event.target.value)}
              />
            ) : (
              <div className={styles.markdownBody}>
                {renderMarkdownBlocks(log.operationalSummaryMarkdown ?? log.summaryMarkdown) ?? (
                  <div className={styles.subtext}>要約はまだありません。</div>
                )}
              </div>
            )}
          </Card>

          <div className={styles.twoCol}>
            <Card title="今回の変化" subtitle="生徒ルームに出す状態ラベルと一言です。">
              {log.studentStateJson ? (
                <div className={styles.stateCard}>
                  <div className={styles.stateTop}>
                    <strong>{log.studentStateJson.label}</strong>
                    <span className={styles.confidence}>確からしさ {log.studentStateJson.confidence}%</span>
                  </div>
                  <p className={styles.stateOneLiner}>{log.studentStateJson.oneLiner}</p>
                  <div className={styles.noteList}>
                    {(log.studentStateJson.rationale ?? []).map((item) => (
                      <div key={item} className={styles.noteItem}>
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={styles.subtext}>状態ラベルはまだありません。</div>
              )}
            </Card>

            <Card title="次に確認すること" subtitle="次回の会話や授業で、そのまま確認に使える粒度に絞ります。">
              {log.operationalLog?.nextChecks?.length ? (
                <div className={styles.list}>
                  {log.operationalLog.nextChecks.map((item, index) => (
                    <div key={`${index}-${item}`} className={styles.listItem}>
                      <strong>{item}</strong>
                    </div>
                  ))}
                </div>
              ) : log.nextActionsJson?.length ? (
                <div className={styles.list}>
                  {log.nextActionsJson.map((action, index) => (
                    <div key={`${action.action}-${index}`} className={styles.listItem}>
                      <div className={styles.listHead}>
                        <strong>{action.action}</strong>
                        <Badge label={labelOwner(action.owner)} tone="neutral" />
                      </div>
                      <div className={styles.metaLine}>期限: {action.due ?? "次回まで"}</div>
                      <div className={styles.metaLine}>指標: {action.metric || "未設定"}</div>
                      <p className={styles.reason}>{action.why}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.subtext}>次回までの確認事項はまだありません。</div>
              )}
            </Card>
          </div>

          <Card title="プロフィール差分" subtitle="学習 / 学校 / 生活 / 進路の更新案です。">
            {log.profileSectionsJson?.length ? (
              <div className={styles.profileGrid}>
                {log.profileSectionsJson.map((section) => (
                  <div key={section.category} className={styles.profileCard}>
                    <div className={styles.listHead}>
                      <strong>{section.category}</strong>
                      <Badge label={section.status} tone="neutral" />
                    </div>
                    <div className={styles.profilePoints}>
                      {(section.highlights ?? []).map((item) => (
                        <div key={`${item.label}-${item.value}`} className={styles.profilePoint}>
                          <div className={styles.profilePointHeader}>
                            <span>{item.label}</span>
                            {item.isNew ? <span className={styles.profileTag}>NEW</span> : null}
                            {item.isUpdated ? <span className={styles.profileTag}>UPDATE</span> : null}
                          </div>
                          <p>{item.value}</p>
                        </div>
                      ))}
                    </div>
                    <div className={styles.reason}>次に確認すること: {section.nextQuestion}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.subtext}>プロフィール差分はまだありません。</div>
            )}
          </Card>

          {log.lessonReportJson ? (
            <Card title="指導報告書ドラフト" subtitle="授業運用と講師間引き継ぎのための要点です。">
              <div className={styles.list}>
                <div className={styles.listItem}>
                  <strong>今日扱った内容</strong>
                  <p>{(log.lessonReportJson.covered ?? []).join(" / ") || "-"}</p>
                </div>
                <div className={styles.listItem}>
                  <strong>今日見えた理解状態</strong>
                  <p>{log.operationalLog?.changes.join(" ") || "-"}</p>
                </div>
                <div className={styles.listItem}>
                  <strong>詰まった点 / 注意点</strong>
                  <p>{(log.lessonReportJson.blockers ?? []).join(" / ") || "-"}</p>
                </div>
                <div className={styles.listItem}>
                  <strong>次回見るべき点</strong>
                  <p>{(log.lessonReportJson.nextLessonFocus ?? []).join(" / ") || "-"}</p>
                </div>
                <div className={styles.listItem}>
                  <strong>宿題 / 確認事項</strong>
                  <p>{(log.lessonReportJson.homework ?? []).join(" / ") || "-"}</p>
                </div>
              </div>
            </Card>
          ) : null}

          <Card title="再利用ブロック" subtitle="親レポや次回準備に再利用しやすい単位で並べます。">
            {log.reuseBlocks?.length ? (
              <div className={styles.list}>
                {log.reuseBlocks.map((block, index) => (
                  <div key={`${block.type}-${index}`} className={styles.listItem}>
                    <div className={styles.listHead}>
                      <strong>{block.text}</strong>
                      <Badge label={block.type} tone="neutral" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.subtext}>再利用ブロックはまだありません。</div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "evidence" ? (
        <div className={styles.stack}>
          <Card title="根拠ログ" subtitle="事実・変化・見立てをどの根拠で支えているかを確認します。">
            {log.timelineJson?.length ? (
              <div className={styles.timelineList}>
                {log.timelineJson.map((item, index) => (
                  <div key={`${item.title}-${index}`} className={styles.timelineItem}>
                    <div className={styles.timelineHead}>
                      <strong>{item.title}</strong>
                    </div>
                    <p><span className={styles.metaLabel}>事実</span>{item.what_happened}</p>
                    <p><span className={styles.metaLabel}>見立て</span>{item.coach_point}</p>
                    <p><span className={styles.metaLabel}>変化</span>{item.student_state}</p>
                    {(item.evidence_quotes ?? []).length > 0 ? (
                      <div className={styles.quoteRow}>
                        {item.evidence_quotes.map((quote, quoteIndex) => (
                          <span key={`${quoteIndex}-${quote}`} className={styles.quoteChip}>
                            {quote}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.subtext}>根拠として表示できるタイムラインはまだありません。</div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "entities" ? (
        <div className={styles.stack}>
          <Card
            title="要確認の固有名詞"
            subtitle="学校名・教材名・模試名・数値などの確認をここで反映します。"
            action={
              <Button
                size="small"
                onClick={handleApplyEntityEdits}
                disabled={!log.session?.id || entityBusy || !log.entities?.length}
              >
                {entityBusy ? "反映中..." : "この修正を反映"}
              </Button>
            }
          >
            {entityError ? <div className={styles.inlineError}>{entityError}</div> : null}
            {log.entities?.length ? (
              <div className={styles.list}>
                {log.entities.map((entity) => (
                  <div key={entity.id} className={styles.entityCard}>
                    <div className={styles.listHead}>
                      <div>
                        <strong>{entity.rawValue}</strong>
                        <div className={styles.metaLine}>
                          {labelEntityKind(entity.kind)} / 確からしさ {entity.confidence}%
                        </div>
                      </div>
                      <Badge label={labelEntityStatus(entity.status)} tone={entityTone(entity.status)} />
                    </div>

                    <label className={styles.fieldLabel}>確定名</label>
                    <input
                      className={styles.entityInput}
                      value={entityDrafts[entity.id] ?? entity.canonicalValue ?? entity.rawValue}
                      onChange={(event) =>
                        setEntityDrafts((current) => ({ ...current, [entity.id]: event.target.value }))
                      }
                    />

                    <div className={styles.entityFooter}>
                      <span className={styles.metaLine}>現在の確定値: {entity.canonicalValue ?? "未設定"}</span>
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() => handleIgnoreEntity(entity.id)}
                        disabled={!log.session?.id || entityBusy}
                      >
                        この確認を無視
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.subtext}>未確認の固有名詞はありません。</div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "transcript" ? (
        <div className={styles.stack}>
          <Card
            title="文字起こし"
            subtitle="いちばん最後に見るタブです。必要なときだけここで一次情報に戻ります。"
            action={
              <Button size="small" variant="secondary" onClick={handleFormat}>
                体裁を整える
              </Button>
            }
          >
            {transcript ? (
              <pre className={styles.transcriptBox}>{plainText(transcript)}</pre>
            ) : (
              <div className={styles.subtext}>文字起こしデータはまだありません。</div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
