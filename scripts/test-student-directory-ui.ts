#!/usr/bin/env tsx

import { spawnSync } from "node:child_process";
import { chromium, type BrowserContext } from "playwright-core";
import { prisma } from "@/lib/db";
import { assertMutatingFixtureEnvironment } from "./lib/environment-safety";
import { loadCriticalPathSmokeEnv } from "./lib/critical-path-smoke";

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
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!result.error) {
      return candidate;
    }
  }

  throw new Error("Edge / Chrome の実行ファイルが見つかりません。");
}

async function loginWithDemoUser(baseUrl: string, context: BrowserContext) {
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

  if (loginResponse.status() >= 400) {
    throw new Error(`認証 API に失敗しました: ${loginResponse.status()}`);
  }
}

async function main() {
  await loadCriticalPathSmokeEnv();

  const baseUrl = argValue("--base-url") || process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000";
  assertMutatingFixtureEnvironment(baseUrl, "student-directory-ui");
  const bootstrapUrl = process.env.CRITICAL_PATH_BOOTSTRAP_URL?.trim() || null;
  const browser = await chromium.launch({
    headless: true,
    executablePath: detectBrowserExecutable(),
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1024 },
  });
  const page = await context.newPage();

  const uniqueSuffix = Date.now();
  const studentName = `UI Student ${uniqueSuffix}`;
  let studentId: string | null = null;

  try {
    if (bootstrapUrl) {
      const bootstrapResponse = await context.request.get(bootstrapUrl, { maxRedirects: 10 });
      if (bootstrapResponse.status() >= 400) {
        throw new Error(`preview bootstrap failed: ${bootstrapResponse.status()}`);
      }
    }
    await loginWithDemoUser(baseUrl, context);

    const createResponse = await context.request.post(`${baseUrl}/api/students`, {
      data: {
        name: studentName,
        nameKana: "ユーアイ スチューデント",
        grade: "高2",
        course: "ui-smoke",
        guardianNames: "保護者UI",
      },
    });
    const createBody = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok() || !createBody?.student?.id) {
      throw new Error(`UI 検証用の生徒作成に失敗しました: ${JSON.stringify(createBody)}`);
    }
    studentId = String(createBody.student.id);

    await page.goto(`${baseUrl}/app/students`, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("名前、フリガナ、学年、コースで検索").fill(studentName);
    await page.getByText(studentName, { exact: true }).waitFor({ timeout: 20_000 });
    const studentRow = page.locator("article", { hasText: studentName }).first();
    await studentRow.getByRole("button", { name: "その場で編集" }).click();

    await page.waitForURL(`${baseUrl}/app/students`, { timeout: 20_000 });
    await studentRow.getByLabel("学年").waitFor({ timeout: 20_000 });
    await studentRow.getByLabel("学年").fill("高3");
    await studentRow.getByLabel("コース").fill("ui-smoke-updated");
    await studentRow.getByLabel("保護者名").fill("保護者UI更新");
    await studentRow.getByRole("button", { name: "保存する" }).click();
    await page.getByText("生徒情報を更新しました。").waitFor({ timeout: 20_000 });

    await studentRow.getByRole("button", { name: "その場で編集" }).waitFor({ timeout: 20_000 });
    await studentRow.getByRole("button", { name: "その場で編集" }).click();
    await studentRow.getByLabel("学年").waitFor({ timeout: 20_000 });
    await studentRow.getByLabel("学年").inputValue().then((value) => {
      if (value !== "高3") throw new Error(`学年が更新されていません: ${value}`);
    });
    await studentRow.getByLabel("コース").inputValue().then((value) => {
      if (value !== "ui-smoke-updated") throw new Error(`コースが更新されていません: ${value}`);
    });
    await studentRow.getByLabel("保護者名").inputValue().then((value) => {
      if (value !== "保護者UI更新") throw new Error(`保護者名が更新されていません: ${value}`);
    });
    await studentRow.getByRole("button", { name: "閉じる" }).click();

    await page.goto(`${baseUrl}/app/students`, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("名前、フリガナ、学年、コースで検索").fill(studentName);
    const updatedRow = page.locator("article", { hasText: studentName }).first();
    await updatedRow.waitFor({ timeout: 20_000 });
    await updatedRow.getByText("高3", { exact: true }).waitFor({ timeout: 20_000 });
    await updatedRow.getByText("コース: ui-smoke-updated").waitFor({ timeout: 20_000 });
  } finally {
    if (studentId) {
      await prisma.student.updateMany({
        where: {
          id: studentId,
          archivedAt: null,
        },
        data: {
          archivedAt: new Date(),
          archiveReason: "student_directory_ui_smoke_cleanup",
        },
      });
    }
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  console.log(
    JSON.stringify(
      {
        label: "student-directory-ui",
        baseUrl,
        studentId,
        studentName,
        verifiedGrade: "高3",
        verifiedCourse: "ui-smoke-updated",
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
