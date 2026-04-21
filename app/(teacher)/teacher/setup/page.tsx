import { redirect } from "next/navigation";
import { getTeacherAppSession } from "@/lib/server/teacher-app-session";
import { TeacherSetupScreen } from "../_screens/TeacherSetupScreen";
import styles from "../teacher.module.css";

export default async function TeacherSetupPage() {
  const session = await getTeacherAppSession();
  if (session) {
    redirect("/teacher");
  }

  return (
    <main className={styles.page}>
      <TeacherSetupScreen />
    </main>
  );
}
