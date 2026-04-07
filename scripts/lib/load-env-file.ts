import { readFile } from "node:fs/promises";

type LoadEnvFileOptions = {
  overrideExisting?: boolean;
  optional?: boolean;
};

export async function loadEnvFile(
  filePath: string,
  options?: LoadEnvFileOptions
) {
  const overrideExisting = options?.overrideExisting === true;
  const optional = options?.optional !== false;

  try {
    const raw = await readFile(filePath, "utf8");
    for (const line of raw.replace(/\r/g, "").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      if (!overrideExisting && process.env[key]) continue;
      let value = match[2].trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    if (optional) return;
    throw error;
  }
}
