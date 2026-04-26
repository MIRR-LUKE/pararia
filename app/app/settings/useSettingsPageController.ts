"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DeletedContentRow,
  MissingStudent,
  OperationsJobRow,
  SettingsSnapshot,
  TeacherAppDeviceRow,
} from "@/lib/settings/get-settings-snapshot";

type OrganizationDraft = {
  organizationName: string;
  planCode: string;
  studentLimit: string;
  defaultLocale: string;
  defaultTimeZone: string;
  guardianConsentRequired: boolean;
  consentVersion: string;
};

type Props = {
  initialSettings: SettingsSnapshot;
};

type RunpodPodRow = {
  id: string;
  name: string | null;
  image: string | null;
  desiredStatus: string | null;
  lastStartedAt: string | null;
  createdAt: string | null;
  publicIp: string | null;
  machineId: string | null;
  gpuName: string | null;
  gpuCount: number | null;
  costPerHr: string | number | null;
};

type RunpodControlState = {
  pods: RunpodPodRow[];
  workerName: string | null;
  workerImage: string | null;
  configured: boolean;
  loading: boolean;
  message: string | null;
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

export function useSettingsPageController({ initialSettings }: Props) {
  const [settings, setSettings] = useState<SettingsSnapshot>(initialSettings);
  const [organizationDraft, setOrganizationDraft] = useState<OrganizationDraft>(() =>
    createOrganizationDraft(initialSettings)
  );
  const [savingOrganization, setSavingOrganization] = useState(false);
  const [savingGuardianId, setSavingGuardianId] = useState<string | null>(null);
  const [runningJobs, setRunningJobs] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [runningScopedJobKey, setRunningScopedJobKey] = useState<string | null>(null);
  const [runningJobActionKey, setRunningJobActionKey] = useState<string | null>(null);
  const [runningRunpodAction, setRunningRunpodAction] = useState<"status" | "start" | "stop" | null>(null);
  const [restoringTargetKey, setRestoringTargetKey] = useState<string | null>(null);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [operationsMessage, setOperationsMessage] = useState<string | null>(null);
  const [runpodControl, setRunpodControl] = useState<RunpodControlState>(() => ({
    pods: [],
    workerName: initialSettings.operations.runpod.workerName,
    workerImage: initialSettings.operations.runpod.workerImage,
    configured: initialSettings.operations.runpod.configured,
    loading: false,
    message: null,
  }));
  const [guardianDrafts, setGuardianDrafts] = useState<Record<string, string>>(() =>
    toGuardianDrafts(initialSettings.guardianContacts.missingStudents)
  );

  const activeStudentCount = settings.guardianContacts.totalStudents;
  const remainingStudentSlots =
    settings.organization.studentLimit === null || settings.organization.studentLimit === undefined
      ? null
      : Math.max(0, settings.organization.studentLimit - activeStudentCount);

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

  const operateJob = async (input: {
    key: string;
    kind: OperationsJobRow["kind"];
    jobId: string;
    action: "retry" | "cancel";
    label: string;
  }) => {
    const reason =
      input.action === "cancel"
        ? window.prompt(`${input.label} を取消します。理由を入力してください。`, "operator_cancel")
        : window.prompt(`${input.label} を再実行キューへ戻します。理由を入力してください。`, "operator_retry");
    if (!reason?.trim()) return;

    const verb = input.action === "cancel" ? "取消" : "再実行準備";
    if (!window.confirm(`${input.label} を${verb}します。よければ進めてください。`)) {
      return;
    }

    setRunningJobActionKey(input.key);
    setOperationsMessage(null);
    try {
      const res = await fetch(
        `/api/operations/jobs/${encodeURIComponent(input.kind)}/${encodeURIComponent(input.jobId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: input.action,
            reason,
          }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `${verb}に失敗しました。`);
      await refreshSettings(undefined, `${input.label} を${verb}しました。`);
    } catch (nextError: any) {
      setOperationsMessage(nextError?.message ?? `${verb}に失敗しました。`);
    } finally {
      setRunningJobActionKey((current) => (current === input.key ? null : current));
    }
  };

  const refreshRunpodStatus = async () => {
    setRunpodControl((current) => ({ ...current, loading: true, message: null }));
    setRunningRunpodAction("status");
    try {
      const res = await fetch("/api/operations/runpod", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Runpod状態の取得に失敗しました。");
      setRunpodControl({
        pods: body.runpod?.pods ?? [],
        workerName: body.runpod?.workerName ?? null,
        workerImage: body.runpod?.workerImage ?? null,
        configured: Boolean(body.runpod?.configured),
        loading: false,
        message: body.runpod?.error ?? "Runpod状態を更新しました。",
      });
    } catch (nextError: any) {
      setRunpodControl((current) => ({
        ...current,
        loading: false,
        message: nextError?.message ?? "Runpod状態の取得に失敗しました。",
      }));
    } finally {
      setRunningRunpodAction((current) => (current === "status" ? null : current));
    }
  };

  const runRunpodAction = async (action: "start" | "stop") => {
    const label = action === "start" ? "Runpod workerを起動" : "Runpod workerを停止";
    if (!window.confirm(`${label}します。よければ進めてください。`)) {
      return;
    }
    setRunningRunpodAction(action);
    setRunpodControl((current) => ({ ...current, loading: true, message: null }));
    try {
      const res = await fetch("/api/operations/runpod", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `${label}に失敗しました。`);
      setRunpodControl({
        pods: body.runpod?.pods ?? [],
        workerName: body.runpod?.workerName ?? null,
        workerImage: body.runpod?.workerImage ?? null,
        configured: Boolean(body.runpod?.configured),
        loading: false,
        message: `${label}しました。`,
      });
      await refreshSettings(undefined, `${label}しました。`);
    } catch (nextError: any) {
      setRunpodControl((current) => ({
        ...current,
        loading: false,
        message: nextError?.message ?? `${label}に失敗しました。`,
      }));
    } finally {
      setRunningRunpodAction((current) => (current === action ? null : current));
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
        input.kind === "conversation" ? `/api/conversations/${input.id}/restore` : `/api/reports/${input.id}/restore`;
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

  const revokeTeacherAppDevice = async (device: Pick<TeacherAppDeviceRow, "id" | "label">) => {
    const reason = window.prompt(
      `${device.label} を停止します。紛失・入れ替えなど、理由を入力してください。`,
      "lost_or_retired_device"
    );
    if (!reason?.trim()) {
      return;
    }

    const confirmLabel = window.prompt("確認のため、端末名をそのまま入力してください。", "");
    if (confirmLabel !== device.label) {
      setOperationsMessage("端末名が一致しなかったため、停止しませんでした。");
      return;
    }

    setRevokingDeviceId(device.id);
    setOperationsMessage(null);
    try {
      const res = await fetch(`/api/teacher-app-devices/${encodeURIComponent(device.id)}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          confirmLabel,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "端末の停止に失敗しました。");
      await refreshSettings(
        undefined,
        `${device.label} を停止しました。失効したセッション: ${body?.revokedAuthSessionCount ?? 0}`
      );
    } catch (nextError: any) {
      setOperationsMessage(nextError?.message ?? "端末の停止に失敗しました。");
    } finally {
      setRevokingDeviceId((current) => (current === device.id ? null : current));
    }
  };

  const canManage = settings.permissions.canManage;
  const canRunOperations = settings.permissions.canRunOperations;
  const timeZoneLabel = settings.organization.defaultTimeZone || "Asia/Tokyo";

  return {
    activeStudentCount,
    canManage,
    canRunOperations,
    guardianDrafts,
    message,
    operateJob,
    operationsMessage,
    organizationDraft,
    permissionRows,
    remainingStudentSlots,
    restoreDeletedContent,
    restoringTargetKey,
    revokeTeacherAppDevice,
    revokingDeviceId,
    refreshRunpodStatus,
    runpodControl,
    runRunpodAction,
    runningJobActionKey,
    runCleanup,
    runJobKick,
    runningRunpodAction,
    runScopedJobs,
    runningCleanup,
    runningJobs,
    runningScopedJobKey,
    saveGuardianNames,
    saveOrganizationSettings,
    savingGuardianId,
    savingOrganization,
    settings,
    setGuardianDrafts,
    setOrganizationDraft,
    timeZoneLabel,
  };
}
