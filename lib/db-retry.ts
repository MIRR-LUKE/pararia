function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /max clients reached/i.test(message) ||
    /remaining connection slots are reserved/i.test(message) ||
    /timed out fetching a new connection from the connection pool/i.test(message) ||
    /too many connections/i.test(message) ||
    /\bP2024\b/i.test(message)
  );
}

export async function runWithDatabaseRetry<T>(
  label: string,
  operation: () => Promise<T>,
  opts?: { retries?: number; initialDelayMs?: number }
) {
  const retries = Math.max(0, opts?.retries ?? 2);
  const initialDelayMs = Math.max(50, opts?.initialDelayMs ?? 120);

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isRetryableDatabaseError(error)) {
        throw error;
      }

      const delayMs = initialDelayMs * Math.pow(2, attempt);
      console.warn(`[db-retry:${label}] transient database saturation detected, retrying in ${delayMs}ms`);
      await sleep(delayMs);
      attempt += 1;
    }
  }
}
