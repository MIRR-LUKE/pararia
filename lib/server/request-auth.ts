import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { auth } from "@/auth";
import { readConfiguredSecretValues } from "@/lib/env";
import { canRunMaintenanceRoutes, normalizeUserRole, roleLabelJa } from "@/lib/permissions";
import { isMaintenanceRoutePath, readBearerToken } from "@/lib/server/route-guards";

export type AuthorizedSession = Awaited<ReturnType<typeof auth>> & {
  user: {
    id: string;
    organizationId: string;
    role?: string;
    name?: string | null;
    email?: string | null;
  };
};

export type RequestActor =
  | {
      kind: "session";
      authMethod: "session";
      userId: string;
      organizationId: string;
      role: UserRole | null;
      roleLabel: string;
      name: string | null;
      email: string | null;
    }
  | {
      kind: "maintenance_secret";
      authMethod: "secret";
      secretName: string;
      secretSource: "header";
      secretConfigName: string;
      userId: null;
      organizationId: null;
      role: null;
      roleLabel: "保守鍵";
      name: null;
      email: null;
    };

export type MaintenanceAccessResult = {
  session: AuthorizedSession | null;
  actor: RequestActor | null;
  response: NextResponse | null;
};

function readMaintenanceSecretCandidates() {
  return readConfiguredSecretValues(["MAINTENANCE_SECRET", "CRON_SECRET", "MAINTENANCE_CRON_SECRET"]).map(
    (candidate) => ({
      secretName: candidate.name,
      value: candidate.value,
    })
  );
}

function readMaintenanceSecretFromRequest(request: Request) {
  const url = new URL(request.url);
  if (!isMaintenanceRoutePath(url.pathname)) {
    return null;
  }

  const bearerSecret = readBearerToken(request.headers.get("authorization"));
  if (bearerSecret) {
    return { secretName: "authorization", secretSource: "header" as const, secretValue: bearerSecret };
  }

  return null;
}

function resolveMaintenanceSecretAccess(request: Request): RequestActor | null {
  const requestSecret = readMaintenanceSecretFromRequest(request);
  if (!requestSecret) return null;

  const expectedSecrets = readMaintenanceSecretCandidates();
  const matched = expectedSecrets.find((candidate) => candidate.value === requestSecret.secretValue);
  if (!matched) return null;

  return {
    kind: "maintenance_secret",
    authMethod: "secret",
    secretName: requestSecret.secretName,
    secretSource: requestSecret.secretSource,
    secretConfigName: matched.secretName,
    userId: null,
    organizationId: null,
    role: null,
    roleLabel: "保守鍵",
    name: null,
    email: null,
  };
}

export function describeRequestActor(actor: RequestActor) {
  if (actor.kind === "session") {
    return {
      authMethod: actor.authMethod,
      kind: actor.kind,
      userId: actor.userId,
      organizationId: actor.organizationId,
      role: actor.role,
      roleLabel: actor.roleLabel,
      name: actor.name,
      email: actor.email,
    };
  }

  return {
    authMethod: actor.authMethod,
    kind: actor.kind,
    secretName: actor.secretName,
    secretSource: actor.secretSource,
    secretConfigName: actor.secretConfigName,
    roleLabel: actor.roleLabel,
  };
}

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

export async function requireMaintenanceAccess(request: Request): Promise<MaintenanceAccessResult> {
  const secretAccess = resolveMaintenanceSecretAccess(request);
  if (secretAccess) {
    return {
      session: null,
      actor: secretAccess,
      response: null,
    };
  }

  const sessionResult = await requireAuthorizedSession();
  if (sessionResult.response) {
    return {
      session: null,
      actor: null,
      response: sessionResult.response,
    };
  }

  const normalizedRole = normalizeUserRole(sessionResult.session.user.role);
  if (!canRunMaintenanceRoutes(normalizedRole)) {
    return {
      session: null,
      actor: null,
      response: NextResponse.json({ error: "この操作は管理者のみ可能です。" }, { status: 403 }),
    };
  }

  return {
    session: sessionResult.session,
    actor: {
      kind: "session",
      authMethod: "session",
      userId: sessionResult.session.user.id,
      organizationId: sessionResult.session.user.organizationId,
      role: normalizedRole,
      roleLabel: roleLabelJa(normalizedRole),
      name: sessionResult.session.user.name ?? null,
      email: sessionResult.session.user.email ?? null,
    },
    response: null,
  };
}
