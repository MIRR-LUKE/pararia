"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  MissingStudent,
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

export function useSettingsPageController({ initialSettings }: Props) {
  const [settings, setSettings] = useState<SettingsSnapshot>(initialSettings);
  const [organizationDraft, setOrganizationDraft] = useState<OrganizationDraft>(() =>
    createOrganizationDraft(initialSettings)
  );
  const [savingOrganization, setSavingOrganization] = useState(false);
  const [savingGuardianId, setSavingGuardianId] = useState<string | null>(null);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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

  const refreshSettings = async (successMessage?: string) => {
    const refreshed = await fetchSettingsData();
    setSettings(refreshed);
    setOrganizationDraft(createOrganizationDraft(refreshed));
    setGuardianDrafts(toGuardianDrafts(refreshed.guardianContacts.missingStudents));
    if (successMessage) {
      setMessage(successMessage);
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
      setMessage("端末名が一致しなかったため、停止しませんでした。");
      return;
    }

    setRevokingDeviceId(device.id);
    setMessage(null);
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
      await refreshSettings(`${device.label} を停止しました。失効したセッション: ${body?.revokedAuthSessionCount ?? 0}`);
    } catch (nextError: any) {
      setMessage(nextError?.message ?? "端末の停止に失敗しました。");
    } finally {
      setRevokingDeviceId((current) => (current === device.id ? null : current));
    }
  };

  const canManage = settings.permissions.canManage;
  const timeZoneLabel = settings.organization.defaultTimeZone || "Asia/Tokyo";

  return {
    activeStudentCount,
    canManage,
    guardianDrafts,
    message,
    organizationDraft,
    permissionRows,
    remainingStudentSlots,
    revokeTeacherAppDevice,
    revokingDeviceId,
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
