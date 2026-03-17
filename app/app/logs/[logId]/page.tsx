import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export default async function LogDetailRedirectPage({ params }: { params: { logId: string } }) {
  const log = await prisma.conversationLog.findUnique({
    where: { id: params.logId },
    select: { studentId: true },
  });

  if (!log) {
    notFound();
  }

  redirect(`/app/students/${log.studentId}?panel=proof&logId=${params.logId}`);
}