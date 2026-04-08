import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listStudentRows } from "@/lib/students/list-student-rows";
import StudentsPageClient from "./StudentsPageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INITIAL_STUDENT_LIMIT = 50;

export default async function StudentsPage() {
  const session = await auth();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const initialStudents = await listStudentRows({ organizationId, limit: INITIAL_STUDENT_LIMIT });
  return <StudentsPageClient initialStudents={initialStudents} initialLimit={INITIAL_STUDENT_LIMIT} />;
}
