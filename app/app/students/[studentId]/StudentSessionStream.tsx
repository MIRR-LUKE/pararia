"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { SessionItem } from "./roomTypes";
import styles from "./studentStream.module.css";

type Props = {
  sessions: SessionItem[];
  selectedSessionIds: string[];
  onSelectedSessionIdsChange: (ids: string[]) => void;
  onOpenProof: (logId: string) => void;
  onOpenReportBuilder: () => void;
};

type FilterKey = "all" | "interview" | "lesson" | "pending";

function modeLabel(session: SessionItem) {
  return session.type === "LESSON_REPORT" ? "指導報告" : "面談";
}

function partLabel(session: SessionItem) {
  if (session.type !== "LESSON_REPORT") return "通し録音";
  const partTypes = session.parts.map((part) => part.partType);
  if (partTypes.includes("CHECK_IN") && partTypes.includes("CHECK_OUT")) return "チェックイン + チェックアウト";
  if (partTypes.includes("CHECK_OUT")) return "チェックアウト";
  if (partTypes.includes("CHECK_IN")) return "チェックイン";
  return "指導報告";
}

function statusTone(session: SessionItem): "neutral" | "low" | "medium" | "high" {
  if (session.pendingEntityCount > 0) return "high";
  if (session.status === "PROCESSING" || session.status === "COLLECTING") return "medium";
  if (session.status === "DONE" || session.status === "READY") return "low";
  return "neutral";
}

function statusLabel(session: SessionItem) {
  if (session.pendingEntityCount > 0) return `未確認 ${session.pendingEntityCount} 件`;
  if (session.status === "COLLECTING") return "記録途中";
  if (session.status === "PROCESSING") return "生成中";
  if (session.status === "READY" || session.status === "DONE") return "確認可能";
  return session.status;
}

function formatDateLabel(date: string) {
  return new Date(date).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sliceOrFallback(items: string[] | undefined, fallback: string) {
  if (!items || items.length === 0) return [fallback];
  return items.slice(0, 2);
}

export function StudentSessionStream({
  sessions,
  selectedSessionIds,
  onSelectedSessionIdsChange,
  onOpenProof,
  onOpenReportBuilder,
}: Props) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const visibleSessions = useMemo(() => {
    return sessions.filter((session) => {
      if (filter === "all") return true;
      if (filter === "interview") return session.type === "INTERVIEW";
      if (filter === "lesson") return session.type === "LESSON_REPORT";
      return session.pendingEntityCount > 0;
    });
  }, [filter, sessions]);

  const selectedCount = selectedSessionIds.length;

  const toggleSelection = (sessionId: string) => {
    onSelectedSessionIdsChange(
      selectedSessionIds.includes(sessionId)
        ? selectedSessionIds.filter((id) => id !== sessionId)
        : [...selectedSessionIds, sessionId]
    );
  };

  return (
    <section className={styles.stream} aria-label="コミュニケーション履歴">
      <div className={styles.streamHeader}>
        <div>
          <div className={styles.eyebrow}>コミュニケーション履歴</div>
          <h3 className={styles.title}>会話ログを読みながら、親レポ用の素材を選ぶ</h3>
          <p className={styles.subtitle}>
            チェックしただけでは何も始まりません。必要なログを選んだあとで、明示的に保護者レポートを生成します。
          </p>
        </div>

        <div className={styles.actions}>
          <div className={styles.selectionSummary}>選択中 {selectedCount} 件</div>
          <Button onClick={onOpenReportBuilder} disabled={selectedCount === 0}>
            保護者レポートを生成
          </Button>
        </div>
      </div>

      <div className={styles.filterRow}>
        {[
          { key: "all", label: "すべて" },
          { key: "interview", label: "面談のみ" },
          { key: "lesson", label: "指導報告のみ" },
          { key: "pending", label: "要確認あり" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.filterChip} ${filter === item.key ? styles.filterChipActive : ""}`}
            onClick={() => setFilter(item.key as FilterKey)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        {visibleSessions.length === 0 ? (
          <div className={styles.emptyState}>条件に合う会話ログがありません。</div>
        ) : (
          visibleSessions.map((session) => {
            const operationalLog = session.conversation?.operationalLog;
            const isSelected = selectedSessionIds.includes(session.id);
            const isSelectable = Boolean(operationalLog);
            const theme = operationalLog?.theme ?? session.heroOneLiner ?? session.latestSummary ?? "生成中のため、要点はまだ準備中です。";

            return (
              <article key={session.id} className={`${styles.card} ${isSelected ? styles.cardSelected : ""}`}>
                <div className={styles.cardTop}>
                  <div>
                    <div className={styles.metaRow}>
                      <span>{formatDateLabel(session.sessionDate)}</span>
                      <span>{modeLabel(session)}</span>
                      <span>{partLabel(session)}</span>
                    </div>
                    <h4 className={styles.cardTitle}>{theme}</h4>
                  </div>
                  <div className={styles.badgeRow}>
                    <Badge label={statusLabel(session)} tone={statusTone(session)} />
                    <Badge label={`${session.pendingEntityCount} 件`} tone={session.pendingEntityCount > 0 ? "high" : "neutral"} />
                  </div>
                </div>

                <div className={styles.summaryGrid}>
                  <div className={styles.infoCard}>
                    <div className={styles.sectionLabel}>事実</div>
                    {sliceOrFallback(operationalLog?.facts, "まだ要点化されていません。").map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                  <div className={styles.infoCard}>
                    <div className={styles.sectionLabel}>変化</div>
                    {sliceOrFallback(operationalLog?.changes, "前回との差分は次の生成で補います。").map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                  <div className={styles.infoCard}>
                    <div className={styles.sectionLabel}>見立て</div>
                    {sliceOrFallback(operationalLog?.assessment, "講師の見立てはまだ整っていません。").map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                  <div className={styles.infoCard}>
                    <div className={styles.sectionLabel}>次に確認すること</div>
                    {sliceOrFallback(operationalLog?.nextChecks, "次の確認事項はこれから整います。").map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                </div>

                <div className={styles.parentShareCard}>
                  <div className={styles.sectionLabel}>親共有に向く要素</div>
                  {sliceOrFallback(operationalLog?.parentShare, "このログ単体では親共有向けの素材はまだ薄めです。").map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>

                <div className={styles.cardActions}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!isSelectable}
                      onChange={() => toggleSelection(session.id)}
                    />
                    <span>{isSelected ? "選択中" : "レポ素材に追加"}</span>
                  </label>

                  <div className={styles.actionButtons}>
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={!session.conversation?.id}
                      onClick={() => session.conversation?.id && onOpenProof(session.conversation.id)}
                    >
                      詳細を見る
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={!session.conversation?.id}
                      onClick={() => session.conversation?.id && onOpenProof(session.conversation.id)}
                    >
                      根拠に固定
                    </Button>
                    {isSelected ? (
                      <Button size="small" variant="ghost" onClick={() => toggleSelection(session.id)}>
                        除外
                      </Button>
                    ) : null}
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
