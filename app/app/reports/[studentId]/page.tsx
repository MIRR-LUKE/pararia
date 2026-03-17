import { redirect } from "next/navigation";

export default function ReportBuilderRedirectPage({ params }: { params: { studentId: string } }) {
  redirect(`/app/students/${params.studentId}?panel=report`);
}