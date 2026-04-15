import assert from "node:assert/strict";
import { readConfiguredSecretValues, requireEnvValue } from "../lib/env";

const previousEnv = { ...process.env };

try {
  delete process.env.AUTH_SECRET;
  delete process.env.NEXTAUTH_SECRET;
  assert.throws(
    () => requireEnvValue(["AUTH_SECRET", "NEXTAUTH_SECRET"], "ログイン用の秘密鍵"),
    /ログイン用の秘密鍵/
  );

  process.env.AUTH_SECRET = "primary-secret";
  process.env.NEXTAUTH_SECRET = "secondary-secret";
  assert.equal(requireEnvValue(["AUTH_SECRET", "NEXTAUTH_SECRET"]), "primary-secret");

  process.env.MAINTENANCE_SECRET = "maintenance-secret";
  process.env.CRON_SECRET = "";
  assert.deepEqual(readConfiguredSecretValues(["MAINTENANCE_SECRET", "CRON_SECRET"]), [
    { name: "MAINTENANCE_SECRET", value: "maintenance-secret" },
  ]);

  console.log("env guard regression checks passed");
} finally {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, previousEnv);
}
