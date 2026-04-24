import os from "node:os";
import path from "node:path";

export const PARARIA_RUNTIME_DIR_ENV = "PARARIA_RUNTIME_DIR";
const VERCEL_RUNTIME_TEMP_DIR = path.join(os.tmpdir(), "pararia-runtime");

function shouldUseEphemeralRuntimeDir() {
  const cwd = process.cwd();
  return process.env.VERCEL === "1" || cwd === "/var/task" || cwd.startsWith("/var/task/");
}

export function getRuntimeRootDir() {
  const configured = process.env[PARARIA_RUNTIME_DIR_ENV]?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  if (shouldUseEphemeralRuntimeDir()) {
    return VERCEL_RUNTIME_TEMP_DIR;
  }

  // Backward-compatible default for current local development.
  return path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
}

export function getRuntimePath(...segments: string[]) {
  return path.join(getRuntimeRootDir(), ...segments);
}
