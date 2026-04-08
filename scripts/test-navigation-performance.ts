import path from "node:path";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

type NavigationPerfResult = {
  label: string;
  baseUrl: string;
  loginPageMs: number;
  authApiMs: number;
  dashboardReadyMs: number;
  studentsNavMs: number;
  studentDetailNavMs: number;
  studentId: string;
  studentName: string;
  consoleErrors: string[];
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
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
    if (!result.error) {
      return candidate;
    }
  }
  throw new Error("Edge / Chrome の実行ファイルが見つかりません。");
}

async function waitForCondition(timeoutMs: number, condition: () => Promise<boolean>, errorMessage: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(errorMessage);
}

async function gotoWithRetry(page: import("playwright-core").Page, url: string, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`goto retry failed: ${url}`);
}

async function main() {
  const label = argValue("--label") || "local";
  const baseUrl = argValue("--base-url") || "http://localhost:3000";
  const outputPath = path.resolve(
    process.cwd(),
    argValue("--output") || `.tmp/navigation-performance-${label}.json`
  );

  const browser = await chromium.launch({
    headless: true,
    executablePath: detectBrowserExecutable(),
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  let studentId = "";
  let studentName = "";

  try {
    const loginPageStartedAt = Date.now();
    await gotoWithRetry(page, `${baseUrl}/login`);
    await waitForCondition(
      20_000,
      async () => (await page.locator("h1").textContent())?.includes("PARARIA") ?? false,
      "ログインページが表示されませんでした。"
    );
    const loginPageMs = Date.now() - loginPageStartedAt;

    const authApiStartedAt = Date.now();
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
    });
    if (!loginResponse.ok) {
      throw new Error(`認証 API に失敗しました: ${loginResponse.status()}`);
    }
    const authApiMs = Date.now() - authApiStartedAt;

    const dashboardStartedAt = Date.now();
    await gotoWithRetry(page, `${baseUrl}/app/dashboard`);
    await waitForCondition(
      20_000,
      async () => (await page.locator("h1").textContent())?.includes("今日の優先キュー") ?? false,
      "ダッシュボード見出しが表示されませんでした。"
    );
    const dashboardReadyMs = Date.now() - dashboardStartedAt;

    const createStudentResponse = await context.request.post(`${baseUrl}/api/students`, {
      data: {
        name: `[${label}] perf ${new Date().toISOString().slice(11, 19)}`,
        grade: "検証用",
        course: "navigation-perf",
      },
    });
    const createStudentBody = await createStudentResponse.json().catch(() => ({}));
    if (!createStudentResponse.ok || !createStudentBody?.student?.id) {
      throw new Error(`検証用生徒の作成に失敗しました: ${JSON.stringify(createStudentBody)}`);
    }
    studentId = String(createStudentBody.student.id);
    studentName = String(createStudentBody.student.name);

    const studentsNavStartedAt = Date.now();
    await page.getByRole("link", { name: "生徒一覧" }).click();
    await waitForCondition(
      20_000,
      async () => page.url().includes("/app/students") && ((await page.locator("h1").textContent())?.includes("生徒一覧") ?? false),
      "生徒一覧へ遷移しませんでした。"
    );
    const studentsNavMs = Date.now() - studentsNavStartedAt;

    await waitForCondition(
      20_000,
      async () => (await page.locator("body").textContent())?.includes(studentName) ?? false,
      "作成した生徒が一覧に表示されませんでした。"
    );

    const row = page.locator("article").filter({ hasText: studentName }).first();
    const detailNavStartedAt = Date.now();
    await row.getByRole("link", { name: "生徒詳細へ" }).click();
    await waitForCondition(
      25_000,
      async () =>
        page.url().includes(`/app/students/${studentId}`) &&
        ((await page.locator("h1").textContent())?.includes(studentName) ?? false) &&
        (await page.locator("[data-recording-state]").count()) > 0,
      "生徒詳細へ遷移しませんでした。"
    );
    const studentDetailNavMs = Date.now() - detailNavStartedAt;

    const result: NavigationPerfResult = {
      label,
      baseUrl,
      loginPageMs,
      authApiMs,
      dashboardReadyMs,
      studentsNavMs,
      studentDetailNavMs,
      studentId,
      studentName,
      consoleErrors,
    };

    await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (studentId) {
      await context.request.delete(`${baseUrl}/api/students/${studentId}`).catch(() => {});
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
