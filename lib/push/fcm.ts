import { createSign } from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";

type FcmServiceAccount = {
  mode: "service_account";
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type FcmVercelOidcAccount = {
  mode: "vercel_oidc";
  projectId: string;
  projectNumber: string;
  serviceAccountEmail: string;
  workloadIdentityPoolId: string;
  workloadIdentityPoolProviderId: string;
};

type FcmAuthConfig = FcmServiceAccount | FcmVercelOidcAccount;

type FcmAccessToken = {
  accessToken: string;
  expiresAtMs: number;
};

export type FcmSendInput = {
  token: string;
  notification: {
    title: string;
    body: string;
  };
  data?: Record<string, string | null | undefined>;
};

export type FcmSendResult =
  | { ok: true; skipped: false; messageName: string | null }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string; status?: number };

let cachedAccessToken: FcmAccessToken | null = null;

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

export function readFcmAuthConfig(): FcmAuthConfig | null {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    const parsed = JSON.parse(rawJson) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (parsed.project_id && parsed.client_email && parsed.private_key) {
      return {
        mode: "service_account",
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: normalizePrivateKey(parsed.private_key),
      };
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (projectId || clientEmail || privateKey) {
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Incomplete Firebase service account environment variables");
    }
    return {
      mode: "service_account",
      projectId,
      clientEmail,
      privateKey: normalizePrivateKey(privateKey),
    };
  }

  const gcpProjectId = process.env.GCP_PROJECT_ID?.trim() || process.env.FIREBASE_PROJECT_ID?.trim();
  const projectNumber = process.env.GCP_PROJECT_NUMBER?.trim();
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL?.trim();
  const workloadIdentityPoolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID?.trim();
  const workloadIdentityPoolProviderId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID?.trim();
  const oidcValues = [
    gcpProjectId,
    projectNumber,
    serviceAccountEmail,
    workloadIdentityPoolId,
    workloadIdentityPoolProviderId,
  ];
  if (oidcValues.some(Boolean)) {
    if (oidcValues.some((value) => !value)) {
      throw new Error("Incomplete GCP workload identity environment variables for FCM");
    }
    return {
      mode: "vercel_oidc",
      projectId: gcpProjectId,
      projectNumber,
      serviceAccountEmail,
      workloadIdentityPoolId,
      workloadIdentityPoolProviderId,
    } as FcmVercelOidcAccount;
  }

  return null;
}

export function readFcmServiceAccount(): FcmServiceAccount | null {
  const config = readFcmAuthConfig();
  return config?.mode === "service_account" ? config : null;
}

async function createFcmAccessToken(account: FcmServiceAccount) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    })
  );
  const unsignedJwt = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(unsignedJwt).sign(account.privateKey);
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `FCM OAuth failed: ${response.status}`);
  }

  cachedAccessToken = {
    accessToken: body.access_token,
    expiresAtMs: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
  };
  return cachedAccessToken.accessToken;
}

async function createFcmVercelOidcAccessToken(account: FcmVercelOidcAccount) {
  const subjectToken = await getVercelOidcToken();
  const audience = `//iam.googleapis.com/projects/${account.projectNumber}/locations/global/workloadIdentityPools/${account.workloadIdentityPoolId}/providers/${account.workloadIdentityPoolProviderId}`;
  const tokenExchangeResponse = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: subjectToken,
    }),
  });
  const tokenExchangeBody = (await tokenExchangeResponse.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenExchangeResponse.ok || !tokenExchangeBody.access_token) {
    throw new Error(
      tokenExchangeBody.error_description ||
        tokenExchangeBody.error ||
        `FCM workload identity token exchange failed: ${tokenExchangeResponse.status}`
    );
  }

  const impersonationResponse = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account.serviceAccountEmail}:generateAccessToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenExchangeBody.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: ["https://www.googleapis.com/auth/firebase.messaging"],
        lifetime: "3600s",
      }),
    }
  );
  const impersonationBody = (await impersonationResponse.json().catch(() => ({}))) as {
    accessToken?: string;
    expireTime?: string;
    error?: { message?: string };
  };
  if (!impersonationResponse.ok || !impersonationBody.accessToken) {
    throw new Error(
      impersonationBody.error?.message || `FCM service account impersonation failed: ${impersonationResponse.status}`
    );
  }

  cachedAccessToken = {
    accessToken: impersonationBody.accessToken,
    expiresAtMs: impersonationBody.expireTime ? Date.parse(impersonationBody.expireTime) : Date.now() + 3600 * 1000,
  };
  return cachedAccessToken.accessToken;
}

async function getFcmAccessToken(account: FcmAuthConfig) {
  if (cachedAccessToken && cachedAccessToken.expiresAtMs > Date.now() + 60_000) {
    return cachedAccessToken.accessToken;
  }
  if (account.mode === "vercel_oidc") {
    return createFcmVercelOidcAccessToken(account);
  }
  return createFcmAccessToken(account);
}

function normalizeData(data: FcmSendInput["data"]) {
  return Object.fromEntries(
    Object.entries(data ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
      .map(([key, value]) => [key, value])
  );
}

export async function sendFcmMessage(input: FcmSendInput): Promise<FcmSendResult> {
  const account = readFcmAuthConfig();
  if (!account) {
    return { ok: true, skipped: true, reason: "fcm_not_configured" };
  }

  try {
    const accessToken = await getFcmAccessToken(account);
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: input.token,
          notification: input.notification,
          data: normalizeData(input.data),
          android: {
            priority: "HIGH",
            notification: {
              channel_id: "teacher_recordings",
              click_action: "jp.pararia.teacherapp.OPEN_RECORDING",
            },
          },
        },
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        status: response.status,
        error: body.error?.message || `FCM send failed: ${response.status}`,
      };
    }
    return {
      ok: true,
      skipped: false,
      messageName: body.name ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
