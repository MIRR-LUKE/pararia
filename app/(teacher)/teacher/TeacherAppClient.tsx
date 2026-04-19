"use client";

import type { TeacherAppBootstrap } from "@/lib/teacher-app/types";
import { TeacherShell } from "./_components/TeacherShell";
import { TeacherAnalyzingScreen } from "./_screens/TeacherAnalyzingScreen";
import { TeacherDoneScreen } from "./_screens/TeacherDoneScreen";
import { TeacherPendingListScreen } from "./_screens/TeacherPendingListScreen";
import { TeacherRecordingScreen } from "./_screens/TeacherRecordingScreen";
import { TeacherStandbyScreen } from "./_screens/TeacherStandbyScreen";
import { TeacherStudentConfirmScreen } from "./_screens/TeacherStudentConfirmScreen";
import { useTeacherFlowController } from "./_hooks/useTeacherFlowController";
import styles from "./teacher.module.css";

type Props = {
  bootstrap: TeacherAppBootstrap;
};

export function TeacherAppClient({ bootstrap }: Props) {
  const controller = useTeacherFlowController({
    bootstrap,
  });

  let content: React.ReactNode;
  if (controller.state.kind === "recording") {
    content = (
      <TeacherRecordingScreen
        seconds={controller.state.seconds}
        onCancel={controller.cancelRecording}
        onStop={controller.stopRecording}
      />
    );
  } else if (controller.state.kind === "analyzing") {
    content = <TeacherAnalyzingScreen description={controller.state.description} />;
  } else if (controller.state.kind === "confirm") {
    content = (
      <TeacherStudentConfirmScreen
        recording={controller.state.recording}
        onChoose={controller.confirmStudent}
        onChooseNone={controller.confirmNoStudent}
      />
    );
  } else if (controller.state.kind === "done") {
    content = (
      <TeacherDoneScreen
        description={controller.state.description}
        onBack={controller.returnToStandby}
        title={controller.state.title}
      />
    );
  } else if (controller.state.kind === "pending") {
    content = (
      <TeacherPendingListScreen
        busyId={controller.pendingBusyId}
        items={controller.state.items}
        onBack={controller.returnToStandby}
        onDelete={controller.deletePendingUpload}
        onRetry={controller.retryPendingUpload}
      />
    );
  } else {
    content = (
      <TeacherStandbyScreen
        canStartRecording={controller.canStartRecording}
        microphoneDescription={controller.microphoneDescription}
        microphoneStatusLabel={controller.microphoneStatusLabel}
        microphoneTitle={controller.microphoneTitle}
        microphoneTone={controller.microphoneTone}
        onRefreshMicrophone={controller.refreshRecordingSupport}
        unsentCount={controller.unsentCount}
        onOpenPending={controller.openPending}
        onOpenRecordingPreview={controller.startRecording}
      />
    );
  }

  return (
    <main className={styles.page}>
      <TeacherShell
        session={bootstrap.session}
        errorMessage={controller.errorMessage}
        onLogout={() => void controller.logout()}
      >
        {content}
      </TeacherShell>
    </main>
  );
}
