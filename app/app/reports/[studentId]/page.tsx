import { redirect } from "next/navigation";

export default async function ReportBuilderRedirectPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  redirect(`/app/students/${studentId}?panel=report`);
}
