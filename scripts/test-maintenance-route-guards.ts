#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { methodNotAllowedResponse, requireSameOriginRequest } from "@/lib/server/request-security";

async function main() {
  const originalFindUnique = prisma.user.findUnique;
  const originalEnv = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    MAINTENANCE_SECRET: process.env.MAINTENANCE_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    MAINTENANCE_CRON_SECRET: process.env.MAINTENANCE_CRON_SECRET,
  };

  try {
    const liveUser = {
      id: "user-live",
      organizationId: "org-live",
      role: "ADMIN",
      name: "Live Admin",
      email: "live-admin@example.com",
    };

    (prisma.user.findUnique as any) = async ({ where }: { where: { id: string } }) => {
      if (where.id === liveUser.id) return { ...liveUser };
      return null;
    };

    const sameOriginRequest = new Request("https://example.com/api/jobs/run", {
      method: "POST",
      headers: {
        origin: "https://example.com",
      },
    });
    assert.equal(requireSameOriginRequest(sameOriginRequest), null, "same-origin request should pass");

    const crossOriginRequest = new Request("https://example.com/api/jobs/run", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
      },
    });
    const crossOriginResponse = requireSameOriginRequest(crossOriginRequest);
    assert.equal(crossOriginResponse?.status, 403, "cross-origin request should be blocked");

    const missingOriginRequest = new Request("https://example.com/api/jobs/run", {
      method: "POST",
    });
    assert.equal(requireSameOriginRequest(missingOriginRequest), null, "server-to-server request without browser headers should pass");

    const crossSiteFetchRequest = new Request("https://example.com/api/jobs/run", {
      method: "POST",
      headers: {
        "sec-fetch-site": "cross-site",
      },
    });
    const crossSiteFetchResponse = requireSameOriginRequest(crossSiteFetchRequest);
    assert.equal(crossSiteFetchResponse?.status, 403, "cross-site browser request should be blocked");

    process.env.MAINTENANCE_SECRET = "maintenance-secret";
    process.env.CRON_SECRET = "";
    process.env.MAINTENANCE_CRON_SECRET = "";
    process.env.AUTH_SECRET = "test-auth-secret";
    process.env.NEXTAUTH_SECRET = "test-auth-secret";

    const [{ requireMaintenanceAccess, resolveAuthorizedSession }, { GET: jobsRunGet }, { GET: maintenanceCleanupGet }] = await Promise.all([
      import("@/lib/server/request-auth"),
      import("@/app/api/jobs/run/route"),
      import("@/app/api/maintenance/cleanup/route"),
    ]);

    const staleSession = {
      user: {
        id: liveUser.id,
        organizationId: "org-old",
        role: "TEACHER",
        name: "Old Name",
        email: "old@example.com",
      },
    } as any;

    const resolved = await resolveAuthorizedSession(staleSession);
    assert.equal(resolved?.user.id, liveUser.id, "live session user id");
    assert.equal(resolved?.user.organizationId, liveUser.organizationId, "live session organization");
    assert.equal(resolved?.user.role, liveUser.role, "live session role");
    assert.equal(resolved?.user.name, liveUser.name, "live session name");
    assert.equal(resolved?.user.email, liveUser.email, "live session email");
    assert.equal(await resolveAuthorizedSession({ user: { id: "missing", organizationId: "org-x" } } as any), null);

    const maintenanceSecretRequest = new Request("https://example.com/api/jobs/run", {
      method: "POST",
      headers: {
        "x-maintenance-secret": "maintenance-secret",
      },
    });
    const secretAccess = await requireMaintenanceAccess(maintenanceSecretRequest);
    assert.equal(secretAccess.response, null, "secret access should bypass same-origin checks");
    assert.equal(secretAccess.actor?.kind, "maintenance_secret");
    assert.equal(secretAccess.actor?.secretName, "x-maintenance-secret");

    const jobsGetResponse = await jobsRunGet();
    assert.equal(jobsGetResponse.status, 405, "jobs GET should be blocked");
    assert.equal(jobsGetResponse.headers.get("Allow"), "POST");

    const cleanupGetResponse = await maintenanceCleanupGet();
    assert.equal(cleanupGetResponse.status, 405, "cleanup GET should be blocked");
    assert.equal(cleanupGetResponse.headers.get("Allow"), "POST");

    const methodNotAllowed = methodNotAllowedResponse(["POST"]);
    assert.equal(methodNotAllowed.status, 405, "helper status");
    assert.equal(methodNotAllowed.headers.get("Allow"), "POST");

    console.log("maintenance route guard regression checks passed");
  } finally {
    (prisma.user.findUnique as any) = originalFindUnique;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
