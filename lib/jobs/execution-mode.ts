const BACKGROUND_MODE_ENV = "PARARIA_BACKGROUND_MODE";

export type BackgroundExecutionMode = "inline" | "external";

export function getBackgroundExecutionMode(): BackgroundExecutionMode {
  const raw = process.env[BACKGROUND_MODE_ENV]?.trim().toLowerCase();
  if (raw === "external") return "external";
  return "inline";
}

export function shouldRunBackgroundJobsInline() {
  return getBackgroundExecutionMode() === "inline";
}
