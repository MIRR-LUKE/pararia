import { redirect } from "next/navigation";
import { listStudentRows } from "@/lib/students/list-student-rows";
import { getAppSession } from "@/lib/server/app-session";
import StudentsPageClient from "./StudentsPageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INITIAL_STUDENT_LIMIT = 30;

export default async function StudentsPage() {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const initialStudents = await listStudentRows({ organizationId, limit: INITIAL_STUDENT_LIMIT });
  return (
    <StudentsPageClient
      initialStudents={initialStudents}
      initialLimit={INITIAL_STUDENT_LIMIT}
      viewerName={session.user.name ?? null}
      viewerRole={(session.user as { role?: string | null }).role ?? null}
    />
  );
}
