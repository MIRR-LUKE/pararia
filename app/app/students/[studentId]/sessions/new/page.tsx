import { redirect } from "next/navigation";

export default async function NewSessionPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  redirect(`/app/students/${studentId}?panel=recording&mode=INTERVIEW`);
}
