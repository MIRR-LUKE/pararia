import { spawnSync } from "node:child_process";
import { chromium, request, type APIRequestContext, type BrowserContextOptions, type LaunchOptions } from "playwright-core";
import { CRITICAL_PATH_BOOTSTRAP_URL, loadCriticalPathSmokeEnv, type CriticalPathSmokeCredentials } from "./critical-path-smoke-env";

function detectBrowserExecutable() {
  const candidates = [
    process.env.RECORDING_UI_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/opt/microsoft/msedge/msedge",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!result.error) {
      return candidate;
    }
  }

  throw new Error("Edge / Chrome の実行ファイルが見つかりません。");
}

async function loginSmokeUser(api: APIRequestContext, baseUrl: string, credentials: CriticalPathSmokeCredentials) {
  const csrfResponse = await api.get("/api/auth/csrf");
  if (!csrfResponse.ok()) {
    throw new Error(`auth csrf failed: ${csrfResponse.status()}`);
  }
  const csrfBody = await csrfResponse.json().catch(() => ({}));
  const csrfToken = String(csrfBody?.csrfToken ?? "").trim();
  if (!csrfToken) {
    throw new Error("auth csrf token is empty");
  }

  const loginResponse = await api.post("/api/auth/callback/credentials?json=true", {
    form: {
      csrfToken,
      email: credentials.email,
      password: credentials.password,
      callbackUrl: `${baseUrl}/app/dashboard`,
      json: "true",
    },
    maxRedirects: 0,
  });
  if (loginResponse.status() >= 400) {
    throw new Error(`smoke login failed: ${loginResponse.status()}`);
  }

  const sessionResponse = await api.get("/api/auth/session");
  if (!sessionResponse.ok()) {
    throw new Error(`auth session failed: ${sessionResponse.status()}`);
  }
  const sessionBody = await sessionResponse.json().catch(() => ({}));
  if (sessionBody?.user?.email === credentials.email) {
    if (String(sessionBody?.user?.id ?? "").length === 0) {
      throw new Error("authenticated user id is empty");
    }
    return;
  }

  const protectedResponse = await api.get("/api/students?limit=1");
  if (protectedResponse.status() >= 400) {
    throw new Error(`authenticated students access failed: ${protectedResponse.status()}`);
  }
}

async function bootstrapIfNeeded(api: APIRequestContext) {
  const bootstrapUrl = process.env.CRITICAL_PATH_BOOTSTRAP_URL?.trim() || CRITICAL_PATH_BOOTSTRAP_URL;
  if (!bootstrapUrl) return;
  const bootstrapResponse = await api.get(bootstrapUrl, { maxRedirects: 10 });
  if (bootstrapResponse.status() >= 400) {
    throw new Error(`bootstrap access failed: ${bootstrapResponse.status()}`);
  }
}

export async function createCriticalPathSmokeApi(baseUrl: string) {
  const credentials = await loadCriticalPathSmokeEnv();
  const requestApi = await request.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
  });

  try {
    await bootstrapIfNeeded(requestApi);
    await loginSmokeUser(requestApi, baseUrl, credentials);
    return {
      api: requestApi,
      close: () => requestApi.dispose(),
    };
  } catch (requestError) {
    await requestApi.dispose().catch(() => {});
    const browser = await chromium.launch({
      headless: true,
      executablePath: detectBrowserExecutable(),
    });
    const context = await browser.newContext({
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
    });

    try {
      const page = await context.newPage();
      const bootstrapUrl = process.env.CRITICAL_PATH_BOOTSTRAP_URL?.trim() || CRITICAL_PATH_BOOTSTRAP_URL;
      if (bootstrapUrl) {
        await page.goto(bootstrapUrl, { waitUntil: "domcontentloaded" });
      }
      await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
      await page.locator('input[type="email"]').fill(credentials.email);
      await page.locator('input[type="password"]').fill(credentials.password);
      await page.getByRole("button", { name: "ログイン" }).click();
      await page.waitForURL(/\/app\/dashboard/, { timeout: 20_000 });
      const protectedResponse = await context.request.get("/api/students?limit=1");
      if (protectedResponse.status() >= 400) {
        throw new Error(`authenticated students access failed: ${protectedResponse.status()}`);
      }
      return {
        api: context.request,
        close: async () => {
          await page.close().catch(() => {});
          await context.close().catch(() => {});
          await browser.close().catch(() => {});
        },
      };
    } catch (browserError) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      throw browserError ?? requestError;
    }
  }
}

export async function createCriticalPathBrowserContext(
  baseUrl: string,
  options?: {
    launch?: LaunchOptions;
    context?: BrowserContextOptions;
  }
) {
  const credentials = await loadCriticalPathSmokeEnv();
  const browser = await chromium.launch({
    headless: true,
    executablePath: detectBrowserExecutable(),
    ...options?.launch,
  });
  const context = await browser.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1024 },
    ...options?.context,
  });

  try {
    await bootstrapIfNeeded(context.request);
    await loginSmokeUser(context.request, baseUrl, credentials);
    return {
      browser,
      context,
      close: async () => {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      },
    };
  } catch (error) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
}
