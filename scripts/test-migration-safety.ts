import assert from "node:assert/strict";
import { assertPrismaMigrateDevTargetSafe } from "./lib/environment-safety";

const previousEnv = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  delete process.env.PARARIA_ALLOW_REMOTE_MIGRATE_DEV;
}

try {
  resetEnv();
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/pararia_dev?schema=public";
  process.env.DIRECT_URL = "postgresql://postgres:postgres@localhost:5432/pararia_dev?schema=public";
  assert.doesNotThrow(() => assertPrismaMigrateDevTargetSafe("test"));

  resetEnv();
  process.env.DATABASE_URL = "postgresql://postgres:postgres@db.example.com:5432/pararia?schema=public";
  assert.throws(() => assertPrismaMigrateDevTargetSafe("test"), /prisma migrate dev は local DB 専用/);

  resetEnv();
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/pararia_dev?schema=public";
  process.env.DIRECT_URL = "postgresql://postgres:postgres@db.example.com:5432/pararia?schema=public";
  assert.throws(() => assertPrismaMigrateDevTargetSafe("test"), /DIRECT_URL/);

  resetEnv();
  process.env.DATABASE_URL = "postgresql://postgres:postgres@db.example.com:5432/pararia?schema=public";
  process.env.PARARIA_ALLOW_REMOTE_MIGRATE_DEV = "1";
  assert.doesNotThrow(() => assertPrismaMigrateDevTargetSafe("test"));

  console.log("migration safety checks passed");
} finally {
  resetEnv();
}
