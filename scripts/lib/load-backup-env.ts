import path from "node:path";
import { loadEnvFile } from "./load-env-file";

type LoadBackupEnvOptions = {
  includeTmpEnv?: boolean;
};

export async function loadBackupEnv(rootDir: string, options?: LoadBackupEnvOptions) {
  const candidates = [path.join(rootDir, ".env"), path.join(rootDir, ".env.local")];

  if (options?.includeTmpEnv) {
    candidates.push(path.join(rootDir, ".tmp", "vercel.env"), path.join(rootDir, ".tmp", "vercel-prod.env"));
  }

  for (const candidate of candidates) {
    await loadEnvFile(candidate, { optional: true, overrideExisting: false });
  }
}
