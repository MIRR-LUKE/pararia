import { redirect } from "next/navigation";

export default function NewSessionPage({
  params,
}: {
  params: { studentId: string };
}) {
  redirect(`/app/students/${params.studentId}?panel=recording&mode=INTERVIEW`);
}