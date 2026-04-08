import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/server/app-session";
import { getStudentRoomData } from "@/lib/students/get-student-room";
import StudentDetailPageClient from "./StudentDetailPageClient";

export default async function StudentDetailPage({
  params,
}: {
  params: { studentId: string };
}) {
  const session = await getAppSession();
  const organizationId = session?.user?.organizationId;
  if (!session?.user?.id || !organizationId) {
    redirect("/login");
  }

  const initialRoom = await getStudentRoomData({
    studentId: params.studentId,
    organizationId,
    viewerUserId: session.user.id,
    scope: "summary",
  });

  if (!initialRoom) {
    notFound();
  }

  return (
    <StudentDetailPageClient
      params={params}
      initialRoom={initialRoom}
      viewerName={session.user.name ?? null}
    />
  );
}
