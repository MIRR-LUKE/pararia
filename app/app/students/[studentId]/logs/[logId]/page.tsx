import { redirect } from "next/navigation";

export default function StudentLogDetailRedirect({
  params,
}: {
  params: { studentId: string; logId: string };
}) {
  redirect(`/app/students/${params.studentId}?panel=proof&logId=${params.logId}`);
}