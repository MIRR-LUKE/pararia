import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import {
  assertAuthThrottleAllowed,
  AuthRateLimitError,
  clearAuthThrottle,
  getRequestIp,
  recordAuthThrottleFailure,
} from "@/lib/auth-throttle";
import { hashInvitationToken } from "@/lib/invitations/inviteTokens";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const ipAddress = getRequestIp(request);

    await assertAuthThrottleAllowed("invite_token", token || "__missing__");
    if (ipAddress) {
      await assertAuthThrottleAllowed("invite_ip", ipAddress);
    }

    if (!token) {
      await recordAuthThrottleFailure("invite_token", "__missing__");
      if (ipAddress) {
        await recordAuthThrottleFailure("invite_ip", ipAddress);
      }
      return NextResponse.json({ error: "招待トークンが必要です。" }, { status: 400 });
    }
    if (!name || name.length < 1) {
      return NextResponse.json({ error: "表示名を入力してください。" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "パスワードは 8 文字以上にしてください。" }, { status: 400 });
    }

    const tokenHash = hashInvitationToken(token);
    const now = new Date();

    const invitation = await prisma.organizationInvitation.findUnique({
      where: { tokenHash },
    });

    if (!invitation || invitation.acceptedAt) {
      await recordAuthThrottleFailure("invite_token", token);
      if (ipAddress) {
        await recordAuthThrottleFailure("invite_ip", ipAddress);
      }
      return NextResponse.json({ error: "招待が無効か、既に使用済みです。" }, { status: 400 });
    }
    if (invitation.expiresAt <= now) {
      await recordAuthThrottleFailure("invite_token", token);
      if (ipAddress) {
        await recordAuthThrottleFailure("invite_ip", ipAddress);
      }
      return NextResponse.json({ error: "招待の有効期限が切れています。管理者に再発行を依頼してください。" }, { status: 400 });
    }

    const email = invitation.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      await recordAuthThrottleFailure("invite_token", token);
      if (ipAddress) {
        await recordAuthThrottleFailure("invite_ip", ipAddress);
      }
      return NextResponse.json({ error: "このメールアドレスは既に登録されています。ログインしてください。" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          organizationId: invitation.organizationId,
          email,
          name,
          role: invitation.role,
          passwordHash,
        },
      });
      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: now },
      });
    });

    await clearAuthThrottle("invite_token", token);
    if (ipAddress) {
      await clearAuthThrottle("invite_ip", ipAddress);
    }

    return NextResponse.json({ ok: true, email });
  } catch (e: any) {
    if (e instanceof AuthRateLimitError) {
      return NextResponse.json(
        {
          error: e.message,
          retryAfterSeconds: e.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(e.retryAfterSeconds),
          },
        }
      );
    }
    console.error("[POST /api/invitations/accept]", e);
    return NextResponse.json({ error: e?.message ?? "Internal Server Error" }, { status: 500 });
  }
}
