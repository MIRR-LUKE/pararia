import { resolvePrismaDatasourceUrl } from "@/lib/db-url";

const MUTATING_FIXTURE_OVERRIDE_ENV = "PARARIA_ALLOW_REMOTE_FIXTURES";
const REMOTE_SEED_OVERRIDE_ENV = "PARARIA_ALLOW_REMOTE_SEED";
const RESTORE_DRILL_OVERRIDE_ENV = "PARARIA_ALLOW_REMOTE_RESTORE_DRILL";
const REMOTE_MIGRATE_DEV_OVERRIDE_ENV = "PARARIA_ALLOW_REMOTE_MIGRATE_DEV";

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

export function isLocalDatabaseUrl(rawUrl?: string | null) {
  const host = parseUrlHost(rawUrl);
  return host ? isLocalHostname(host) : false;
}

export function isLocalBaseUrl(baseUrl: string) {
  const host = parseUrlHost(baseUrl);
  return host ? isLocalHostname(host) : false;
}

export function isLocalPrismaDatasource() {
  const datasourceUrl = resolvePrismaDatasourceUrl();
  return isLocalDatabaseUrl(datasourceUrl);
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

export function assertPrismaMigrateDevTargetSafe(label: string) {
  if (process.env[REMOTE_MIGRATE_DEV_OVERRIDE_ENV]?.trim() === "1") {
    return;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  const directUrl = process.env.DIRECT_URL?.trim() || "";
  const checkedTargets = [
    { name: "DATABASE_URL", value: databaseUrl },
    { name: "DIRECT_URL", value: directUrl },
  ].filter((target) => target.value);

  if (checkedTargets.length === 0) {
    throw new Error(`[${label}] DATABASE_URL が必要です。`);
  }

  const remoteTargets = checkedTargets.filter((target) => !isLocalDatabaseUrl(target.value));
  if (remoteTargets.length === 0) {
    return;
  }

  const names = remoteTargets.map((target) => target.name).join(", ");
  throw new Error(
    `[${label}] prisma migrate dev は local DB 専用です。` +
      `${names} が local ではないため止めました。` +
      `shared / production DB は prisma migrate deploy を使ってください。` +
      ` isolated な検証DBで意図して実行するときだけ ${REMOTE_MIGRATE_DEV_OVERRIDE_ENV}=1 を指定してください。`
  );
}
