import type { CapacitorConfig } from "@capacitor/cli";

const DEFAULT_SERVER_ORIGIN = "https://pararia.vercel.app";
const DEFAULT_START_PATH = "/teacher";
const DEFAULT_APP_ID = "jp.pararia.teacher";
const DEFAULT_APP_NAME = "PARARIA Teacher";

function readTrimmedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function normalizeStartPath(value: string): string {
  if (value === "/") {
    return value;
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

const serverOrigin = readTrimmedEnv("PARARIA_CAPACITOR_SERVER_ORIGIN") ?? DEFAULT_SERVER_ORIGIN;
const startPath = normalizeStartPath(
  readTrimmedEnv("PARARIA_CAPACITOR_START_PATH") ?? DEFAULT_START_PATH,
);
const appId = readTrimmedEnv("PARARIA_CAPACITOR_APP_ID") ?? DEFAULT_APP_ID;
const appName = readTrimmedEnv("PARARIA_CAPACITOR_APP_NAME") ?? DEFAULT_APP_NAME;

const serverUrl = new URL(serverOrigin);

const config: CapacitorConfig = {
  appId,
  appName,
  webDir: "www",
  server: {
    url: serverUrl.origin,
    cleartext: serverUrl.protocol === "http:",
    allowNavigation: [serverUrl.host],
    appStartPath: startPath,
  },
};

export default config;
