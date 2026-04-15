import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { ReportDeliveryEventType, ReportStatus } from "@prisma/client";
import { auth } from "@/auth";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getLogListCacheTag } from "@/lib/logs/get-log-list-page-data";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(params);
    const session = await auth();
    const body = await request.json().catch(() => ({}));
    const action: "review" | "sent" | "delivered" | "failed" | "bounced" | "manual_share" | "resent" =
      typeof body?.action === "string" && body.action.trim()
        ? body.action.trim()
        : "manual_share";
    const deliveryChannel =
      typeof body?.deliveryChannel === "string" && body.deliveryChannel.trim()
        ? body.deliveryChannel.trim()
        : action === "manual_share"
          ? "manual"
          : null;
    const note =
      typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    const sentByUserId =
      typeof body?.sentByUserId === "string" && body.sentByUserId.trim()
        ? body.sentByUserId.trim()
        : session?.user?.id;

    const eventType =
      {
        review: ReportDeliveryEventType.REVIEWED,
        sent: ReportDeliveryEventType.SENT,
        delivered: ReportDeliveryEventType.DELIVERED,
        failed: ReportDeliveryEventType.FAILED,
        bounced: ReportDeliveryEventType.BOUNCED,
        manual_share: ReportDeliveryEventType.MANUAL_SHARED,
        resent: ReportDeliveryEventType.RESENT,
      }[action] ?? ReportDeliveryEventType.MANUAL_SHARED;

    const current = await prisma.report.findUnique({
      where: { id },
      select: {
        id: true,
        studentId: true,
        organizationId: true,
        status: true,
        reviewedAt: true,
        sentAt: true,
        deliveryChannel: true,
      },
    });

    if (!current) {
      return NextResponse.json({ error: "report not found" }, { status: 404 });
    }

    const now = new Date();
    const nextData: {
      status?: ReportStatus;
      reviewedAt?: Date;
      sentAt?: Date;
      sentByUserId?: string;
      deliveryChannel?: string | null;
    } = {};

    if (eventType === ReportDeliveryEventType.REVIEWED) {
      nextData.status = current.status === ReportStatus.SENT ? ReportStatus.SENT : ReportStatus.REVIEWED;
      if (!current.reviewedAt) nextData.reviewedAt = now;
    }

    if (
      eventType === ReportDeliveryEventType.SENT ||
      eventType === ReportDeliveryEventType.DELIVERED ||
      eventType === ReportDeliveryEventType.MANUAL_SHARED ||
      eventType === ReportDeliveryEventType.RESENT
    ) {
      nextData.status = ReportStatus.SENT;
      if (!current.reviewedAt) nextData.reviewedAt = now;
      if (!current.sentAt || eventType === ReportDeliveryEventType.RESENT) nextData.sentAt = now;
      nextData.sentByUserId = sentByUserId ?? undefined;
      nextData.deliveryChannel = deliveryChannel ?? current.deliveryChannel ?? null;
    }

    if (
      (eventType === ReportDeliveryEventType.FAILED || eventType === ReportDeliveryEventType.BOUNCED) &&
      current.status === ReportStatus.DRAFT
    ) {
      nextData.status = ReportStatus.REVIEWED;
      if (!current.reviewedAt) nextData.reviewedAt = now;
      nextData.deliveryChannel = deliveryChannel ?? current.deliveryChannel ?? null;
    }

    const result = await prisma.$transaction(async (tx) => {
      const report = await tx.report.update({
        where: { id },
        data: nextData,
      });

      const event = await tx.reportDeliveryEvent.create({
        data: {
          reportId: current.id,
          organizationId: current.organizationId,
          studentId: current.studentId,
          actorUserId: sentByUserId ?? undefined,
          eventType,
          deliveryChannel: deliveryChannel ?? current.deliveryChannel ?? null,
          note,
          eventMetaJson: {
            action,
            previousStatus: current.status,
          } as any,
        },
      });

      return { report, event };
    });

    await writeAuditLog({
      organizationId: current.organizationId,
      userId: sentByUserId ?? session?.user?.id,
      action: "report.delivery_event",
      targetType: "report",
      targetId: current.id,
      detail: {
        reportId: current.id,
        eventType,
        deliveryChannel: result.event.deliveryChannel ?? null,
      },
    });

    if (current.organizationId) {
      revalidateTag(`student-directory:${current.organizationId}`, "max");
      revalidateTag(`dashboard-snapshot:${current.organizationId}`, "max");
      revalidateTag(getLogListCacheTag(current.organizationId), "max");
      revalidatePath("/app/dashboard");
      revalidatePath("/app/students");
      revalidatePath("/app/logs");
      revalidatePath("/app/reports");
      revalidatePath(`/app/students/${current.studentId}`);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[POST /api/reports/[id]/send] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
