import { getRunpodWorkerConfig, runpodRequest } from "./worker-control-core";

export async function stopCurrentRunpodPod() {
  const podId = process.env.RUNPOD_POD_ID?.trim();
  const config = getRunpodWorkerConfig();
  if (!podId) {
    return {
      ok: false,
      skipped: "RUNPOD_POD_ID is not available in this environment.",
    };
  }
  if (!config) {
    return {
      ok: false,
      skipped: "RUNPOD_API_KEY is not configured in this environment.",
    };
  }

  try {
    await runpodRequest(`/pods/${podId}/stop`, config, { method: "POST" });
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
