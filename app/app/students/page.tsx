import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/server/app-session";
import { getCachedStudentDirectoryView } from "@/lib/students/get-cached-student-directory-view";
import StudentsPageClient from "./StudentsPageClient";

const STUDENT_DIRECTORY_INITIAL_LIMIT = 200;

export default async function StudentsPage() {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const initialStudents = await getCachedStudentDirectoryView({
    organizationId,
    limit: STUDENT_DIRECTORY_INITIAL_LIMIT,
  });

  return (
    <StudentsPageClient
      initialStudents={initialStudents}
      initialLimit={STUDENT_DIRECTORY_INITIAL_LIMIT}
      viewerName={session.user.name ?? null}
      viewerRole={(session.user as { role?: string | null }).role ?? null}
    />
  );
}
