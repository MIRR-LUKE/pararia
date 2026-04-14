import path from "node:path";
import { loadEnvFile } from "./load-env-file";

export async function loadBackupEnv(rootDir: string) {
  const candidates = [
    path.join(rootDir, ".env"),
    path.join(rootDir, ".env.local"),
    path.join(rootDir, ".tmp", "vercel.env"),
    path.join(rootDir, ".tmp", "vercel-prod.env"),
  ];

  for (const candidate of candidates) {
    await loadEnvFile(candidate, { optional: true, overrideExisting: false });
  }
}
