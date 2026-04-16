import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

async function main() {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "config", "csp.mjs")).href;
  const cspModule = await import(moduleUrl);
  const { buildSecurityHeaders } = cspModule as {
    buildSecurityHeaders: (input?: { nodeEnv?: string; cspReportOnly?: boolean }) => Array<{ key: string; value: string }>;
  };

  const productionHeaders = buildSecurityHeaders({ nodeEnv: "production", cspReportOnly: false });
  const productionCsp = productionHeaders.find((header) => header.key === "Content-Security-Policy");
  assert.ok(productionCsp, "production should emit enforced CSP");
  assert.ok(
    !productionHeaders.some((header) => header.key === "Content-Security-Policy-Report-Only"),
    "production should not default to report-only CSP"
  );
  const productionPermissionsPolicy = productionHeaders.find((header) => header.key === "Permissions-Policy");
  assert.equal(
    productionPermissionsPolicy?.value,
    "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
    "production Permissions-Policy should allow same-site microphone access without opening other sensors"
  );
  assert.ok(
    !productionCsp.value.includes("'unsafe-eval'"),
    "production CSP should not allow unsafe-eval"
  );
  assert.ok(
    productionCsp.value.includes("media-src 'self' blob: https:"),
    "production CSP should allow same-site and blob media playback for recording review"
  );

  const devHeaders = buildSecurityHeaders({ nodeEnv: "development", cspReportOnly: false });
  const devCsp = devHeaders.find((header) => header.key === "Content-Security-Policy-Report-Only");
  assert.ok(devCsp, "development should stay in report-only mode");
  assert.ok(
    devCsp.value.includes("'unsafe-eval'"),
    "development report-only CSP should allow unsafe-eval for tooling"
  );

  const rollbackHeaders = buildSecurityHeaders({ nodeEnv: "production", cspReportOnly: true });
  assert.ok(
    rollbackHeaders.some((header) => header.key === "Content-Security-Policy-Report-Only"),
    "explicit rollback flag should switch production back to report-only"
  );

  console.log("security headers regression checks passed");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
