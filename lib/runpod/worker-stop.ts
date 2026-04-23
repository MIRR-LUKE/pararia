const RUNPOD_API_BASE = "https://rest.runpod.io/v1";

function readStringEnv(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function readIntEnv(name: string, fallback: number, min = 0) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

async function stopRunpodPodById(podId: string, apiKey: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${RUNPOD_API_BASE}/pods/${podId}/stop`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    const payload = await response
      .json()
      .catch(async () => {
        const text = await response.text().catch(() => "");
        return text ? { message: text } : {};
      });
    if (!response.ok) {
      throw new Error(`Runpod API request failed: ${response.status} ${JSON.stringify(payload)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function stopCurrentRunpodPod() {
  const podId = process.env.RUNPOD_POD_ID?.trim();
  const apiKey = readStringEnv("RUNPOD_API_KEY");
  const timeoutMs = readIntEnv("RUNPOD_API_TIMEOUT_MS", 15_000, 1_000);
  if (!podId) {
    return {
      ok: false,
      skipped: "RUNPOD_POD_ID is not available in this environment.",
    };
  }
  if (!apiKey) {
    return {
      ok: false,
      skipped: "RUNPOD_API_KEY is not configured in this environment.",
    };
  }

  try {
    await stopRunpodPodById(podId, apiKey, timeoutMs);
    return {
      ok: true,
      podId,
    };
  } catch (error: any) {
    return {
      ok: false,
      podId,
      error: error?.message ?? String(error),
    };
  }
}
