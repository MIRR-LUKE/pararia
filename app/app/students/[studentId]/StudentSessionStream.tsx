"use client";

import styles from "./studentStream.module.css";
import type { SessionItem } from "./roomTypes";

type Props = {
  sessions: SessionItem[];
  assigneeName?: string;
  onOpenLog: (logId: string) => void;
};

function buildSessionLabel(session: SessionItem) {
  const date = new Date(session.sessionDate);
  const base = `${date.getMonth() + 1}月${date.getDate()}日`;
  if (session.type === "INTERVIEW") return `${base}の面談`;
  return `${base}の指導報告`;
}

function assigneeText(name?: string) {
  if (!name) return "担当";
  const compact = name.replace(/\s+/g, "");
  return compact.length > 4 ? compact.slice(0, 2) : compact;
}

export function StudentSessionStream({ sessions, assigneeName, onOpenLog }: Props) {
  const items = sessions.filter(
    (session) =>
      session.type === "INTERVIEW" &&
      (session.conversation?.id || ["TRANSCRIBING", "GENERATING"].includes(session.pipeline?.stage ?? ""))
  );

  if (items.length === 0) {
    return <div className={styles.emptyState}>まだ面談ログはありません。録音が終わるとここに並びます。</div>;
  }

  return (
    <div className={styles.stream}>
      {items.map((session) => (
        <button
          key={session.id}
          type="button"
          className={styles.row}
          onClick={() => {
            const logId = session.pipeline?.openLogId ?? session.conversation?.id;
            if (logId) onOpenLog(logId);
          }}
          disabled={!session.pipeline?.openLogId && !session.conversation?.id}
        >
          <div className={styles.rowLeft}>
            <div className={styles.iconBubble} aria-hidden>
              <span className={styles.iconLine} />
              <span className={styles.iconLineSmall} />
            </div>
            <div className={styles.rowBody}>
              <div className={styles.rowText}>{buildSessionLabel(session)}</div>
              <div className={styles.rowMeta}>
                {session.pipeline?.progress.title ?? "面談ログ"}
              </div>
            </div>
          </div>
          <div className={styles.assigneePill}>{assigneeText(assigneeName)}</div>
        </button>
      ))}
    </div>
  );
}