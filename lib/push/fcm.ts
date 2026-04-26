import { createSign } from "node:crypto";

type FcmServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

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

export function readFcmServiceAccount(): FcmServiceAccount | null {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    const parsed = JSON.parse(rawJson) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (parsed.project_id && parsed.client_email && parsed.private_key) {
      return {
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: normalizePrivateKey(parsed.private_key),
      };
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }
  return {
    projectId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
  };
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

async function getFcmAccessToken(account: FcmServiceAccount) {
  if (cachedAccessToken && cachedAccessToken.expiresAtMs > Date.now() + 60_000) {
    return cachedAccessToken.accessToken;
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
  const account = readFcmServiceAccount();
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
