import type { BrowserContext, Page } from "playwright-core";
import {
  ROUTE_PERFORMANCE_BUDGETS,
  getBudgetStatus,
  type RoutePerformanceScenarioResult,
} from "./navigation-performance";

async function waitForCondition(timeoutMs: number, condition: () => Promise<boolean>, errorMessage: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(errorMessage);
}

async function gotoWithRetry(page: Page, url: string, timeoutMs = 60_000) {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`goto retry failed: ${url}`);
}

async function measureLoadingShell(page: Page, title: string, startedAt: number) {
  const status = page.getByRole("status", { name: title });
  try {
    const visible = await status.isVisible({ timeout: 100 });
    if (!visible) return null;
    return Date.now() - startedAt;
  } catch {
    return null;
  }
}

async function routeScenarioResult(
  page: Page,
  opts: {
    id: string;
    label: string;
    route: string;
    state: "empty" | "loading" | "populated";
    loadingTitle: string;
    readyCheck: () => Promise<boolean>;
    populatedCheck?: () => Promise<boolean>;
    emptyCheck?: () => Promise<boolean>;
    interaction?: () => Promise<number | null>;
    budgetKey: keyof typeof ROUTE_PERFORMANCE_BUDGETS;
    note?: string;
  }
): Promise<RoutePerformanceScenarioResult> {
  const startedAt = Date.now();
  await gotoWithRetry(page, opts.route);
  const loadingShellMs = await measureLoadingShell(page, opts.loadingTitle, startedAt);
  await waitForCondition(45_000, opts.readyCheck, `${opts.label} の表示待ちに失敗しました。`);
  const readyMs = Date.now() - startedAt;
  const interactionMs = opts.interaction ? await opts.interaction() : null;
  const populated = opts.populatedCheck ? await opts.populatedCheck() : null;
  const empty = opts.emptyCheck ? await opts.emptyCheck() : null;
  const actualState = empty ? "empty" : populated ? "populated" : opts.state;
  const budget = ROUTE_PERFORMANCE_BUDGETS[opts.budgetKey];
  const budgetStatus = getBudgetStatus(readyMs, budget);

  return {
    id: opts.id,
    label: opts.label,
    route: opts.route,
    state: actualState,
    loadingShellMs,
    readyMs,
    interactionMs,
    budget,
    budgetStatus,
    baselineMs: null,
    deltaMs: null,
    deltaPct: null,
    note: opts.note ?? null,
  };
}

export async function runNavigationPerformanceScenarios(context: BrowserContext, baseUrl: string, studentId: string) {
  const scenarios: RoutePerformanceScenarioResult[] = [];

  async function runWithFreshPage(
    buildOptions: (page: Page) => Parameters<typeof routeScenarioResult>[1]
  ) {
    const page = await context.newPage();
    try {
      return await routeScenarioResult(page, buildOptions(page));
    } finally {
      await page.close().catch(() => {});
    }
  }

  scenarios.push(
    await runWithFreshPage((page) => ({
      id: "dashboard-populated",
      label: "dashboard populated",
      route: `${baseUrl}/app/dashboard`,
      state: "populated",
      loadingTitle: "ダッシュボードを開いています...",
      readyCheck: async () => (await page.getByRole("heading", { name: "今日の優先キュー" }).count()) > 0,
      populatedCheck: async () => (await page.getByText("今日の優先対応はありません").count()) === 0,
      emptyCheck: async () => (await page.getByText("今日の優先対応はありません").count()) > 0,
      budgetKey: "dashboard",
    }))
  );

  scenarios.push(
    await runWithFreshPage((page) => ({
      id: "students-populated",
      label: "students populated",
      route: `${baseUrl}/app/students`,
      state: "populated",
      loadingTitle: "生徒一覧を開いています...",
      readyCheck: async () => (await page.getByRole("heading", { name: "生徒一覧" }).count()) > 0,
      populatedCheck: async () => (await page.locator("article").count()) > 0,
      emptyCheck: async () => (await page.getByText("条件に合う生徒がいません").count()) > 0,
      budgetKey: "students",
    }))
  );

  scenarios.push(
    await runWithFreshPage((page) => ({
      id: "students-empty-search",
      label: "students empty search",
      route: `${baseUrl}/app/students`,
      state: "empty",
      loadingTitle: "生徒一覧を開いています...",
      readyCheck: async () => (await page.getByRole("heading", { name: "生徒一覧" }).count()) > 0,
      populatedCheck: async () => (await page.locator("article").count()) > 0,
      emptyCheck: async () => (await page.getByText("条件に合う生徒がいません").count()) > 0,
      interaction: async () => {
        const startedAt = Date.now();
        const searchInput = page.locator("input[placeholder='名前、フリガナ、学年、コースで検索']");
        await searchInput.waitFor({ state: "visible", timeout: 5_000 });
        await page.waitForTimeout(120);
        await searchInput.fill("__zz_no_match__");
        await page.waitForTimeout(120);
        await waitForCondition(
          15_000,
          async () =>
            (await page.getByText("条件に合う生徒がいません").count()) > 0 ||
            (await page.locator("article").count()) === 0,
          "生徒一覧の空状態に到達しませんでした。"
        );
        return Date.now() - startedAt;
      },
      budgetKey: "studentsEmptySearch",
      note: "検索入力で空状態を再現",
    }))
  );

  scenarios.push(
    await runWithFreshPage((page) => ({
      id: "logs-populated",
      label: "logs populated",
      route: `${baseUrl}/app/logs`,
      state: "populated",
      loadingTitle: "ログ一覧を開いています...",
      readyCheck: async () => (await page.getByRole("heading", { name: "面談ログ" }).count()) > 0,
      populatedCheck: async () => (await page.locator("article").count()) > 0,
      emptyCheck: async () => (await page.getByText("この条件に合うログはありません").count()) > 0,
      budgetKey: "logs",
    }))
  );

  scenarios.push(
    await runWithFreshPage((page) => ({
      id: "logs-empty-student",
      label: "logs empty student",
      route: `${baseUrl}/app/logs?studentId=${encodeURIComponent(studentId)}`,
      state: "empty",
      loadingTitle: "ログ一覧を開いています...",
      readyCheck: async () => (await page.getByRole("heading", { name: "面談ログ" }).count()) > 0,
      populatedCheck: async () => (await page.locator("article").count()) > 0,
      emptyCheck: async () => (await page.getByText("この条件に合うログはありません").count()) > 0,
      budgetKey: "logsEmpty",
      note: "一時生徒で空ログを再現",
    }))
  );

  scenarios.push(
    await runWithFreshPage((page) => ({
      id: "reports-populated",
      label: "reports populated",
      route: `${baseUrl}/app/reports`,
      state: "populated",
      loadingTitle: "保護者レポートを読み込んでいます...",
      readyCheck: async () => (await page.getByRole("heading", { name: "保護者レポート" }).count()) > 0,
      populatedCheck: async () => (await page.getByText("Student Room で確認する").count()) > 0,
      emptyCheck: async () => (await page.getByText("この条件に合うレポートはありません").count()) > 0,
      budgetKey: "reports",
    }))
  );

  scenarios.push(
    await runWithFreshPage((page) => ({
      id: "reports-empty-filter",
      label: "reports empty filter",
      route: `${baseUrl}/app/reports?filter=manual`,
      state: "empty",
      loadingTitle: "保護者レポートを読み込んでいます...",
      readyCheck: async () => (await page.getByRole("heading", { name: "保護者レポート" }).count()) > 0,
      populatedCheck: async () => (await page.getByText("Student Room で確認する").count()) > 0,
      emptyCheck: async () => (await page.getByText("この条件に合うレポートはありません").count()) > 0,
      budgetKey: "reportsEmpty",
      note: "manual filter で空状態を優先",
    }))
  );

  return scenarios;
}
