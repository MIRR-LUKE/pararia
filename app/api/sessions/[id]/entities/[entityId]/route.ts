import { NextResponse } from "next/server";
import { EntityStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; entityId: string } }
) {
  try {
    const body = await request.json();
    const action = body?.action === "ignore" ? "ignore" : "confirm";
    const canonicalValue =
      typeof body?.canonicalValue === "string" && body.canonicalValue.trim().length > 0
        ? body.canonicalValue.trim()
        : null;

    const entity = await prisma.sessionEntity.findUnique({
      where: { id: params.entityId },
    });

    if (!entity || entity.sessionId !== params.id) {
      return NextResponse.json({ error: "entity not found" }, { status: 404 });
    }

    const nextStatus = action === "ignore" ? EntityStatus.IGNORED : EntityStatus.CONFIRMED;
    const nextCanonical = canonicalValue ?? entity.canonicalValue ?? entity.rawValue;

    const updated = await prisma.sessionEntity.update({
      where: { id: entity.id },
      data: {
        status: nextStatus,
        canonicalValue: nextCanonical,
      },
    });

    if (nextStatus === EntityStatus.CONFIRMED) {
      const existing = await prisma.studentEntity.findFirst({
        where: {
          studentId: entity.studentId,
          kind: entity.kind,
          canonicalName: nextCanonical,
        },
      });

      if (existing) {
        const aliases = Array.isArray(existing.aliasesJson) ? (existing.aliasesJson as string[]) : [];
        if (!aliases.includes(entity.rawValue) && entity.rawValue !== nextCanonical) {
          await prisma.studentEntity.update({
            where: { id: existing.id },
            data: {
              aliasesJson: [...aliases, entity.rawValue] as any,
            },
          });
        }
      } else {
        await prisma.studentEntity.create({
          data: {
            studentId: entity.studentId,
            kind: entity.kind,
            canonicalName: nextCanonical,
            aliasesJson: entity.rawValue !== nextCanonical ? [entity.rawValue] : [],
          },
        });
      }
    }

    const pendingEntityCount = await prisma.sessionEntity.count({
      where: { sessionId: params.id, status: EntityStatus.PENDING },
    });

    await prisma.session.update({
      where: { id: params.id },
      data: { pendingEntityCount },
    });

    const conversation = await prisma.conversationLog.findUnique({
      where: { sessionId: params.id },
      select: { id: true, entityCandidatesJson: true },
    });

    if (conversation) {
      const candidates = (Array.isArray(conversation.entityCandidatesJson)
        ? conversation.entityCandidatesJson
        : []) as Array<Record<string, unknown>>;
      const nextCandidates = candidates.map((candidate) =>
        candidate.id === entity.id
          ? {
              ...candidate,
              status: nextStatus,
              canonicalValue: nextCanonical,
            }
          : candidate
      );
      await prisma.conversationLog.update({
        where: { id: conversation.id },
        data: {
          entityCandidatesJson: nextCandidates as any,
        },
      });
    }

    return NextResponse.json({ entity: updated, pendingEntityCount });
  } catch (error: any) {
    console.error("[PATCH /api/sessions/[id]/entities/[entityId]] Error:", error);
    return NextResponse.json({ error: error?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
