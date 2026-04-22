import { NextResponse } from "next/server";
import { getRequestIp } from "@/lib/auth-throttle";
import { API_THROTTLE_RULES, ApiQuotaExceededError, consumeApiQuota } from "@/lib/api-throttle";

type LightMutationThrottleInput = {
  request: Request;
  scope: string;
  userId?: string | null;
  organizationId?: string | null;
};

type PublicThrottleInput = {
  request: Request;
  scope: string;
};

const LIGHT_MUTATION_THROTTLE_BYPASS_SCOPES = new Set([
  "recording-lock.heartbeat",
  "recording-lock.release",
  "sessions.progress",
  "teacher.recordings.progress",
]);

export async function applyLightMutationThrottle(input: LightMutationThrottleInput) {
  if (LIGHT_MUTATION_THROTTLE_BYPASS_SCOPES.has(input.scope)) {
    return null;
  }

  const checks: Parameters<typeof consumeApiQuota>[0][] = [];

  try {
    if (input.userId?.trim()) {
      checks.push({
        scope: `${input.scope}:user`,
        rawKey: input.userId,
        rule: API_THROTTLE_RULES.writeUser,
      });
    }

    if (input.organizationId?.trim()) {
      checks.push({
        scope: `${input.scope}:org`,
        rawKey: input.organizationId,
        rule: API_THROTTLE_RULES.writeOrg,
      });
    }

    const requestIp = getRequestIp(input.request);
    if (requestIp) {
      checks.push({
        scope: `${input.scope}:ip`,
        rawKey: requestIp,
        rule: API_THROTTLE_RULES.writeIp,
      });
    }

    for (const check of checks) {
      await consumeApiQuota(check);
    }
  } catch (error) {
    if (error instanceof ApiQuotaExceededError) {
      return NextResponse.json(
        {
          error: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(error.retryAfterSeconds),
          },
        }
      );
    }
    throw error;
  }

  return null;
}

export async function applyPublicIpThrottle(input: PublicThrottleInput) {
  const requestIp = getRequestIp(input.request);
  if (!requestIp) return null;

  try {
    await consumeApiQuota({
      scope: `${input.scope}:ip`,
      rawKey: requestIp,
      rule: API_THROTTLE_RULES.publicRumIp,
    });
  } catch (error) {
    if (error instanceof ApiQuotaExceededError) {
      return NextResponse.json(
        {
          error: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(error.retryAfterSeconds),
          },
        }
      );
    }
    throw error;
  }

  return null;
}
