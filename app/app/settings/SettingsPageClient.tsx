"use client";

import { AppHeader } from "@/components/layout/AppHeader";
import type { SettingsSnapshot } from "@/lib/settings/get-settings-snapshot";
import {
  SettingsGuardianContactsSection,
  SettingsInvitationsSection,
  SettingsOperationsSection,
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
    runningRunpodAction,
    runCleanup,
    runJobKick,
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
  } = useSettingsPageController({ initialSettings });

  const activeStudentCount = settings.guardianContacts.totalStudents;

  return (
    <div className={styles.page}>
      <AppHeader
        title="システム設定"
        subtitle="組織設定、招待、保護者情報、権限、保守の状態をここでまとめて確認します。"
        viewerName={viewerName}
        viewerRole={viewerRole}
      />

      <div className={styles.grid}>
        <SettingsOrganizationSection
          canManage={canManage}
          message={message}
          operationsMessage={operationsMessage}
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
          operationsMessage={operationsMessage}
          settings={settings}
          timeZoneLabel={timeZoneLabel}
        />

        <SettingsGuardianContactsSection
          canManage={canManage}
          message={message}
          operationsMessage={operationsMessage}
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
          operationsMessage={operationsMessage}
          settings={settings}
          timeZoneLabel={timeZoneLabel}
          permissionRows={permissionRows}
        />

        <SettingsTeacherAppDevicesSection
          canManage={canManage}
          message={message}
          operationsMessage={operationsMessage}
          settings={settings}
          timeZoneLabel={timeZoneLabel}
          onRevokeDevice={(device) => void revokeTeacherAppDevice(device)}
          revokingDeviceId={revokingDeviceId}
        />

        <SettingsOperationsSection
          canManage={canManage}
          canRunOperations={canRunOperations}
          message={message}
          operationsMessage={operationsMessage}
          settings={settings}
          timeZoneLabel={timeZoneLabel}
          onOperateJob={(input) => void operateJob(input)}
          onRefreshRunpodStatus={() => void refreshRunpodStatus()}
          onRunCleanup={() => void runCleanup()}
          onRunJobKick={() => void runJobKick()}
          onRunpodAction={(action) => void runRunpodAction(action)}
          onRunScopedJobs={(input) => void runScopedJobs(input)}
          onRestoreDeletedContent={(input) => void restoreDeletedContent(input)}
          runpodControl={runpodControl}
          runningJobActionKey={runningJobActionKey}
          runningCleanup={runningCleanup}
          runningJobs={runningJobs}
          runningRunpodAction={runningRunpodAction}
          runningScopedJobKey={runningScopedJobKey}
          restoringTargetKey={restoringTargetKey}
        />

        <SettingsSendingSection
          canManage={canManage}
          message={message}
          operationsMessage={operationsMessage}
          settings={settings}
          timeZoneLabel={timeZoneLabel}
        />
      </div>

      <div className={styles.note}>在籍中の生徒数: {activeStudentCount} 人</div>
    </div>
  );
}
