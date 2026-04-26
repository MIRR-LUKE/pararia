"use client";

import { useMemo, useState } from "react";
import type { AdminOperationsSnapshot } from "@/lib/admin/get-admin-operations-snapshot";
import type { OperationsJobRow } from "@/lib/settings/get-settings-snapshot";
import styles from "../../../admin.module.css";

type Props = {
  organizationId: string;
  initialSnapshot: AdminOperationsSnapshot;
  canExecute: boolean;
};

type ActionState = {
  job: OperationsJobRow;
  action: "retry" | "cancel";
  reason: string;
  confirmJobId: string;
};

function formatDateTime(value: string | null) {
  if (!value) return "未記録";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未記録";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function jobLabel(kind: OperationsJobRow["kind"]) {
  if (kind === "conversation") return "面談ログ生成";
  if (kind === "session_part") return "音声処理";
  return "Teacher App録音";
}

function buildRows(snapshot: AdminOperationsSnapshot) {
  return [
    ...snapshot.operations.teacherRecordingJobRows,
    ...snapshot.operations.sessionPartJobRows,
    ...snapshot.operations.conversationJobRows,
  ].filter((job) => job.status === "ERROR" || job.status === "RUNNING" || job.status === "QUEUED");
}

export default function AdminCampusOperationsClient({ organizationId, initialSnapshot, canExecute }: Props) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rows = useMemo(() => buildRows(snapshot), [snapshot]);

  async function refresh() {
    const response = await fetch(`/api/admin/operations?organizationId=${encodeURIComponent(organizationId)}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error ?? "運用データを更新できませんでした。");
    setSnapshot(body as AdminOperationsSnapshot);
  }

  async function submitAction() {
    if (!actionState || submitting) return;
    const reason = actionState.reason.trim();
    if (!reason) {
      setMessage("操作理由を入力してください。");
      return;
    }
    if (actionState.confirmJobId.trim() !== actionState.job.id) {
      setMessage("確認用のジョブIDが一致しません。");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/operations/jobs/${encodeURIComponent(actionState.job.kind)}/${encodeURIComponent(actionState.job.id)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `${actionState.action}:${actionState.job.id}:${Date.now()}`,
          },
          body: JSON.stringify({
            action: actionState.action,
            organizationId,
            reason,
            confirmJobId: actionState.confirmJobId.trim(),
          }),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? "操作に失敗しました。");
      setActionState(null);
      await refresh();
      setMessage(actionState.action === "retry" ? "再実行を受け付けました。" : "キャンセルを記録しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作に失敗しました。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="operations-list-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>復旧操作</p>
          <h2 id="operations-list-title">ジョブ再実行・キャンセル</h2>
        </div>
        <button className={styles.loadMoreButton} type="button" onClick={() => refresh()} disabled={submitting}>
          更新
        </button>
      </div>

      {message ? (
        <div className={styles.emptyState} role="status">
          <strong>{message}</strong>
          <span>必要なら対象ジョブの状態を確認してから、もう一度操作してください。</span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>操作が必要なジョブはありません。</strong>
          <span>失敗、実行中、待ちのジョブだけを表示します。</span>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">種類</th>
                <th scope="col">状態</th>
                <th scope="col">対象</th>
                <th scope="col">更新</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((job) => (
                <tr key={`${job.kind}:${job.id}`}>
                  <td>
                    <strong className={styles.tableTitle}>{jobLabel(job.kind)}</strong>
                    <span className={styles.tableHint}>{job.jobType}</span>
                  </td>
                  <td>{job.statusLabel}</td>
                  <td>
                    <strong className={styles.tableTitle}>{job.studentName ?? "生徒未確定"}</strong>
                    <span className={styles.tableHint}>{job.fileName ?? job.targetId}</span>
                  </td>
                  <td>{formatDateTime(job.updatedAt)}</td>
                  <td>
                    <div className={styles.actionButtonRow}>
                      <button
                        className={styles.detailLink}
                        type="button"
                        disabled={!canExecute || submitting}
                        onClick={() => setActionState({ job, action: "retry", reason: "", confirmJobId: "" })}
                      >
                        再実行
                      </button>
                      <button
                        className={styles.secondaryDangerButton}
                        type="button"
                        disabled={!canExecute || submitting}
                        onClick={() => setActionState({ job, action: "cancel", reason: "", confirmJobId: "" })}
                      >
                        キャンセル
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!canExecute ? (
        <div className={styles.emptyState}>
          <strong>このアカウントでは復旧操作を実行できません。</strong>
          <span>閲覧はできます。操作が必要な場合は OPS_ADMIN 以上の運営担当に依頼してください。</span>
        </div>
      ) : null}

      {actionState ? (
        <section className={styles.confirmPanel} aria-labelledby="confirm-title">
          <div>
            <p className={styles.eyebrow}>実行前確認</p>
            <h3 id="confirm-title">{actionState.action === "retry" ? "再実行する" : "キャンセルする"}</h3>
          </div>
          <div className={styles.keyValueGrid}>
            <div className={styles.keyValueRow}>
              <span>対象校舎</span>
              <strong>{snapshot.organization.name}</strong>
            </div>
            <div className={styles.keyValueRow}>
              <span>対象ジョブ</span>
              <strong>{actionState.job.id}</strong>
            </div>
            <div className={styles.keyValueRow}>
              <span>現在の状態</span>
              <strong>{actionState.job.statusLabel}</strong>
            </div>
          </div>
          <label className={styles.searchField}>
            <span>操作理由</span>
            <textarea
              className={styles.textArea}
              value={actionState.reason}
              onChange={(event) => setActionState({ ...actionState, reason: event.target.value })}
              placeholder="例: 保護者報告作成が止まっているため、音声処理の完了後に再実行する"
            />
          </label>
          <label className={styles.searchField}>
            <span>確認のためジョブIDを入力</span>
            <input
              value={actionState.confirmJobId}
              onChange={(event) => setActionState({ ...actionState, confirmJobId: event.target.value })}
              placeholder={actionState.job.id}
            />
          </label>
          <div className={styles.actionButtonRow}>
            <button className={styles.loadMoreButton} type="button" onClick={submitAction} disabled={submitting}>
              {submitting ? "実行中" : "理由を記録して実行"}
            </button>
            <button className={styles.detailLink} type="button" onClick={() => setActionState(null)} disabled={submitting}>
              やめる
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
