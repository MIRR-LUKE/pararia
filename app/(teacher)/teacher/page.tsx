import { redirect } from "next/navigation";
import { buildTeacherAppBootstrap } from "@/lib/teacher-app/flow";
import { getTeacherAppSession } from "@/lib/server/teacher-app-session";
import { TeacherAppClient } from "./TeacherAppClient";

export default async function TeacherPage() {
  const session = await getTeacherAppSession();
  if (!session) {
    redirect("/teacher/setup");
  }

  const bootstrap = buildTeacherAppBootstrap(session);
  return <TeacherAppClient bootstrap={bootstrap} />;
}
