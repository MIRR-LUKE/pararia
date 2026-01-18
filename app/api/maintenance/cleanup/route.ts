import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export async function POST() {
  try {
    const now = new Date();
    const result = await prisma.conversationLog.updateMany({
      where: {
        rawTextExpiresAt: {
          lte: now,
        },
      },
      data: {
        rawTextOriginal: null,
        rawTextCleaned: null,
        rawSegments: Prisma.DbNull,
      },
    });

    return NextResponse.json({
      ok: true,
      cleared: result.count,
      ranAt: now.toISOString(),
    });
  } catch (e: any) {
    console.error("[POST /api/maintenance/cleanup] Error:", {
      error: e?.message,
      stack: e?.stack,
    });
    return NextResponse.json({ ok: false, error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
