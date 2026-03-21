"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import styles from "./[logId]/logDetail.module.css";

type ConversationStatus = "PROCESSING" | "PARTIAL" | "DONE" | "ERROR";
type TabKey = "summary" | "evidence" | "transcript";

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

type LessonReportArtifact = {
  goal?: string;
  did?: string[];
  blocked?: string[];
  homework?: string[];
  nextLessonFocus?: string[];
  coachMemo?: string;
};

type OperationalLog = {
  theme: string;
  facts: string[];
  changes: string[];
  assessment: string[];
  nextChecks: string[];
  parentShare: string[];
};

type ReuseBlock = {
  type: "fact" | "change" | "assessment" | "next" | "parent";
  text: string;
};

type ConversationLog = {
  id: string;
  status: ConversationStatus;
  operationalSummaryMarkdown?: string | null;
  operationalLog?: OperationalLog | null;
  reuseBlocks?: ReuseBlock[] | null;
  timelineJson?: TimelineItem[] | null;
  nextActionsJson?: NextAction[] | null;
  studentStateJson?: StudentState | null;
  lessonReportJson?: LessonReportArtifact | null;
  formattedTranscript?: string | null;
  rawTextOriginal?: string | null;
  rawTextCleaned?: string | null;
  student?: { name: string; grade?: string | null } | null;
  session?: { type: string; status: string } | null;
};

type Props = {
  logId: string;
  showHeader?: boolean;
  onBack?: () => void;
};

const TAB_LABELS: Array<{ key: TabKey; label: string }> = [
  { key: "summary", label: "要点" },
  { key: "evidence", label: "根拠" },
  { key: "transcript", label: "文字起こし" },
];

const STATUS_LABEL: Record<ConversationStatus, string> = {
  PROCESSING: "生成中",
  PARTIAL: "一部完了",
  DONE: "確認可能",
  ERROR: "エラー",
};

const OWNER_LABELS: Record<string, string> = {
  COACH: "講師",
  STUDENT: "生徒",
  PARENT: "保護者",
};

const REUSE_BLOCK_LABELS: Record<string, string> = {
  fact: "事実",
  change: "変化",
  assessment: "見立て",
  next: "次に確認すること",
  parent: "親共有に向く要素",
};

function splitLines(markdown?: string | null) {
  if (!markdown) return [];
  return markdown
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function toneFromStatus(status: ConversationStatus): "neutral" | "low" | "medium" | "high" {
  if (status === "DONE") return "low";
  if (status === "ERROR") return "high";
  if (status === "PROCESSING") return "medium";
  return "neutral";
}

export function LogDetailView({ logId, showHeader = true, onBack }: Props) {
  const [log, setLog] = useState<ConversationLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("summary");

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${logId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "会話ログの取得に失敗しました。");
      setLog(body?.conversation as ConversationLog);
    } catch (nextError: any) {
      setError(nextError?.message ?? "会話ログの取得に失敗しました。");
      setLog(null);
    } finally {
      setLoading(false);
    }
  }, [logId]);

  useEffect(() => {
    void fetchLog();
  }, [fetchLog]);

  const summaryLines = useMemo(() => splitLines(log?.operationalSummaryMarkdown), [log?.operationalSummaryMarkdown]);
  const transcriptText = log?.formattedTranscript || log?.rawTextCleaned || log?.rawTextOriginal || "";

  if (loading) {
    return <div className={styles.progressBanner}>会話ログを読み込んでいます...</div>;
  }

  if (error || !log) {
    return (
      <div className={styles.inlineError}>
        <p>{error ?? "会話ログを読み込めませんでした。"}</p>
        <div className={styles.inlineActions}>
          <Button variant="secondary" onClick={() => void fetchLog()}>
            もう一度読む
          </Button>
          {onBack ? <Button onClick={onBack}>閉じる</Button> : null}
        </div>
      </div>
    );
  }

  return (
    <section className={styles.page}>
      {showHeader ? (
        <div className={styles.headerRow}>
          <div className={styles.headerMain}>
            <div className={styles.eyebrow}>会話ログ詳細</div>
            <h2 className={styles.title}>{log.student?.name ?? "生徒"}</h2>
            <p className={styles.subtitle}>要点、根拠、文字起こしの順に確認できます。</p>
          </div>
          <div className={styles.headerActions}>
            <Badge label={STATUS_LABEL[log.status]} tone={toneFromStatus(log.status)} />
            {onBack ? <Button variant="secondary" onClick={onBack}>閉じる</Button> : null}
          </div>
        </div>
      ) : null}

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
          {log.studentStateJson ? (
            <div className={styles.stateCard}>
              <div className={styles.stateTop}>
                <div>
                  <div className={styles.eyebrow}>今回の変化</div>
                  <p className={styles.stateOneLiner}>{log.studentStateJson.oneLiner}</p>
                </div>
                <Badge label={log.studentStateJson.label} tone="medium" />
              </div>
              {log.studentStateJson.rationale?.length ? (
                <div className={styles.noteList}>
                  {log.studentStateJson.rationale.map((item) => (
                    <div key={item} className={styles.noteItem}>{item}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={styles.markdownBody}>
            {summaryLines.length > 0 ? summaryLines.map((line) => <p key={line}>{line}</p>) : <p>まだ要点は生成されていません。</p>}
          </div>
        </div>
      ) : null}

      {tab === "evidence" ? (
        <div className={styles.stack}>
          <div className={styles.twoCol}>
            <div className={styles.listItem}>
              <div className={styles.fieldLabel}>事実</div>
              {(log.operationalLog?.facts?.length ? log.operationalLog.facts : ["まだ整理されていません。"]).map((item) => <p key={item}>{item}</p>)}
            </div>
            <div className={styles.listItem}>
              <div className={styles.fieldLabel}>変化</div>
              {(log.operationalLog?.changes?.length ? log.operationalLog.changes : ["まだ整理されていません。"]).map((item) => <p key={item}>{item}</p>)}
            </div>
          </div>

          <div className={styles.twoCol}>
            <div className={styles.listItem}>
              <div className={styles.fieldLabel}>見立て</div>
              {(log.operationalLog?.assessment?.length ? log.operationalLog.assessment : ["まだ整理されていません。"]).map((item) => <p key={item}>{item}</p>)}
            </div>
            <div className={styles.listItem}>
              <div className={styles.fieldLabel}>次に確認すること</div>
              {(log.operationalLog?.nextChecks?.length ? log.operationalLog.nextChecks : ["まだ整理されていません。"]).map((item) => <p key={item}>{item}</p>)}
            </div>
          </div>

          {log.nextActionsJson?.length ? (
            <div className={styles.listItem}>
              <div className={styles.fieldLabel}>次回までの行動</div>
              {log.nextActionsJson.map((item) => (
                <div key={`${item.owner}-${item.action}`} className={styles.noteItem}>
                  <strong>{OWNER_LABELS[item.owner] ?? item.owner}</strong>
                  <p>{item.action}</p>
                  {item.metric ? <p className={styles.reason}>指標: {item.metric}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {log.lessonReportJson ? (
            <div className={styles.listItem}>
              <div className={styles.fieldLabel}>指導報告書ドラフト</div>
              <p>{log.lessonReportJson.goal ?? "目標はまだ整理されていません。"}</p>
              {(log.lessonReportJson.did ?? []).map((item) => <p key={item}>{item}</p>)}
              {(log.lessonReportJson.blocked ?? []).map((item) => <p key={item}>{item}</p>)}
              {(log.lessonReportJson.nextLessonFocus ?? []).map((item) => <p key={item}>{item}</p>)}
            </div>
          ) : null}

          {log.timelineJson?.length ? (
            <div className={styles.timelineList}>
              {log.timelineJson.map((item, index) => (
                <div key={`${item.title}-${index}`} className={styles.timelineItem}>
                  <div className={styles.timelineHead}>
                    <strong>{item.title}</strong>
                    <span className={styles.metaLine}>{index + 1} 件目</span>
                  </div>
                  <p>{item.what_happened}</p>
                  <p>{item.coach_point}</p>
                  {item.student_state ? <p>{item.student_state}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {log.reuseBlocks?.length ? (
            <div className={styles.list}>
              {log.reuseBlocks.map((block, index) => (
                <div key={`${block.type}-${index}`} className={styles.listItem}>
                  <div className={styles.fieldLabel}>{REUSE_BLOCK_LABELS[block.type] ?? block.type}</div>
                  <p>{block.text}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "transcript" ? (
        <div className={styles.stack}>
          <div className={styles.transcriptBox}>{transcriptText || "まだ文字起こしはありません。"}</div>
        </div>
      ) : null}
    </section>
  );
}
