import { NextResponse } from "next/server";
import { auth } from "@/auth";

export type AuthorizedSession = Awaited<ReturnType<typeof auth>> & {
  user: {
    id: string;
    organizationId: string;
    role?: string;
    name?: string | null;
    email?: string | null;
  };
};

export async function requireAuthorizedSession() {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    } as const;
  }

  return {
    session: session as AuthorizedSession,
    response: null,
  } as const;
}
