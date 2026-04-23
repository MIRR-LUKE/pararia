import { readFirstEnvValue } from "@/lib/env";
import type {
  RunpodRemoteSttClaimResponse,
  RunpodRemoteSttSubmitRequest,
} from "@/lib/runpod/remote-stt-types";

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function resolveRemoteWorkerBaseUrl() {
  const baseUrl = readFirstEnvValue(["NEXT_PUBLIC_APP_URL", "NEXTAUTH_URL"]);
  if (!baseUrl) {
    throw new Error("Runpod worker 用の公開 URL が未設定です。NEXT_PUBLIC_APP_URL か NEXTAUTH_URL が必要です。");
  }
  return trimTrailingSlash(baseUrl);
}

function resolveRemoteWorkerSecret() {
  const secret = readFirstEnvValue(["MAINTENANCE_SECRET", "CRON_SECRET", "MAINTENANCE_CRON_SECRET"]);
  if (!secret) {
    throw new Error("Runpod worker 用の maintenance secret が未設定です。");
  }
  return secret;
}

function resolveRemoteWorkerTimeoutMs() {
  const raw = process.env.RUNPOD_REMOTE_STT_REQUEST_TIMEOUT_MS?.trim();
  const parsed = Number(raw || 30_000);
  return Number.isFinite(parsed) ? Math.max(1_000, Math.floor(parsed)) : 30_000;
}

async function postRemoteWorkerJson<TResponse>(pathname: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveRemoteWorkerTimeoutMs());
  const response = await fetch(`${resolveRemoteWorkerBaseUrl()}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-maintenance-secret": resolveRemoteWorkerSecret(),
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `remote worker request failed: ${response.status}${text ? ` ${text.slice(0, 300)}` : ""}`
    );
  }

  return (await response.json()) as TResponse;
}

export async function pingRemoteSttApi() {
  return postRemoteWorkerJson<{ ok: true; ready: true }>(
    "/api/maintenance/runpod/stt/claim",
    { healthcheck: true }
  );
}

export async function claimRemoteSttTask(scope?: { sessionId?: string }) {
  return postRemoteWorkerJson<RunpodRemoteSttClaimResponse>(
    "/api/maintenance/runpod/stt/claim",
    {
      sessionId: scope?.sessionId ?? null,
    }
  );
}

export async function submitRemoteSttTaskResult(body: RunpodRemoteSttSubmitRequest) {
  return postRemoteWorkerJson<{ ok: true }>(
    "/api/maintenance/runpod/stt/submit",
    body as unknown as Record<string, unknown>
  );
}
