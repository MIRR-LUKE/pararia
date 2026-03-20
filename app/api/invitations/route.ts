import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { generateInvitationPlainToken, hashInvitationToken } from "@/lib/invitations/inviteTokens";

export const dynamic = "force-dynamic";

function canManageInvites(role: string | undefined) {
  return role === UserRole.ADMIN || role === UserRole.MANAGER || role === "ADMIN" || role === "MANAGER";
}

function inviteTtlMs() {
  const days = Math.max(1, Math.min(30, Number(process.env.INVITATION_EXPIRES_DAYS ?? 7) || 7));
  return days * 24 * 60 * 60 * 1000;
}

function parseRole(raw: unknown): UserRole {
  if (raw === UserRole.ADMIN || raw === "ADMIN") return UserRole.ADMIN;
  if (raw === UserRole.MANAGER || raw === "MANAGER") return UserRole.MANAGER;
  if (raw === UserRole.INSTRUCTOR || raw === "INSTRUCTOR") return UserRole.INSTRUCTOR;
  return UserRole.TEACHER;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageInvites(session.user.role)) {
      return NextResponse.json({ error: "招待の管理権限がありません。" }, { status: 403 });
    }

    const now = new Date();
    const invitations = await prisma.organizationInvitation.findMany({
      where: {
        organizationId: session.user.organizationId,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ invitations });
  } catch (e: any) {
    console.error("[GET /api/invitations]", e);
    return NextResponse.json({ error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session?.user?.organizationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageInvites(session.user.role)) {
      return NextResponse.json({ error: "招待を作成する権限がありません。" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const emailRaw = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!emailRaw || !emailRaw.includes("@")) {
      return NextResponse.json({ error: "有効なメールアドレスを入力してください。" }, { status: 400 });
    }

    const targetRole = parseRole(body?.role);
    if (session.user.role === UserRole.MANAGER || session.user.role === "MANAGER") {
      if (targetRole === UserRole.ADMIN || targetRole === UserRole.MANAGER) {
        return NextResponse.json({ error: "室長ロールでは管理者・室長の招待は作成できません。" }, { status: 403 });
      }
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: emailRaw },
      select: { id: true },
    });
    if (existingUser) {
      return NextResponse.json({ error: "このメールアドレスは既に登録されています。" }, { status: 409 });
    }

    const now = new Date();
    const pending = await prisma.organizationInvitation.findFirst({
      where: {
        organizationId: session.user.organizationId,
        email: emailRaw,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (pending) {
      return NextResponse.json({ error: "このメールアドレスには有効な招待が既にあります。" }, { status: 409 });
    }

    const plain = generateInvitationPlainToken();
    const tokenHash = hashInvitationToken(plain);
    const expiresAt = new Date(now.getTime() + inviteTtlMs());

    await prisma.organizationInvitation.create({
      data: {
        organizationId: session.user.organizationId,
        email: emailRaw,
        role: targetRole,
        tokenHash,
        invitedByUserId: session.user.id,
        expiresAt,
      },
    });

    const origin =
      request.headers.get("x-forwarded-host") && request.headers.get("x-forwarded-proto")
        ? `${request.headers.get("x-forwarded-proto")}://${request.headers.get("x-forwarded-host")}`
        : new URL(request.url).origin;
    const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || origin;
    const inviteUrl = `${base}/invite/accept?token=${encodeURIComponent(plain)}`;

    return NextResponse.json(
      {
        inviteUrl,
        expiresAt: expiresAt.toISOString(),
        email: emailRaw,
        role: targetRole,
        /** 平文トークンはこの応答でのみ返します（以降は URL のみ保持）。 */
        token: plain,
      },
      { status: 201 }
    );
  } catch (e: any) {
    console.error("[POST /api/invitations]", e);
    return NextResponse.json({ error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
