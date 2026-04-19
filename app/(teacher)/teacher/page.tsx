import { redirect } from "next/navigation";
import { buildTeacherAppBootstrap } from "@/lib/teacher-app/flow";
import { loadLatestActiveTeacherRecording } from "@/lib/teacher-app/server/recordings";
import { getTeacherAppSession } from "@/lib/server/teacher-app-session";
import { TeacherAppClient } from "./TeacherAppClient";

export default async function TeacherPage() {
  const session = await getTeacherAppSession();
  if (!session) {
    redirect("/teacher/setup");
  }

  const activeRecording = await loadLatestActiveTeacherRecording(session.organizationId, session.deviceLabel);
  const bootstrap = buildTeacherAppBootstrap(session, {
    activeRecording,
  });
  return <TeacherAppClient bootstrap={bootstrap} />;
}
