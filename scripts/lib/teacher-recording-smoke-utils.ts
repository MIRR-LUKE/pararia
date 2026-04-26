import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { loadEnvFile } from "./load-env-file";

export function argValue(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

export async function fileExists(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function withEnvFile<T>(envFile: string, work: () => Promise<T>) {
  const previous = { ...process.env };
  try {
    await loadEnvFile(envFile, { overrideExisting: true, optional: false });
    return await work();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

export async function waitForRunpodStop(envFile: string) {
  return withEnvFile(envFile, async () => {
    const { getRunpodPodsByName } = await import("../../lib/runpod/worker-control");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 180_000) {
      const pods = await getRunpodPodsByName().catch(() => []);
      const active = pods.filter(
        (pod: { desiredStatus?: string | null }) => !["EXITED", "TERMINATED"].includes(String(pod.desiredStatus || ""))
      );
      if (active.length === 0) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    return false;
  });
}
