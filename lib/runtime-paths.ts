import path from "node:path";

export const PARARIA_RUNTIME_DIR_ENV = "PARARIA_RUNTIME_DIR";

export function getRuntimeRootDir() {
  const configured = process.env[PARARIA_RUNTIME_DIR_ENV]?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  // Backward-compatible default for current local development.
  return path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
}

export function getRuntimePath(...segments: string[]) {
  return path.join(getRuntimeRootDir(), ...segments);
}
