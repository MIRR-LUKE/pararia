import { NextResponse } from "next/server";
import { loginWithEmail } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json();
  const { email, password } = body ?? {};

  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  const user = await loginWithEmail(email, password);
  if (!user) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  // NOTE: Session/Cookie issuanceは認証基盤と統合する際に追加
  return NextResponse.json({ user });
}
