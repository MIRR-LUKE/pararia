import { resolvePrismaDatasourceUrl } from "@/lib/db-url";

const MUTATING_FIXTURE_OVERRIDE_ENV = "PARARIA_ALLOW_REMOTE_FIXTURES";
const REMOTE_SEED_OVERRIDE_ENV = "PARARIA_ALLOW_REMOTE_SEED";
const RESTORE_DRILL_OVERRIDE_ENV = "PARARIA_ALLOW_REMOTE_RESTORE_DRILL";

function isLocalHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function parseUrlHost(rawUrl?: string | null) {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}

export function isLocalBaseUrl(baseUrl: string) {
  const host = parseUrlHost(baseUrl);
  return host ? isLocalHostname(host) : false;
}

export function isLocalPrismaDatasource() {
  const datasourceUrl = resolvePrismaDatasourceUrl();
  const host = parseUrlHost(datasourceUrl);
  return host ? isLocalHostname(host) : false;
}

export function assertMutatingFixtureEnvironment(baseUrl: string, label: string) {
  if (process.env[MUTATING_FIXTURE_OVERRIDE_ENV]?.trim() === "1") {
    return;
  }

  const localBaseUrl = isLocalBaseUrl(baseUrl);
  const localDatasource = isLocalPrismaDatasource();

  if (localBaseUrl && localDatasource) {
    return;
  }

  throw new Error(
    `[${label}] mutating fixture scripts are blocked unless both app URL and Prisma datasource are local. ` +
      `baseUrl=${baseUrl} localBaseUrl=${localBaseUrl} localDatasource=${localDatasource}. ` +
      `Use ${MUTATING_FIXTURE_OVERRIDE_ENV}=1 only for an intentionally isolated non-production environment.`
  );
}

export function assertSeedTargetSafe(label: string) {
  if (process.env[REMOTE_SEED_OVERRIDE_ENV]?.trim() === "1") {
    return;
  }

  if (isLocalPrismaDatasource()) {
    return;
  }

  throw new Error(
    `[${label}] seed is blocked because Prisma datasource is not local. ` +
      `Set ${REMOTE_SEED_OVERRIDE_ENV}=1 only when you intentionally want to seed an isolated non-production remote database.`
  );
}

export function assertRestoreDrillTargetSafe(databaseUrl: string, label: string) {
  if (process.env[RESTORE_DRILL_OVERRIDE_ENV]?.trim() === "1") {
    return;
  }

  const host = parseUrlHost(databaseUrl);
  const localTarget = host ? isLocalHostname(host) : false;
  if (localTarget) {
    return;
  }

  throw new Error(
    `[${label}] restore drill is blocked because the target database is not local. ` +
      `databaseUrl=${databaseUrl}. Set ${RESTORE_DRILL_OVERRIDE_ENV}=1 only for an intentionally isolated non-production restore target.`
  );
}
