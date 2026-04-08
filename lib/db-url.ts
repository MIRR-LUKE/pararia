const POOLED_DB_HOST_PATTERNS = [/pooler\.supabase\.com$/i, /\.pooler\./i];
const SUPABASE_POOLED_HOST_PATTERN = /pooler\.supabase\.com$/i;

function isLocalDatabaseHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

export function shouldConstrainPrismaPool(rawUrl?: string | null) {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return !isLocalDatabaseHost(url.hostname) && POOLED_DB_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

export function normalizePrismaDatabaseUrl(rawUrl?: string | null) {
  if (!rawUrl) return rawUrl ?? undefined;
  try {
    const url = new URL(rawUrl);
    if (!shouldConstrainPrismaPool(rawUrl)) {
      return url.toString();
    }

    if (SUPABASE_POOLED_HOST_PATTERN.test(url.hostname) && url.port === "5432") {
      url.port = "6543";
    }

    if (!url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }

    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT?.trim() || "1");
    }

    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT?.trim() || "20");
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}
