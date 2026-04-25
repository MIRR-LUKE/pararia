"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { SettingsSnapshot } from "@/lib/settings/get-settings-snapshot";
import styles from "./settings.module.css";

type OrganizationDraft = {
  organizationName: string;
  planCode: string;
  studentLimit: string;
  defaultLocale: string;
  defaultTimeZone: string;
  guardianConsentRequired: boolean;
  consentVersion: string;
};

function formatDateTime(value: string | null | undefined, timeZone?: string) {
  if (!value) return "未設定";
  const date = new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timeZone || "Asia/Tokyo",
  }).format(date);
}

function buildJobDetail(row: { statusLabel: string; startedAt?: string | null; nextRetryAt?: string | null; leaseExpiresAt?: string | null; fileName?: string | null; lastError?: string | null }, timeZone: string) {
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

function buildDeletedContentDetail(row: { deletedAt?: string | null; deletedByLabel?: string | null; sessionId?: string | null; note?: string | null }, timeZone: string) {
  const parts = [
    `削除: ${formatDateTime(row.deletedAt, timeZone)}`,
    row.deletedByLabel ? `担当: ${row.deletedByLabel}` : null,
    row.sessionId ? `セッション: ${row.sessionId}` : null,
    row.note ? `メモ: ${row.note}` : null,
  ];
  return parts.filter(Boolean).join(" / ");
}

function buildDeviceClientDetail(
  row: SettingsSnapshot["teacherAppDevices"]["devices"][number],
  timeZone: string
) {
  const version =
    row.lastAppVersion || row.lastBuildNumber
      ? `${row.lastAppVersion ?? "version未設定"} / build ${row.lastBuildNumber ?? "未設定"}`
      : "version未設定";
  const parts = [
    `最終確認: ${formatDateTime(row.lastSeenAt, timeZone)}`,
    `認証: ${formatDateTime(row.lastAuthenticatedAt, timeZone)}`,
    `client: ${row.lastClientPlatform ?? "UNKNOWN"}`,
    version,
    row.configuredByLabel ? `設定者: ${row.configuredByLabel}` : null,
  ];
  return parts.filter(Boolean).join(" / ");
}

type BaseProps = {
  canManage: boolean;
  message: string | null;
  operationsMessage: string | null;
  settings: SettingsSnapshot;
  timeZoneLabel: string;
};

export function SettingsOrganizationSection({
  canManage,
  message,
  settings,
  timeZoneLabel,
  organizationDraft,
  remainingStudentSlots,
  savingOrganization,
  onOrganizationDraftChange,
  onSaveOrganization,
}: BaseProps & {
  organizationDraft: OrganizationDraft;
  remainingStudentSlots: number | null;
  savingOrganization: boolean;
  onOrganizationDraftChange: (next: OrganizationDraft) => void;
  onSaveOrganization: () => void;
}) {
  return (
    <Card title="組織の土台" subtitle="名前だけでなく、プラン、人数上限、言語、時差、同意まわりの基本設定をここで持ちます。">
      <div className={styles.stack}>
        <div className={styles.field}>
          <label className={styles.label}>組織名</label>
          <input
            className={styles.input}
            value={organizationDraft.organizationName}
            onChange={(event) => onOrganizationDraftChange({ ...organizationDraft, organizationName: event.target.value })}
            disabled={!canManage}
          />
        </div>
        <div className={styles.miniGrid}>
          <div className={styles.field}>
            <label className={styles.label}>プラン名</label>
            <input className={styles.input} value={organizationDraft.planCode} onChange={(event) => onOrganizationDraftChange({ ...organizationDraft, planCode: event.target.value })} disabled={!canManage} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>生徒上限</label>
            <input className={styles.input} inputMode="numeric" value={organizationDraft.studentLimit} onChange={(event) => onOrganizationDraftChange({ ...organizationDraft, studentLimit: event.target.value })} placeholder="未設定なら空欄" disabled={!canManage} />
            <span className={styles.note}>
              {remainingStudentSlots === null
                ? `いま ${settings.guardianContacts.totalStudents} 人が在籍中です。`
                : `いま ${settings.guardianContacts.totalStudents} / ${settings.organization.studentLimit} 人です。あと ${remainingStudentSlots} 人まで追加できます。`}
            </span>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>表示言語</label>
            <input className={styles.input} value={organizationDraft.defaultLocale} onChange={(event) => onOrganizationDraftChange({ ...organizationDraft, defaultLocale: event.target.value })} disabled={!canManage} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>タイムゾーン</label>
            <input className={styles.input} value={organizationDraft.defaultTimeZone} onChange={(event) => onOrganizationDraftChange({ ...organizationDraft, defaultTimeZone: event.target.value })} disabled={!canManage} />
          </div>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>同意バージョン</label>
          <input className={styles.input} value={organizationDraft.consentVersion} onChange={(event) => onOrganizationDraftChange({ ...organizationDraft, consentVersion: event.target.value })} placeholder="例: 2026-04" disabled={!canManage} />
          <div className={styles.note}>
            最終更新: {formatDateTime(settings.organization.updatedAt, timeZoneLabel)} / 同意更新: {formatDateTime(settings.organization.consentUpdatedAt, timeZoneLabel)}
          </div>
        </div>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={organizationDraft.guardianConsentRequired}
            onChange={(event) =>
              onOrganizationDraftChange({
                ...organizationDraft,
                guardianConsentRequired: event.target.checked,
              })
            }
            disabled={!canManage}
          />
          <span>保護者への共有前に同意確認を必須にする</span>
        </label>
        <div className={styles.buttonRow}>
          <Button onClick={onSaveOrganization} disabled={savingOrganization || !canManage || !organizationDraft.organizationName.trim()}>
            {savingOrganization ? "保存中..." : "組織設定を保存"}
          </Button>
          {!canManage ? <span className={styles.note}>このアカウントでは編集できません。</span> : null}
        </div>
        {message ? <div className={styles.note}>{message}</div> : null}
      </div>
    </Card>
  );
}

export function SettingsInvitationsSection({ settings, timeZoneLabel }: BaseProps) {
  return (
    <Card title="招待とアカウント" subtitle="招待の詰まりや期限切れがないかをここで見ます。作成そのものは招待画面の役目です。">
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
  );
}

export function SettingsGuardianContactsSection({
  canManage,
  settings,
  guardianDrafts,
  savingGuardianId,
  onGuardianDraftChange,
  onSaveGuardianNames,
}: BaseProps & {
  guardianDrafts: Record<string, string>;
  savingGuardianId: string | null;
  onGuardianDraftChange: (studentId: string, next: string) => void;
  onSaveGuardianNames: (studentId: string) => void;
}) {
  return (
    <Card title="保護者情報の穴埋め" subtitle="未入力の生徒だけを出して、その場で保護者名を埋められるようにしています。">
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
                onChange={(event) => onGuardianDraftChange(student.id, event.target.value)}
                placeholder="例: 山田 太郎 / 山田 花子"
                disabled={!canManage}
              />
              <div className={styles.buttonRow}>
                <Button
                  onClick={() => onSaveGuardianNames(student.id)}
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
  );
}

export function SettingsPermissionsSection({
  canManage,
  settings,
  permissionRows,
}: BaseProps & { permissionRows: { label: string; value: number }[] }) {
  return (
    <Card title="権限の考え方" subtitle="だれがどこまで触れるかを、人数だけでなく考え方でも見えるようにしています。">
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
        現在のロール: {settings.permissions.viewerRole ?? "未設定"} / 編集権限: {canManage ? "あり" : "なし"}
      </div>
    </Card>
  );
}

export function SettingsTeacherAppDevicesSection({
  canManage,
  settings,
  timeZoneLabel,
  onRevokeDevice,
  revokingDeviceId,
}: BaseProps & {
  onRevokeDevice: (device: SettingsSnapshot["teacherAppDevices"]["devices"][number]) => void;
  revokingDeviceId: string | null;
}) {
  return (
    <Card title="Teacher App 端末" subtitle="校舎端末の利用状態と、紛失・入れ替え時の停止操作を確認します。">
      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>有効端末</span>
          <strong>{settings.teacherAppDevices.activeCount}</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>停止済み</span>
          <strong>{settings.teacherAppDevices.revokedCount}</strong>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>表示件数</span>
          <strong>{settings.teacherAppDevices.devices.length}</strong>
        </div>
      </div>

      <div className={styles.listBlock}>
        {settings.teacherAppDevices.devices.length === 0 ? (
          <div className={styles.successBox}>登録済みの Teacher App 端末はまだありません。</div>
        ) : (
          settings.teacherAppDevices.devices.map((device) => (
            <div key={device.id} className={styles.jobItem}>
              <div className={styles.jobTop}>
                <div>
                  <strong>{device.label}</strong>
                  <div className={styles.note}>{buildDeviceClientDetail(device, timeZoneLabel)}</div>
                  <div className={styles.note}>active session: {device.activeAuthSessionCount}</div>
                </div>
                <span className={styles.pill}>{device.statusLabel}</span>
              </div>
              <div className={styles.buttonRow}>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => onRevokeDevice(device)}
                  disabled={!canManage || device.status !== "ACTIVE" || revokingDeviceId === device.id}
                >
                  {revokingDeviceId === device.id ? "停止中..." : "端末を停止"}
                </Button>
                {!canManage ? <span className={styles.note}>このアカウントでは停止できません。</span> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

export function SettingsOperationsSection({
  canManage,
  operationsMessage,
  settings,
  timeZoneLabel,
  onRunCleanup,
  onRunJobKick,
  onRunScopedJobs,
  onRestoreDeletedContent,
  runningCleanup,
  runningJobs,
  runningScopedJobKey,
  restoringTargetKey,
}: BaseProps & {
  onRunCleanup: () => void;
  onRunJobKick: () => void;
  onRunScopedJobs: (input: {
    key: string;
    conversationId?: string | null;
    sessionId?: string | null;
    successLabel: string;
  }) => void;
  onRestoreDeletedContent: (input: {
    key: string;
    kind: "conversation" | "report";
    id: string;
    successLabel: string;
  }) => void;
  runningCleanup: boolean;
  runningJobs: boolean;
  runningScopedJobKey: string | null;
  restoringTargetKey: string | null;
}) {
  return (
    <Card title="保守コンソール" subtitle="詰まりの有無、最近の操作、保守ボタンを 1 か所に寄せています。危ない操作は管理側だけが押せます。">
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
            <Button onClick={onRunJobKick} disabled={!canManage || runningJobs || runningCleanup}>
              {runningJobs ? "実行中..." : "ジョブを回す"}
            </Button>
            <Button variant="secondary" onClick={onRunCleanup} disabled={!canManage || runningCleanup || runningJobs}>
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
                        <strong>
                          {row.studentName ?? "生徒未設定"} / {row.jobType}
                        </strong>
                        <div className={styles.note}>{buildJobDetail(row, timeZoneLabel)}</div>
                      </div>
                      <span className={styles.pill}>{row.statusLabel}</span>
                    </div>
                    <div className={styles.buttonRow}>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          onRunScopedJobs({
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
                        <strong>
                          {row.studentName ?? "生徒未設定"} / {row.jobType}
                        </strong>
                        <div className={styles.note}>{buildJobDetail(row, timeZoneLabel)}</div>
                      </div>
                      <span className={styles.pill}>{row.statusLabel}</span>
                    </div>
                    <div className={styles.buttonRow}>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          onRunScopedJobs({
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
                          onRestoreDeletedContent({
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
                          onRestoreDeletedContent({
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
  );
}

export function SettingsSendingSection({ settings }: BaseProps) {
  return (
    <Card title="送信設定と保存ルール" subtitle="送信の状態と、どこまで残すかの考え方をまとめて確認できます。">
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
  );
}
