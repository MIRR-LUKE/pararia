import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/server/app-session";
import { mapStudentDirectoryRows } from "@/lib/students/student-directory-view";
import { listStudentRows } from "@/lib/students/list-student-rows";
import StudentsPageClient from "./StudentsPageClient";

export default async function StudentsPage() {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const initialStudents = mapStudentDirectoryRows(
    await listStudentRows({
      organizationId,
      projection: "directory",
    })
  );

  return (
    <StudentsPageClient
      initialStudents={initialStudents}
      viewerName={session.user.name ?? null}
      viewerRole={(session.user as { role?: string | null }).role ?? null}
    />
  );
}
