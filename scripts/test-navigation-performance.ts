import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import type { BrowserContext } from "playwright-core";
import { assertMeasurementStudent } from "./lib/measurement-student-guard";
import { renderRoutePerformanceReport, summarizeComparison, type RoutePerformanceRun } from "./lib/navigation-performance";
import { runNavigationPerformanceScenarios } from "./lib/navigation-performance-runner";

function argValue(...flags: string[]) {
  const index = process.argv.findIndex((arg) => flags.includes(arg));
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function detectBrowserExecutable() {
  const candidates = [
    process.env.RECORDING_UI_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!result.error) return candidate;
  }
  throw new Error("Edge / Chrome の実行ファイルが見つかりません。");
}

async function loadJsonIfExists<T>(filePath: string): Promise<T | null> {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function measureAuthApi(baseUrl: string) {
  const csrfStartedAt = Date.now();
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  const csrfBody = await csrfResponse.json();
  const csrfMs = Date.now() - csrfStartedAt;

  const authStartedAt = Date.now();
  const loginResponse = await fetch(`${baseUrl}/api/auth/callback/credentials?json=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    redirect: "manual",
    body: new URLSearchParams({
      csrfToken: String(csrfBody?.csrfToken ?? ""),
      email: "admin@demo.com",
      password: "demo123",
      callbackUrl: `${baseUrl}/app/dashboard`,
      json: "true",
    }),
  });
  if (loginResponse.status >= 400) {
    throw new Error(`認証 API に失敗しました: ${loginResponse.status}`);
  }
  return {
    csrfMs,
    authApiMs: Date.now() - authStartedAt,
  };
}

async function cleanupMeasurementStudent(
  context: BrowserContext,
  baseUrl: string,
  studentId: string
) {
  const readResponse = await context.request.get(`${baseUrl}/api/students/${studentId}`);
  if (!readResponse.ok()) {
    if (readResponse.status() === 404) {
      return;
    }
    const readBody = await readResponse.text().catch(() => "");
    throw new Error(`検証用生徒の確認に失敗しました: ${readResponse.status()} ${readBody}`.trim());
  }

  const readBody = await readResponse.json().catch(() => ({}));
  assertMeasurementStudent(readBody?.student, {
    namePrefix: "[",
    allowedGrades: ["計測用"],
    coursePrefixes: ["route-performance"],
  });

  const response = await context.request.delete(`${baseUrl}/api/students/${studentId}`);
  if (response.ok() || response.status() === 404) {
    return;
  }

  const body = await response.text().catch(() => "");
  throw new Error(`検証用生徒の削除に失敗しました: ${response.status()} ${body}`.trim());
}

async function main() {
  const label = argValue("--label") || "local";
  const baseUrl = argValue("--base-url") || "http://localhost:3000";
  const outputPath = path.resolve(process.cwd(), argValue("--out", "--output") || `.tmp/navigation-performance-${label}.json`);
  const reportPath = path.resolve(process.cwd(), argValue("--report") || `.tmp/navigation-performance-${label}.md`);
  const baselinePath = path.resolve(process.cwd(), argValue("--baseline") || ".tmp/navigation-performance-baseline.json");
  const writeBaseline = Boolean(argValue("--write-baseline"));
  await Promise.all([
    mkdir(path.dirname(outputPath), { recursive: true }),
    mkdir(path.dirname(reportPath), { recursive: true }),
    mkdir(path.dirname(baselinePath), { recursive: true }),
  ]);

  const browser = await chromium.launch({
    headless: true,
    executablePath: detectBrowserExecutable(),
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1100 },
  });
  const consoleErrors: string[] = [];
  const attachPageListeners = (page: Awaited<ReturnType<typeof context.newPage>>) => {
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });
  };
  context.on("page", attachPageListeners);
  const page = await context.newPage();
  attachPageListeners(page);

  let studentId = "";

  try {
    const loginPageStartedAt = Date.now();
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("h1", { timeout: 20_000 });
    const loginPageMs = Date.now() - loginPageStartedAt;

    const authMetric = await measureAuthApi(baseUrl);

    const csrfResponse = await context.request.get(`${baseUrl}/api/auth/csrf`);
    const csrfBody = await csrfResponse.json();
    const loginResponse = await context.request.post(`${baseUrl}/api/auth/callback/credentials?json=true`, {
      form: {
        csrfToken: String(csrfBody?.csrfToken ?? ""),
        email: "admin@demo.com",
        password: "demo123",
        callbackUrl: `${baseUrl}/app/dashboard`,
        json: "true",
      },
      maxRedirects: 0,
    });
    if (loginResponse.status() >= 400) throw new Error(`認証 API に失敗しました: ${loginResponse.status()}`);
    const authApiMs = authMetric.authApiMs;

    const createdStudentResponse = await context.request.post(`${baseUrl}/api/students`, {
      data: {
        name: `[${label}] perf ${new Date().toISOString().slice(11, 19)}`,
        grade: "計測用",
        course: "route-performance",
      },
    });
    const createdStudentBody = await createdStudentResponse.json().catch(() => ({}));
    if (!createdStudentResponse.ok || !createdStudentBody?.student?.id) {
      throw new Error(`検証用生徒の作成に失敗しました: ${JSON.stringify(createdStudentBody)}`);
    }
    studentId = String(createdStudentBody.student.id);

    const scenarios = await runNavigationPerformanceScenarios(context, baseUrl, studentId);
    const baseline = await loadJsonIfExists<RoutePerformanceRun>(baselinePath);
    const comparison = summarizeComparison(
      {
        label,
        baseUrl,
        generatedAt: new Date().toISOString(),
        loginPageMs,
        authApiMs,
        dashboardMs: scenarios[0]?.readyMs ?? 0,
        consoleErrors,
        scenarios,
      },
      baseline
    );
    if (comparison) comparison.baselinePath = baselinePath;

    for (const scenario of scenarios) {
      const baselineScenario = baseline?.scenarios.find((item) => item.id === scenario.id) ?? null;
      scenario.baselineMs = baselineScenario?.readyMs ?? null;
      scenario.deltaMs = baselineScenario ? scenario.readyMs - baselineScenario.readyMs : null;
      scenario.deltaPct = baselineScenario && baselineScenario.readyMs > 0 ? ((scenario.readyMs - baselineScenario.readyMs) / baselineScenario.readyMs) * 100 : null;
    }

    const result: RoutePerformanceRun = {
      label,
      baseUrl,
      generatedAt: new Date().toISOString(),
      loginPageMs,
      authApiMs,
      dashboardMs: scenarios[0]?.readyMs ?? 0,
      consoleErrors,
      scenarios,
    };

    if (writeBaseline) {
      await writeFile(baselinePath, JSON.stringify(result, null, 2), "utf8");
    }

    await writeFile(outputPath, JSON.stringify({ ...result, comparison }, null, 2), "utf8");
    await writeFile(reportPath, renderRoutePerformanceReport(result, comparison), "utf8");

    console.log(renderRoutePerformanceReport(result, comparison));
    console.log(`report md: ${reportPath}`);
    console.log(`metrics json: ${outputPath}`);
    if (writeBaseline) console.log(`baseline json: ${baselinePath}`);
  } finally {
    if (studentId) {
      try {
        await cleanupMeasurementStudent(context, baseUrl, studentId);
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
      }
    }
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
