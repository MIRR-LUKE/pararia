import { redirect } from "next/navigation";

export default async function StudentLogRedirect({
  params,
}: {
  params: Promise<{ studentId: string; logId: string }>;
}) {
  const { studentId, logId } = await params;
  redirect(`/app/students/${studentId}?panel=log&logId=${logId}`);
}
