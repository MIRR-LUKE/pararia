import path from "node:path";
import { access, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright-core";
import { loadEnvFile } from "./lib/load-env-file";

type RecordingUiResult = {
  label: string;
  baseUrl: string;
  studentId: string;
  startToPreparingMs: number;
  startToRecordingMs: number;
  recordToStopEnabledMs: number | null;
  stopToSuccessMs: number | null;
  totalMs: number;
  navigationDialogMessage: string | null;
  runpodStoppedAfterRun: boolean;
  nextMeetingMemoStatus: string | null;
  createdSessionId: string | null;
  createdConversationId: string | null;
  generatedLogPreview: string | null;
  observedStates: string[];
  consoleErrors: string[];
};

type SessionSummary = {
  id: string;
  conversation?: { id: string | null } | null;
  nextMeetingMemo?: { status: string | null } | null;
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureFakeAudioFile(wavPath: string, mp3Path: string) {
  if (await fileExists(wavPath)) {
    return wavPath;
  }
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static が見つからないため、録音検証用の WAV を生成できません。");
  }
  const result = spawnSync(
    ffmpegPath,
    ["-y", "-stream_loop", "-1", "-i", mp3Path, "-t", "125", "-ar", "48000", "-ac", "1", wavPath],
    {
      stdio: "pipe",
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `録音検証用の WAV 生成に失敗しました: ${result.stderr?.toString() || result.stdout?.toString() || "ffmpeg failed"}`
    );
  }
  return wavPath;
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

async function withEnvFile<T>(envFile: string, work: () => Promise<T>) {
  const previous = { ...process.env };
  try {
    await loadEnvFile(envFile, { overrideExisting: true, optional: false });
    return await work();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

async function waitForRunpodStop(envFile: string) {
  return withEnvFile(envFile, async () => {
    const { getManagedRunpodPods } = await import("../lib/runpod/worker-control");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 180_000) {
      const pods = await getManagedRunpodPods().catch(() => []);
      const active = pods.filter((pod) => !["EXITED", "TERMINATED"].includes(String(pod.desiredStatus || "")));
      if (active.length === 0) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    return false;
  });
}

async function cleanupStudentArtifacts(envFile: string, studentId: string) {
  return withEnvFile(envFile, async () => {
    const [{ prisma }, { deleteStorageEntry }] = await Promise.all([
      import("../lib/db"),
      import("../lib/audio-storage"),
    ]);

    const sessions = await prisma.session.findMany({
      where: { studentId },
      include: {
        parts: true,
        conversation: true,
      },
    });

    for (const session of sessions) {
      for (const part of session.parts) {
        if (part.storageUrl) {
          await deleteStorageEntry(part.storageUrl).catch(() => {});
        }
      }
      if (session.conversation) {
        await prisma.conversationJob.deleteMany({ where: { conversationId: session.conversation.id } }).catch(() => {});
        await prisma.conversationLog.deleteMany({ where: { id: session.conversation.id } }).catch(() => {});
      }
      await prisma.sessionPartJob.deleteMany({ where: { sessionPart: { sessionId: session.id } } }).catch(() => {});
      await prisma.sessionPart.deleteMany({ where: { sessionId: session.id } }).catch(() => {});
      await prisma.nextMeetingMemo.deleteMany({ where: { sessionId: session.id } }).catch(() => {});
      await prisma.session.deleteMany({ where: { id: session.id } }).catch(() => {});
    }

    await prisma.studentRecordingLock.deleteMany({ where: { studentId } }).catch(() => {});
    await prisma.studentProfile.deleteMany({ where: { studentId } }).catch(() => {});
    await prisma.student.deleteMany({ where: { id: studentId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });
}

async function waitForCondition(
  timeoutMs: number,
  condition: () => Promise<boolean>,
  errorMessage: string
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(errorMessage);
}

async function waitForSessionArtifacts(
  request: { get: (url: string) => Promise<any> },
  baseUrl: string,
  studentId: string
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 180_000) {
    const response = await request.get(`${baseUrl}/api/students/${studentId}/room`);
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      const latest = (body?.sessions ?? [])[0] as SessionSummary | undefined;
      if (latest?.conversation?.id) {
        const memoStatus = latest.nextMeetingMemo?.status ?? null;
        if (memoStatus === "READY" || memoStatus === "FAILED") {
          return {
            sessionId: latest.id,
            conversationId: latest.conversation.id,
            nextMeetingMemoStatus: memoStatus,
          };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_500));
  }
  throw new Error("録音後の session / conversation / 次回面談メモの状態取得がタイムアウトしました。");
}

async function main() {
  const label = argValue("--label") || process.env.RECORDING_UI_LABEL || "local";
  const baseUrl = argValue("--base-url") || process.env.RECORDING_UI_BASE_URL || "http://localhost:3000";
  const envFile = path.resolve(process.cwd(), argValue("--env-file") || process.env.RECORDING_UI_ENV_FILE || ".env.local");
  const keepArtifacts = hasFlag("--keep-artifacts") || process.env.RECORDING_UI_KEEP_ARTIFACTS === "1";
  const skipNavigationDialog = hasFlag("--skip-navigation-dialog");
  const leaveSafetyOnly = hasFlag("--leave-safety-only");
  const outputPath = path.resolve(
    process.cwd(),
    argValue("--output") || process.env.RECORDING_UI_OUTPUT || `.tmp/recording-ui-${label}.json`
  );
  const fakeMp3Path = path.resolve(process.cwd(), ".tmp/prod-e2e-65s.mp3");
  const fakeWavPath = path.resolve(process.cwd(), ".tmp/recording-ui-125s.wav");
  await ensureFakeAudioFile(fakeWavPath, fakeMp3Path);

  const browser = await chromium.launch({
    headless: true,
    executablePath: detectBrowserExecutable(),
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${fakeWavPath}`,
    ],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ["microphone"],
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

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"]').fill("admin@demo.com");
    await page.locator('input[type="password"]').fill("demo123");
    await page.getByRole("button", { name: "ログイン" }).click();
    await waitForCondition(
      20_000,
      async () => page.url().includes("/app/"),
      "ログイン後にアプリ画面へ遷移しませんでした。"
    );

    const createStudentResponse = await context.request.post(`${baseUrl}/api/students`, {
      data: {
        name: `[${label}] 直接録音UI検証 ${new Date().toISOString().slice(11, 19)}`,
        grade: "検証用",
        course: "recording-ui",
      },
    });
    const createStudentBody = await createStudentResponse.json().catch(() => ({}));
    if (!createStudentResponse.ok || !createStudentBody?.student?.id) {
      throw new Error(`検証用生徒の作成に失敗しました: ${JSON.stringify(createStudentBody)}`);
    }
    studentId = String(createStudentBody.student.id);
    const studentName = String(createStudentBody.student.name);

    await page.goto(`${baseUrl}/app/students/${studentId}`, { waitUntil: "domcontentloaded" });
    await waitForCondition(
      20_000,
      async () => (await page.getAttribute("[data-recording-state]", "data-recording-state")) === "idle",
      "録音 UI が初期状態になりませんでした。"
    );

    const startButton = page.locator('[data-testid="recording-start-button"]');
    const clickStartedAt = Date.now();
    await startButton.click();

    await waitForCondition(
      5_000,
      async () => (await page.getAttribute("[data-recording-state]", "data-recording-state")) === "preparing",
      "録音準備状態へ遷移しませんでした。"
    );
    const startToPreparingMs = Date.now() - clickStartedAt;

    await waitForCondition(
      20_000,
      async () => (await page.getAttribute("[data-recording-state]", "data-recording-state")) === "recording",
      "録音開始まで進みませんでした。"
    );
    const startToRecordingMs = Date.now() - clickStartedAt;

    let navigationDialogMessage: string | null = null;
    if (!skipNavigationDialog) {
      await page.waitForTimeout(2_000);
      const dialogPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      const dialog = await dialogPromise;
      navigationDialogMessage = dialog.type() === "beforeunload" ? "beforeunload" : dialog.message();
      await dialog.dismiss();

      if (
        !page.url().includes(`/app/students/${studentId}`) ||
        (await page.getAttribute("[data-recording-state]", "data-recording-state")) !== "recording"
      ) {
        throw new Error("途中離脱ダイアログを閉じたのに生徒ページから離脱しました。");
      }
    }

    if (leaveSafetyOnly) {
      const result: RecordingUiResult = {
        label,
        baseUrl,
        studentId,
        startToPreparingMs,
        startToRecordingMs,
        recordToStopEnabledMs: null,
        stopToSuccessMs: null,
        totalMs: Date.now() - clickStartedAt,
        navigationDialogMessage,
        runpodStoppedAfterRun: true,
        nextMeetingMemoStatus: null,
        createdSessionId: null,
        createdConversationId: null,
        generatedLogPreview: null,
        observedStates: ["preparing", "recording"],
        consoleErrors,
      };
      console.log(JSON.stringify(result, null, 2));
      await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
      return;
    }

    const stopButton = page.locator('[data-testid="recording-stop-button"]');
    await waitForCondition(
      90_000,
      async () => !(await stopButton.isDisabled()),
      "録音終了ボタンが有効になる前にタイムアウトしました。"
    );
    const recordToStopEnabledMs = Date.now() - clickStartedAt;
    await stopButton.click();
    const stopClickedAt = Date.now();

    const observedStates = new Set<string>();
    await waitForCondition(
      8 * 60_000,
      async () => {
        const state = await page.getAttribute("[data-recording-state]", "data-recording-state");
        if (state) observedStates.add(state);
        const bodyText = (await page.textContent("body")) || "";
        if (bodyText.includes("処理に失敗しました")) {
          throw new Error(bodyText.slice(bodyText.indexOf("処理に失敗しました"), bodyText.indexOf("処理に失敗しました") + 240));
        }
        if (bodyText.includes("未送信の録音データがあります")) {
          throw new Error("処理中に未送信の録音データ警告が表示されました。");
        }
        return bodyText.includes("保存が完了しました");
      },
      "録音後の生成完了までタイムアウトしました。"
    );
    const stopToSuccessMs = Date.now() - stopClickedAt;
    const totalMs = Date.now() - clickStartedAt;

    const openLogButton = page.getByRole("button", { name: "ログを確認" });
    await openLogButton.click();
    await page.getByText("ログを確認する").waitFor({ timeout: 10_000 });
    const generatedLogPreview = ((await page.textContent("body")) || "").slice(0, 400);

    const artifacts = await waitForSessionArtifacts(context.request, baseUrl, studentId);
    const runpodStoppedAfterRun = await waitForRunpodStop(envFile);

    const result: RecordingUiResult = {
      label,
      baseUrl,
      studentId,
      startToPreparingMs,
      startToRecordingMs,
      recordToStopEnabledMs,
      stopToSuccessMs,
      totalMs,
      navigationDialogMessage,
      runpodStoppedAfterRun,
      nextMeetingMemoStatus: artifacts.nextMeetingMemoStatus,
      createdSessionId: artifacts.sessionId,
      createdConversationId: artifacts.conversationId,
      generatedLogPreview,
      observedStates: Array.from(observedStates),
      consoleErrors,
    };

    console.log(JSON.stringify(result, null, 2));
    await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (studentId && !keepArtifacts) {
      await cleanupStudentArtifacts(envFile, studentId).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
