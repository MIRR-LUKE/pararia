import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/server/app-session";
import { getStudentRoomData } from "@/lib/students/get-student-room";
import StudentDetailPageClient from "./StudentDetailPageClient";

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: { studentId: string } | Promise<{ studentId: string }>;
  searchParams?: Promise<{ editStudent?: string | string[] }>;
}) {
  const { studentId } = await Promise.resolve(params);
  const resolvedSearchParams = (await searchParams) ?? {};
  const initialEditStudent = Array.isArray(resolvedSearchParams.editStudent)
    ? resolvedSearchParams.editStudent[0] === "1"
    : resolvedSearchParams.editStudent === "1";
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const initialRoom = await getStudentRoomData({
    studentId,
    organizationId,
    viewerUserId: session.user.id,
  });

  if (!initialRoom) {
    notFound();
  }

  return (
    <StudentDetailPageClient
      params={{ studentId }}
      initialRoom={initialRoom}
      initialEditStudent={initialEditStudent}
      viewerName={session.user.name ?? null}
    />
  );
}
