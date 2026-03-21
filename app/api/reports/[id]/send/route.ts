import { NextResponse } from "next/server";
import { ReportStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const body = await request.json().catch(() => ({}));
    const deliveryChannel =
      typeof body?.deliveryChannel === "string" && body.deliveryChannel.trim()
        ? body.deliveryChannel.trim()
        : "manual";
    const sentByUserId =
      typeof body?.sentByUserId === "string" && body.sentByUserId.trim()
        ? body.sentByUserId.trim()
        : session?.user?.id;

    const current = await prisma.report.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!current) {
      return NextResponse.json({ error: "report not found" }, { status: 404 });
    }

    const report = await prisma.report.update({
      where: { id: params.id },
      data: {
        status: ReportStatus.SENT,
        sentAt: new Date(),
        sentByUserId: sentByUserId ?? undefined,
        deliveryChannel,
      },
    });

    return NextResponse.json({ report });
  } catch (error: any) {
    console.error("[POST /api/reports/[id]/send] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
