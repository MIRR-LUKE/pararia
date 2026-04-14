const POOLED_DB_HOST_PATTERNS = [/pooler\.supabase\.com$/i, /\.pooler\./i];
const SUPABASE_POOLED_HOST_PATTERN = /pooler\.supabase\.com$/i;

function isLocalDatabaseHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

function isServerlessRuntime() {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.K_SERVICE
  );
}

function defaultPrismaConnectionLimit() {
  return isServerlessRuntime() ? "1" : "5";
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
      url.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT?.trim() || defaultPrismaConnectionLimit());
    }

    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT?.trim() || "20");
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function resolvePrismaDatasourceUrl() {
  const directUrl = process.env.DIRECT_URL?.trim();
  if (directUrl && !isServerlessRuntime() && !shouldConstrainPrismaPool(directUrl)) {
    return directUrl;
  }

  const primaryUrl = process.env.DATABASE_URL?.trim();
  return normalizePrismaDatabaseUrl(primaryUrl || directUrl);
}
