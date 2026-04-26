"use client";

import { AppHeader } from "@/components/layout/AppHeader";
import type { SettingsSnapshot } from "@/lib/settings/get-settings-snapshot";
import {
  SettingsGuardianContactsSection,
  SettingsInvitationsSection,
  SettingsOrganizationSection,
  SettingsPermissionsSection,
  SettingsSendingSection,
  SettingsTeacherAppDevicesSection,
} from "./SettingsPageSections";
import { useSettingsPageController } from "./useSettingsPageController";
import styles from "./settings.module.css";

type Props = {
  initialSettings: SettingsSnapshot;
  viewerName?: string | null;
  viewerRole?: string | null;
};

export default function SettingsPageClient({ initialSettings, viewerName, viewerRole }: Props) {
  const {
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
  } = useSettingsPageController({ initialSettings });

  const activeStudentCount = settings.guardianContacts.totalStudents;

  return (
    <div className={styles.page}>
      <AppHeader
        title="システム設定"
        subtitle="組織設定、招待、保護者情報、権限、送信設定をここで確認します。"
        viewerName={viewerName}
        viewerRole={viewerRole}
      />

      <div className={styles.grid}>
        <SettingsOrganizationSection
          canManage={canManage}
          message={message}
          settings={settings}
          timeZoneLabel={timeZoneLabel}
          organizationDraft={organizationDraft}
          remainingStudentSlots={remainingStudentSlots}
          savingOrganization={savingOrganization}
          onOrganizationDraftChange={setOrganizationDraft}
          onSaveOrganization={() => void saveOrganizationSettings()}
        />

        <SettingsInvitationsSection
          canManage={canManage}
          message={message}
          settings={settings}
          timeZoneLabel={timeZoneLabel}
        />

        <SettingsGuardianContactsSection
          canManage={canManage}
          message={message}
          settings={settings}
          timeZoneLabel={timeZoneLabel}
          guardianDrafts={guardianDrafts}
          savingGuardianId={savingGuardianId}
          onGuardianDraftChange={(studentId, next) =>
            setGuardianDrafts((current) => ({
              ...current,
              [studentId]: next,
            }))
          }
          onSaveGuardianNames={(studentId) => void saveGuardianNames(studentId)}
        />

        <SettingsPermissionsSection
          canManage={canManage}
          message={message}
          settings={settings}
          timeZoneLabel={timeZoneLabel}
          permissionRows={permissionRows}
        />

        <SettingsTeacherAppDevicesSection
          canManage={canManage}
          message={message}
          settings={settings}
          timeZoneLabel={timeZoneLabel}
          onRevokeDevice={(device) => void revokeTeacherAppDevice(device)}
          revokingDeviceId={revokingDeviceId}
        />

        <SettingsSendingSection
          canManage={canManage}
          message={message}
          settings={settings}
          timeZoneLabel={timeZoneLabel}
        />
      </div>

      <div className={styles.note}>在籍中の生徒数: {activeStudentCount} 人</div>
    </div>
  );
}
