"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type {
  DeletedContentRow,
  MissingStudent,
  OperationsJobRow,
  SettingsSnapshot,
} from "@/lib/settings/get-settings-snapshot";
import styles from "./settings.module.css";

type Props = {
  initialSettings: SettingsSnapshot;
  viewerName?: string | null;
  viewerRole?: string | null;
};

type OrganizationDraft = {
  organizationName: string;
  planCode: string;
  studentLimit: string;
  defaultLocale: string;
  defaultTimeZone: string;
  guardianConsentRequired: boolean;
  consentVersion: string;
};

async function fetchSettingsData() {
  const res = await fetch("/api/settings", { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error ?? "設定の読み込みに失敗しました。");
  }
  return body as SettingsSnapshot;
}

function toGuardianDrafts(students: MissingStudent[]) {
  return Object.fromEntries(students.map((student) => [student.id, student.guardianNames ?? ""]));
}

function createOrganizationDraft(settings: SettingsSnapshot): OrganizationDraft {
  return {
    organizationName: settings.organization.name,
    planCode: settings.organization.planCode,
    studentLimit:
      settings.organization.studentLimit === null || settings.organization.studentLimit === undefined
        ? ""
        : String(settings.organization.studentLimit),
    defaultLocale: settings.organization.defaultLocale,
    defaultTimeZone: settings.organization.defaultTimeZone,
    guardianConsentRequired: settings.organization.guardianConsentRequired,
    consentVersion: settings.organization.consentVersion ?? "",
  };
}

function formatDateTime(value: string | null | undefined, timeZone?: string) {
  if (!value) return "未設定";
  const date = new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timeZone || "Asia/Tokyo",
  }).format(date);
}

function buildJobDetail(row: OperationsJobRow, timeZone: string) {
  const lines = [
    `状態: ${row.statusLabel}`,
    row.startedAt ? `開始: ${formatDateTime(row.startedAt, timeZone)}` : null,
    row.nextRetryAt ? `再開予定: ${formatDateTime(row.nextRetryAt, timeZone)}` : null,
    row.leaseExpiresAt ? `実行権の期限: ${formatDateTime(row.leaseExpiresAt, timeZone)}` : null,
    row.fileName ? `ファイル: ${row.fileName}` : null,
    row.lastError ? `直近エラー: ${row.lastError}` : null,
  ];
  return lines.filter(Boolean).join(" / ");
}

function buildDeletedContentDetail(row: DeletedContentRow, timeZone: string) {
  const parts = [
    `削除: ${formatDateTime(row.deletedAt, timeZone)}`,
    row.deletedByLabel ? `担当: ${row.deletedByLabel}` : null,
    row.sessionId ? `セッション: ${row.sessionId}` : null,
    row.note ? `メモ: ${row.note}` : null,
  ];
  return parts.filter(Boolean).join(" / ");
}

export default function SettingsPageClient({
  initialSettings,
  viewerName,
  viewerRole,
}: Props) {
  const [settings, setSettings] = useState<SettingsSnapshot>(initialSettings);
  const [organizationDraft, setOrganizationDraft] = useState<OrganizationDraft>(() =>
    createOrganizationDraft(initialSettings)
  );
  const [savingOrganization, setSavingOrganization] = useState(false);
  const [savingGuardianId, setSavingGuardianId] = useState<string | null>(null);
  const [runningJobs, setRunningJobs] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [runningScopedJobKey, setRunningScopedJobKey] = useState<string | null>(null);
  const [restoringTargetKey, setRestoringTargetKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [operationsMessage, setOperationsMessage] = useState<string | null>(null);
  const [guardianDrafts, setGuardianDrafts] = useState<Record<string, string>>(() =>
    toGuardianDrafts(initialSettings.guardianContacts.missingStudents)
  );

  useEffect(() => {
    setSettings(initialSettings);
    setOrganizationDraft(createOrganizationDraft(initialSettings));
    setGuardianDrafts(toGuardianDrafts(initialSettings.guardianContacts.missingStudents));
  }, [initialSettings]);

  const permissionRows = useMemo(() => {
    return [
      { label: "Admin", value: settings.permissions.roleCounts.ADMIN ?? 0 },
      { label: "Manager", value: settings.permissions.roleCounts.MANAGER ?? 0 },
      { label: "Teacher", value: settings.permissions.roleCounts.TEACHER ?? 0 },
      { label: "Instructor", value: settings.permissions.roleCounts.INSTRUCTOR ?? 0 },
    ];
  }, [settings]);

  const refreshSettings = async (successMessage?: string, nextOperationsMessage?: string) => {
    const refreshed = await fetchSettingsData();
    setSettings(refreshed);
    setOrganizationDraft(createOrganizationDraft(refreshed));
    setGuardianDrafts(toGuardianDrafts(refreshed.guardianContacts.missingStudents));
    if (successMessage) {
      setMessage(successMessage);
    }
    if (nextOperationsMessage) {
      setOperationsMessage(nextOperationsMessage);
    }
  };

  const saveOrganizationSettings = async () => {
    if (!organizationDraft.organizationName.trim()) return;
    setSavingOrganization(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: {
            organizationName: organizationDraft.organizationName,
            planCode: organizationDraft.planCode,
            studentLimit: organizationDraft.studentLimit.trim() ? Number(organizationDraft.studentLimit) : null,
            defaultLocale: organizationDraft.defaultLocale,
            defaultTimeZone: organizationDraft.defaultTimeZone,
            guardianConsentRequired: organizationDraft.guardianConsentRequired,
            consentVersion: organizationDraft.consentVersion,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "組織設定の更新に失敗しました。");
      await refreshSettings("組織設定を更新しました。");
    } catch (nextError: any) {
      setMessage(nextError?.message ?? "組織設定の更新に失敗しました。");
    } finally {
      setSavingOrganization(false);
    }
  };

  const saveGuardianNames = async (studentId: string) => {
    const guardianNames = guardianDrafts[studentId]?.trim() ?? "";
    if (!guardianNames) {
      setMessage("保護者名を入力してください。");
      return;
    }

    setSavingGuardianId(studentId);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, guardianNames }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "保護者名の更新に失敗しました。");
      await refreshSettings(`保護者名を更新しました: ${body.student?.name ?? "生徒"}`);
    } catch (nextError: any) {
      setMessage(nextError?.message ?? "保護者名の更新に失敗しました。");
    } finally {
      setSavingGuardianId(null);
    }
  };

  const runJobKick = async () => {
    if (!window.confirm("保守ジョブを回します。よければ進めてください。")) {
      return;
    }
    setRunningJobs(true);
    setOperationsMessage(null);
    try {
      const res = await fetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency: 1 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "ジョブ再開に失敗しました。");
      await refreshSettings(undefined, `ジョブを回しました。処理件数: ${body?.processed ?? 0}`);
    } catch (nextError: any) {
      setOperationsMessage(nextError?.message ?? "ジョブ再開に失敗しました。");
    } finally {
      setRunningJobs(false);
    }
  };

  const runCleanup = async () => {
    if (!window.confirm("保存期限切れの掃除を実行します。よければ進めてください。")) {
      return;
    }
    setRunningCleanup(true);
    setOperationsMessage(null);
    try {
      const res = await fetch("/api/maintenance/cleanup", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "保守掃除に失敗しました。");
      await refreshSettings(undefined, "保存期限切れの掃除を実行しました。");
    } catch (nextError: any) {
      setOperationsMessage(nextError?.message ?? "保守掃除に失敗しました。");
    } finally {
      setRunningCleanup(false);
    }
  };

  const runScopedJobs = async (input: {
    key: string;
    conversationId?: string | null;
    sessionId?: string | null;
    successLabel: string;
  }) => {
    if (!window.confirm(`${input.successLabel}の処理を回します。よければ進めてください。`)) {
      return;
    }
    setRunningScopedJobKey(input.key);
    setOperationsMessage(null);
    try {
      const res = await fetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concurrency: 1,
          ...(input.conversationId ? { conversationId: input.conversationId } : {}),
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "個別再開に失敗しました。");
      await refreshSettings(undefined, `${input.successLabel}を回しました。処理件数: ${body?.processed ?? 0}`);
    } catch (nextError: any) {
      setOperationsMessage(nextError?.message ?? "個別再開に失敗しました。");
    } finally {
      setRunningScopedJobKey((current) => (current === input.key ? null : current));
    }
  };

  const restoreDeletedContent = async (input: {
    key: string;
    kind: "conversation" | "report";
    id: string;
    successLabel: string;
  }) => {
    if (!window.confirm(`${input.successLabel}を復元します。よければ進めてください。`)) {
      return;
    }
    setRestoringTargetKey(input.key);
    setOperationsMessage(null);
    try {
      const path =
        input.kind === "conversation"
          ? `/api/conversations/${input.id}/restore`
          : `/api/reports/${input.id}/restore`;
      const res = await fetch(path, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "復元に失敗しました。");
      await refreshSettings(undefined, `${input.successLabel}を復元しました。`);
    } catch (nextError: any) {
      setOperationsMessage(nextError?.message ?? "復元に失敗しました。");
    } finally {
      setRestoringTargetKey((current) => (current === input.key ? null : current));
    }
  };

  const canManage = settings.permissions.canManage;
  const timeZoneLabel = settings.organization.defaultTimeZone || "Asia/Tokyo";

  return (
    <div className={styles.page}>
      <AppHeader
        title="システム設定"
        subtitle="組織設定、招待、保護者情報、権限、保守の状態をここでまとめて確認します。"
        viewerName={viewerName}
        viewerRole={viewerRole}
      />

      <div className={styles.grid}>
        <Card
          title="組織の土台"
          subtitle="名前だけでなく、プラン、人数上限、言語、時差、同意まわりの基本設定をここで持ちます。"
        >
          <div className={styles.stack}>
            <div className={styles.field}>
              <label className={styles.label}>組織名</label>
              <input
                className={styles.input}
                value={organizationDraft.organizationName}
                onChange={(event) =>
                  setOrganizationDraft((current) => ({
                    ...current,
                    organizationName: event.target.value,
                  }))
                }
                disabled={!canManage}
              />
            </div>

            <div className={styles.miniGrid}>
              <div className={styles.field}>
                <label className={styles.label}>プラン名</label>
                <input
                  className={styles.input}
                  value={organizationDraft.planCode}
                  onChange={(event) =>
                    setOrganizationDraft((current) => ({ ...current, planCode: event.target.value }))
                  }
                  disabled={!canManage}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>生徒上限</label>
                <input
                  className={styles.input}
                  inputMode="numeric"
                  value={organizationDraft.studentLimit}
                  onChange={(event) =>
                    setOrganizationDraft((current) => ({ ...current, studentLimit: event.target.value }))
                  }
                  placeholder="未設定なら空欄"
                  disabled={!canManage}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>表示言語</label>
                <input
                  className={styles.input}
                  value={organizationDraft.defaultLocale}
                  onChange={(event) =>
                    setOrganizationDraft((current) => ({ ...current, defaultLocale: event.target.value }))
                  }
                  disabled={!canManage}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>タイムゾーン</label>
                <input
                  className={styles.input}
                  value={organizationDraft.defaultTimeZone}
                  onChange={(event) =>
                    setOrganizationDraft((current) => ({ ...current, defaultTimeZone: event.target.value }))
                  }
                  disabled={!canManage}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>同意バージョン</label>
              <input
                className={styles.input}
                value={organizationDraft.consentVersion}
                onChange={(event) =>
                  setOrganizationDraft((current) => ({ ...current, consentVersion: event.target.value }))
                }
                placeholder="例: 2026-04"
                disabled={!canManage}
              />
              <div className={styles.note}>
                最終更新: {formatDateTime(settings.organization.updatedAt, timeZoneLabel)} / 同意更新:
                {" "}
                {formatDateTime(settings.organization.consentUpdatedAt, timeZoneLabel)}
              </div>
            </div>

            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={organizationDraft.guardianConsentRequired}
                onChange={(event) =>
                  setOrganizationDraft((current) => ({
                    ...current,
                    guardianConsentRequired: event.target.checked,
                  }))
                }
                disabled={!canManage}
              />
              <span>保護者への共有前に同意確認を必須にする</span>
            </label>

            <div className={styles.buttonRow}>
              <Button
                onClick={saveOrganizationSettings}
                disabled={savingOrganization || !canManage || !organizationDraft.organizationName.trim()}
              >
                {savingOrganization ? "保存中..." : "組織設定を保存"}
              </Button>
              {!canManage ? <span className={styles.note}>このアカウントでは編集できません。</span> : null}
            </div>
            {message ? <div className={styles.note}>{message}</div> : null}
          </div>
        </Card>

        <Card
          title="招待とアカウント"
          subtitle="招待の詰まりや期限切れがないかをここで見ます。作成そのものは招待画面の役目です。"
        >
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>招待中</span>
              <strong>{settings.invitations.pendingCount}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>期限切れ</span>
              <strong>{settings.invitations.expiredCount}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>受け入れ済み</span>
              <strong>{settings.invitations.acceptedCount}</strong>
            </div>
          </div>
          <div className={styles.listBlock}>
            {settings.invitations.recentPending.length === 0 ? (
              <div className={styles.successBox}>いま未処理の招待はありません。</div>
            ) : (
              settings.invitations.recentPending.map((invitation) => (
                <div key={invitation.id} className={styles.listRow}>
                  <div>
                    <strong>{invitation.email}</strong>
                    <div className={styles.note}>
                      {invitation.role} / 期限: {formatDateTime(invitation.expiresAt, timeZoneLabel)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card
          title="保護者情報の穴埋め"
          subtitle="未入力の生徒だけを出して、その場で保護者名を埋められるようにしています。"
        >
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>入力済み</span>
              <strong>{settings.guardianContacts.studentsWithGuardian}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>未入力</span>
              <strong>{settings.guardianContacts.studentsMissingGuardian}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>カバレッジ</span>
              <strong>{settings.guardianContacts.coveragePercent}%</strong>
            </div>
          </div>

          <div className={styles.listBlock}>
            {settings.guardianContacts.missingStudents.length === 0 ? (
              <div className={styles.successBox}>保護者名が未入力の生徒はいません。</div>
            ) : (
              settings.guardianContacts.missingStudents.map((student) => (
                <div key={student.id} className={styles.studentEditor}>
                  <div className={styles.studentHeader}>
                    <div>
                      <strong>{student.name}</strong>
                      <div className={styles.note}>{student.grade ? `学年: ${student.grade}` : "学年未設定"}</div>
                    </div>
                    <Link href={`/app/students/${student.id}`} className={styles.inlineLink}>
                      生徒詳細を開く
                    </Link>
                  </div>
                  <label className={styles.label}>保護者名</label>
                  <input
                    className={styles.input}
                    value={guardianDrafts[student.id] ?? ""}
                    onChange={(event) =>
                      setGuardianDrafts((current) => ({
                        ...current,
                        [student.id]: event.target.value,
                      }))
                    }
                    placeholder="例: 山田 太郎 / 山田 花子"
                    disabled={!canManage}
                  />
                  <div className={styles.buttonRow}>
                    <Button
                      onClick={() => saveGuardianNames(student.id)}
                      disabled={!canManage || savingGuardianId === student.id || !(guardianDrafts[student.id] ?? "").trim()}
                    >
                      {savingGuardianId === student.id ? "保存中..." : "保護者名を保存"}
                    </Button>
                    {!canManage ? <span className={styles.note}>このアカウントでは編集できません。</span> : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card
          title="権限の考え方"
          subtitle="だれがどこまで触れるかを、人数だけでなく考え方でも見えるようにしています。"
        >
          <div className={styles.listBlock}>
            {permissionRows.map((row) => (
              <div key={row.label} className={styles.listRow}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
          <div className={styles.policyList}>
            {settings.permissions.policyRows.map((row) => (
              <div key={row.label} className={styles.policyItem}>
                <strong>{row.label}</strong>
                <p>担当: {row.roles}</p>
                <p>{row.note}</p>
              </div>
            ))}
          </div>
          <div className={styles.note}>
            現在のロール: {settings.permissions.viewerRole ?? "未設定"} / 編集権限:
            {" "}
            {canManage ? "あり" : "なし"}
          </div>
        </Card>

        <Card
          title="保守コンソール"
          subtitle="詰まりの有無、最近の操作、保守ボタンを 1 か所に寄せています。危ない操作は管理側だけが押せます。"
        >
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>会話 待ち</span>
              <strong>{settings.operations.queuedConversationJobs}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>会話 実行中</span>
              <strong>{settings.operations.runningConversationJobs}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>会話 詰まり疑い</span>
              <strong>{settings.operations.staleConversationJobs}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>音声 待ち</span>
              <strong>{settings.operations.queuedSessionPartJobs}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>音声 実行中</span>
              <strong>{settings.operations.runningSessionPartJobs}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>音声 詰まり疑い</span>
              <strong>{settings.operations.staleSessionPartJobs}</strong>
            </div>
          </div>

          <div className={styles.actionGrid}>
            <div className={styles.readOnlyBanner}>
              <strong>保守ボタン</strong>
              <p>ジョブ再開や保存期限切れの掃除を、管理者ログインのまま実行できます。</p>
              <div className={styles.buttonRow}>
                <Button onClick={runJobKick} disabled={!canManage || runningJobs || runningCleanup}>
                  {runningJobs ? "実行中..." : "ジョブを回す"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={runCleanup}
                  disabled={!canManage || runningCleanup || runningJobs}
                >
                  {runningCleanup ? "実行中..." : "保存期限切れを掃除"}
                </Button>
              </div>
            </div>

            <div className={styles.readOnlyBanner}>
              <strong>生徒の保守状況</strong>
              <p>アーカイブ済み生徒: {settings.operations.archivedStudents} 人</p>
              <p>本番の整合性確認は読み取り専用の `student-integrity-audit` で回します。</p>
            </div>
          </div>

          {operationsMessage ? <div className={styles.note}>{operationsMessage}</div> : null}

          <div className={styles.policyList}>
            <div className={styles.policyItem}>
              <strong>会話処理の明細</strong>
              <p>止まっている会話や、やり直し待ちの会話をここから直接回せます。</p>
              <div className={styles.listBlock}>
                {settings.operations.conversationJobRows.length === 0 ? (
                  <div className={styles.successBox}>会話処理の詰まりは見つかっていません。</div>
                ) : (
                  settings.operations.conversationJobRows.map((row) => {
                    const actionKey = `conversation:${row.targetId}`;
                    return (
                      <div key={row.id} className={styles.jobItem}>
                        <div className={styles.jobTop}>
                          <div>
                            <strong>{row.studentName ?? "生徒未設定"} / {row.jobType}</strong>
                            <div className={styles.note}>{buildJobDetail(row, timeZoneLabel)}</div>
                          </div>
                          <span className={styles.pill}>{row.statusLabel}</span>
                        </div>
                        <div className={styles.buttonRow}>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              runScopedJobs({
                                key: actionKey,
                                conversationId: row.targetId,
                                successLabel: "この会話",
                              })
                            }
                            disabled={!canManage || runningScopedJobKey === actionKey}
                          >
                            {runningScopedJobKey === actionKey ? "実行中..." : "この会話だけ回す"}
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className={styles.policyItem}>
              <strong>音声処理の明細</strong>
              <p>音声の文字起こしや昇格処理で止まったものを、セッション単位で回し直せます。</p>
              <div className={styles.listBlock}>
                {settings.operations.sessionPartJobRows.length === 0 ? (
                  <div className={styles.successBox}>音声処理の詰まりは見つかっていません。</div>
                ) : (
                  settings.operations.sessionPartJobRows.map((row) => {
                    const actionKey = `session:${row.sessionId}`;
                    return (
                      <div key={row.id} className={styles.jobItem}>
                        <div className={styles.jobTop}>
                          <div>
                            <strong>{row.studentName ?? "生徒未設定"} / {row.jobType}</strong>
                            <div className={styles.note}>{buildJobDetail(row, timeZoneLabel)}</div>
                          </div>
                          <span className={styles.pill}>{row.statusLabel}</span>
                        </div>
                        <div className={styles.buttonRow}>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              runScopedJobs({
                                key: actionKey,
                                sessionId: row.sessionId,
                                successLabel: "このセッション",
                              })
                            }
                            disabled={!canManage || !row.sessionId || runningScopedJobKey === actionKey}
                          >
                            {runningScopedJobKey === actionKey ? "実行中..." : "このセッションだけ回す"}
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className={styles.policyItem}>
              <strong>削除した会話ログ</strong>
              <p>間違って消した会話ログは、ここから元に戻せます。</p>
              <div className={styles.listBlock}>
                {settings.operations.deletedConversations.length === 0 ? (
                  <div className={styles.successBox}>いま復元待ちの会話ログはありません。</div>
                ) : (
                  settings.operations.deletedConversations.map((row) => {
                    const actionKey = `restore-conversation:${row.id}`;
                    return (
                      <div key={row.id} className={styles.jobItem}>
                        <div className={styles.jobTop}>
                          <div>
                            <strong>{row.studentName ?? "生徒未設定"}</strong>
                            <div className={styles.note}>{buildDeletedContentDetail(row, timeZoneLabel)}</div>
                          </div>
                          <span className={styles.pill}>削除中</span>
                        </div>
                        <div className={styles.buttonRow}>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              restoreDeletedContent({
                                key: actionKey,
                                kind: "conversation",
                                id: row.id,
                                successLabel: "会話ログ",
                              })
                            }
                            disabled={!canManage || restoringTargetKey === actionKey}
                          >
                            {restoringTargetKey === actionKey ? "復元中..." : "この会話を戻す"}
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className={styles.policyItem}>
              <strong>削除した保護者レポート</strong>
              <p>間違って消した保護者レポートも、ここから元に戻せます。</p>
              <div className={styles.listBlock}>
                {settings.operations.deletedReports.length === 0 ? (
                  <div className={styles.successBox}>いま復元待ちの保護者レポートはありません。</div>
                ) : (
                  settings.operations.deletedReports.map((row) => {
                    const actionKey = `restore-report:${row.id}`;
                    return (
                      <div key={row.id} className={styles.jobItem}>
                        <div className={styles.jobTop}>
                          <div>
                            <strong>{row.studentName ?? "生徒未設定"}</strong>
                            <div className={styles.note}>{buildDeletedContentDetail(row, timeZoneLabel)}</div>
                          </div>
                          <span className={styles.pill}>削除中</span>
                        </div>
                        <div className={styles.buttonRow}>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              restoreDeletedContent({
                                key: actionKey,
                                kind: "report",
                                id: row.id,
                                successLabel: "保護者レポート",
                              })
                            }
                            disabled={!canManage || restoringTargetKey === actionKey}
                          >
                            {restoringTargetKey === actionKey ? "復元中..." : "このレポートを戻す"}
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className={styles.listBlock}>
            {settings.operations.recentAuditLogs.length === 0 ? (
              <div className={styles.successBox}>最近の操作履歴はまだありません。</div>
            ) : (
              settings.operations.recentAuditLogs.map((log) => (
                <div key={log.id} className={styles.auditItem}>
                  <div className={styles.auditTop}>
                    <strong>{log.action}</strong>
                    <span className={styles.pill}>{log.status}</span>
                  </div>
                  <div className={styles.note}>
                    {formatDateTime(log.createdAt, timeZoneLabel)}
                    {log.targetType ? ` / 対象: ${log.targetType}` : ""}
                    {log.targetId ? ` / ID: ${log.targetId}` : ""}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card
          title="送信設定と保存ルール"
          subtitle="送信の状態と、どこまで残すかの考え方をまとめて確認できます。"
        >
          <div className={styles.policyList}>
            <div className={styles.policyItem}>
              <strong>メール送信</strong>
              <p>{settings.sending.emailStatusLabel}</p>
            </div>
            <div className={styles.policyItem}>
              <strong>手動共有</strong>
              <p>{settings.sending.manualShareEnabled ? "利用可能" : "未対応"}</p>
            </div>
            <div className={styles.policyItem}>
              <strong>LINE 第二チャネル</strong>
              <p>{settings.sending.lineStatusLabel}</p>
            </div>
            <div className={styles.policyItem}>
              <strong>文字起こし保存期間</strong>
              <p>{settings.trust.transcriptRetentionDays} 日</p>
            </div>
            <div className={styles.policyItem}>
              <strong>共有履歴保存期間</strong>
              <p>{settings.trust.reportDeliveryEventRetentionDays} 日</p>
            </div>
            <div className={styles.policyItem}>
              <strong>削除依頼フロー</strong>
              <p>{settings.trust.deletionRequestFlow}</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
