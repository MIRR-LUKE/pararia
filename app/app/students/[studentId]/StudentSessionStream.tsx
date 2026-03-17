"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { SessionItem } from "./roomTypes";
import styles from "./studentStream.module.css";

type FilterType = "ALL" | "INTERVIEW" | "LESSON_REPORT" | "PARENT" | "ENTITY";

type Props = {
  sessions: SessionItem[];
  selectedSessionIds: string[];
  onSelectedSessionIdsChange: (ids: string[]) => void;
  onOpenProof: (logId: string) => void;
  onOpenReport: () => void;
};

const FILTERS: Array<{ key: FilterType; label: string }> = [
  { key: "ALL", label: "すべて" },
  { key: "INTERVIEW", label: "面談" },
  { key: "LESSON_REPORT", label: "指導報告" },
  { key: "PARENT", label: "親共有向き" },
  { key: "ENTITY", label: "要確認あり" },
];

function statusLabel(status?: string | null) {
  if (!status) return "未設定";
  if (status === "READY") return "確認可能";
  if (status === "PROCESSING") return "生成中";
  if (status === "COLLECTING") return "check-out 待ち";
  if (status === "DONE") return "完了";
  if (status === "ERROR") return "エラー";
  return status;
}

function statusTone(status?: string | null): "neutral" | "low" | "medium" | "high" {
  if (status === "DONE" || status === "READY") return "low";
  if (status === "ERROR") return "high";
  if (status === "PROCESSING" || status === "COLLECTING") return "medium";
  return "neutral";
}

export function StudentSessionStream({
  sessions,
  selectedSessionIds,
  onSelectedSessionIdsChange,
  onOpenProof,
  onOpenReport,
}: Props) {
  const [filter, setFilter] = useState<FilterType>("ALL");

  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => {
      if (!session.conversation?.operationalLog) return false;
      if (filter === "ALL") return true;
      if (filter === "INTERVIEW") return session.type === "INTERVIEW";
      if (filter === "LESSON_REPORT") return session.type === "LESSON_REPORT";
      if (filter === "PARENT") return (session.conversation.operationalLog.parentShare.length ?? 0) > 0;
      if (filter === "ENTITY") return session.pendingEntityCount > 0;
      return true;
    });
  }, [filter, sessions]);

  const toggleSession = (sessionId: string) => {
    const next = selectedSessionIds.includes(sessionId)
      ? selectedSessionIds.filter((id) => id !== sessionId)
      : [...selectedSessionIds, sessionId];
    onSelectedSessionIdsChange(next);
    if (next.length > 0) onOpenReport();
  };

  return (
    <section className={styles.stream} aria-label="会話ログ一覧">
      <div className={styles.streamHeader}>
        <div>
          <div className={styles.eyebrow}>Session Stream</div>
          <h3 className={styles.title}>中央の共通素材面</h3>
          <p className={styles.subtitle}>読む、根拠を見る、親レポ素材を選ぶ。この 3 つをここに集約します。</p>
        </div>
        <div className={styles.filterRow}>
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.filterChip} ${filter === item.key ? styles.filterChipActive : ""}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.list}>
        {filteredSessions.length === 0 ? (
          <div className={styles.empty}>この条件に合う会話ログはまだありません。</div>
        ) : (
          filteredSessions.map((session) => {
            const operational = session.conversation?.operationalLog;
            if (!operational) return null;
            const selected = selectedSessionIds.includes(session.id);

            return (
              <article key={session.id} className={`${styles.row} ${selected ? styles.rowSelected : ""}`}>
                <div className={styles.rowTop}>
                  <label className={styles.checkboxWrap}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSession(session.id)}
                    />
                    <div>
                      <div className={styles.nameRow}>
                        <strong>{session.type === "LESSON_REPORT" ? "指導報告" : "面談"}</strong>
                        <Badge label={statusLabel(session.status)} tone={statusTone(session.status)} />
                      </div>
                      <p className={styles.meta}>{new Date(session.sessionDate).toLocaleDateString("ja-JP")}</p>
                    </div>
                  </label>
                  <div className={styles.badgeRow}>
                    {session.pendingEntityCount > 0 ? <Badge label={`要確認 ${session.pendingEntityCount} 件`} tone="high" /> : null}
                    <Badge label={session.type === "LESSON_REPORT" ? "指導報告" : "面談"} tone="neutral" />
                  </div>
                </div>

                <div className={styles.grid}>
                  <div className={styles.block}>
                    <div className={styles.blockLabel}>今回の会話テーマ</div>
                    <p>{operational.theme}</p>
                  </div>
                  <div className={styles.block}>
                    <div className={styles.blockLabel}>事実</div>
                    <p>{operational.facts.join(" ")}</p>
                  </div>
                  <div className={styles.block}>
                    <div className={styles.blockLabel}>変化</div>
                    <p>{operational.changes.join(" ")}</p>
                  </div>
                  <div className={styles.block}>
                    <div className={styles.blockLabel}>見立て</div>
                    <p>{operational.assessment.join(" ")}</p>
                  </div>
                  <div className={styles.block}>
                    <div className={styles.blockLabel}>次に確認すること</div>
                    <p>{operational.nextChecks.join(" / ")}</p>
                  </div>
                  <div className={styles.block}>
                    <div className={styles.blockLabel}>親共有に向く要素</div>
                    <p>{operational.parentShare.join(" / ") || "まだ親共有向けの抜き出しはありません。"}</p>
                  </div>
                </div>

                <div className={styles.rowFooter}>
                  <div className={styles.metaRow}>
                    <span>未確認 entity {session.pendingEntityCount} 件</span>
                    <span>選択中 {selected ? "はい" : "いいえ"}</span>
                  </div>
                  <div className={styles.actions}>
                    {session.conversation?.id ? (
                      <Button size="small" variant="secondary" onClick={() => onOpenProof(session.conversation!.id)}>
                        詳細を見る
                      </Button>
                    ) : null}
                    <Button size="small" onClick={() => toggleSession(session.id)}>
                      {selected ? "レポ素材から外す" : "レポ素材に追加"}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}