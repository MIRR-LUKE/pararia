import { access, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright-core";
import { loadEnvFile } from "./load-env-file";
import { assertMeasurementStudent } from "./measurement-student-guard";
import { assertMutatingFixtureEnvironment } from "./environment-safety";

export type RecordingUiResult = {
  label: string;
  baseUrl: string;
  studentId: string;
  completionState: "leave-safety" | "success" | "rejected";
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

export function argValue(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

export function hasFlag(argv: string[], flag: string) {
  return argv.includes(flag);
}

export async function fileExists(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureFakeAudioFile(wavPath: string, mp3Path: string) {
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

function requireRecordingUiCredentials() {
  const email = process.env.CRITICAL_PATH_SMOKE_EMAIL?.trim() || "";
  const password = process.env.CRITICAL_PATH_SMOKE_PASSWORD?.trim() || "";
  if (!email || !password) {
    throw new Error(
      "録音UI検証のログイン情報が必要です。CRITICAL_PATH_SMOKE_EMAIL / CRITICAL_PATH_SMOKE_PASSWORD を設定してください。固定の demo ログインは廃止しました。"
    );
  }
  return { email, password };
}

export function detectBrowserExecutable() {
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

export async function withEnvFile<T>(envFile: string, work: () => Promise<T>) {
  const previous = { ...process.env };
  try {
    await loadEnvFile(envFile, { overrideExisting: true, optional: false });
    return await work();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

export async function waitForRunpodStop(envFile: string) {
  return withEnvFile(envFile, async () => {
    const { getManagedRunpodPods } = await import("../../lib/runpod/worker-control");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 180_000) {
      const pods = await getManagedRunpodPods().catch(() => []);
      const active = pods.filter(
        (pod: { desiredStatus?: string | null }) => !["EXITED", "TERMINATED"].includes(String(pod.desiredStatus || ""))
      );
      if (active.length === 0) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    return false;
  });
}

export async function cleanupRecordingArtifacts(envFile: string, studentId: string) {
  return withEnvFile(envFile, async () => {
    const [{ prisma }, { deleteStorageEntry }] = await Promise.all([
      import("../../lib/db"),
      import("../../lib/audio-storage"),
    ]);
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, grade: true, course: true },
    });
    assertMeasurementStudent(student, {
      namePrefix: "[",
      allowedGrades: ["検証用"],
      coursePrefixes: ["recording-ui"],
    });

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

export async function waitForCondition(
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

export async function waitForSessionArtifacts(
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

export type RunRecordingUiSmokeOptions = {
  label: string;
  baseUrl: string;
  envFile: string;
  keepArtifacts: boolean;
  skipNavigationDialog: boolean;
  leaveSafetyOnly: boolean;
  expectRejection: boolean;
  uploadFilePath: string | null;
  outputPath: string;
  fakeAudioPath: string;
};

export async function runRecordingUiSmoke(options: RunRecordingUiSmokeOptions) {
  await loadEnvFile(options.envFile, { overrideExisting: true, optional: true });
  assertMutatingFixtureEnvironment(options.baseUrl, options.label);
  const browser = await chromium.launch({
    headless: true,
    executablePath: detectBrowserExecutable(),
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${options.fakeAudioPath}`,
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
    const credentials = requireRecordingUiCredentials();
    await page.goto(`${options.baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"]').fill(credentials.email);
    await page.locator('input[type="password"]').fill(credentials.password);
    await page.getByRole("button", { name: "ログイン" }).click();
    await waitForCondition(
      20_000,
      async () => page.url().includes("/app/"),
      "ログイン後にアプリ画面へ遷移しませんでした。"
    );

    const createStudentResponse = await context.request.post(`${options.baseUrl}/api/students`, {
      data: {
        name: `[${options.label}] 直接録音UI検証 ${new Date().toISOString().slice(11, 19)}`,
        grade: "検証用",
        course: "recording-ui",
      },
    });
    const createStudentBody = await createStudentResponse.json().catch(() => ({}));
    if (!createStudentResponse.ok || !createStudentBody?.student?.id) {
      throw new Error(`検証用生徒の作成に失敗しました: ${JSON.stringify(createStudentBody)}`);
    }
    studentId = String(createStudentBody.student.id);

    await page.goto(`${options.baseUrl}/app/students/${studentId}`, { waitUntil: "domcontentloaded" });
    await waitForCondition(
      20_000,
      async () => (await page.getAttribute("[data-recording-state]", "data-recording-state")) === "idle",
      "録音 UI が初期状態になりませんでした。"
    );

    const clickStartedAt = Date.now();
    let startToPreparingMs = 0;
    let startToRecordingMs = 0;
    let recordToStopEnabledMs: number | null = null;

    if (options.uploadFilePath) {
      await page.locator('input[type="file"]').setInputFiles(options.uploadFilePath);
      await waitForCondition(
        10_000,
        async () => {
          const state = await page.getAttribute("[data-recording-state]", "data-recording-state");
          return state === "uploading" || state === "processing";
        },
        "ファイル選択後にアップロード処理へ進みませんでした。"
      );
    } else {
      const startButton = page.locator('[data-testid="recording-start-button"]');
      await startButton.click();

      await waitForCondition(
        5_000,
        async () => (await page.getAttribute("[data-recording-state]", "data-recording-state")) === "preparing",
        "録音準備状態へ遷移しませんでした。"
      );
      startToPreparingMs = Date.now() - clickStartedAt;

      await waitForCondition(
        20_000,
        async () => (await page.getAttribute("[data-recording-state]", "data-recording-state")) === "recording",
        "録音開始まで進みませんでした。"
      );
      startToRecordingMs = Date.now() - clickStartedAt;
    }

    let navigationDialogMessage: string | null = null;
    if (!options.skipNavigationDialog && !options.uploadFilePath) {
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

    if (options.leaveSafetyOnly) {
      const result: RecordingUiResult = {
        label: options.label,
        baseUrl: options.baseUrl,
        studentId,
        completionState: "leave-safety",
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
      await writeFile(options.outputPath, JSON.stringify(result, null, 2), "utf8");
      return result;
    }

    const stopClickedAt = Date.now();
    if (!options.uploadFilePath) {
      const stopButton = page.locator('[data-testid="recording-stop-button"]');
      await waitForCondition(
        90_000,
        async () => !(await stopButton.isDisabled()),
        "録音終了ボタンが有効になる前にタイムアウトしました。"
      );
      recordToStopEnabledMs = Date.now() - clickStartedAt;
      await stopButton.click();
    }

    const observedStates = new Set<string>();
    await waitForCondition(
      8 * 60_000,
      async () => {
        const state = await page.getAttribute("[data-recording-state]", "data-recording-state");
        if (state) observedStates.add(state);
        const bodyText = (await page.textContent("body")) || "";
        const rejectionDetected =
          bodyText.includes("文字起こしの結果、会話として十分な内容が認められませんでした") ||
          bodyText.includes("会話量が足りず停止しました");
        if (!options.expectRejection && bodyText.includes("処理に失敗しました")) {
          throw new Error(bodyText.slice(bodyText.indexOf("処理に失敗しました"), bodyText.indexOf("処理に失敗しました") + 240));
        }
        if (options.expectRejection && bodyText.includes("処理に失敗しました") && !rejectionDetected) {
          throw new Error(bodyText.slice(bodyText.indexOf("処理に失敗しました"), bodyText.indexOf("処理に失敗しました") + 240));
        }
        if (bodyText.includes("未送信の録音データがあります")) {
          throw new Error("処理中に未送信の録音データ警告が表示されました。");
        }
        return options.expectRejection ? rejectionDetected : bodyText.includes("保存が完了しました");
      },
      options.expectRejection ? "録音後の reject 表示までタイムアウトしました。" : "録音後の生成完了までタイムアウトしました。"
    );
    const stopToSuccessMs = Date.now() - stopClickedAt;
    const totalMs = Date.now() - clickStartedAt;

    const runpodStoppedAfterRun = await waitForRunpodStop(options.envFile);
    let generatedLogPreview: string | null = null;
    let artifacts: {
      sessionId: string;
      conversationId: string;
      nextMeetingMemoStatus: string | null;
    } | null = null;

    if (!options.expectRejection) {
      const openLogButton = page.getByRole("button", { name: "ログを確認" });
      await openLogButton.click();
      await page.getByText("ログを確認する").waitFor({ timeout: 10_000 });
      generatedLogPreview = ((await page.textContent("body")) || "").slice(0, 400);
      artifacts = await waitForSessionArtifacts(context.request, options.baseUrl, studentId);
    } else {
      generatedLogPreview = ((await page.textContent("body")) || "").slice(0, 400);
    }

    const result: RecordingUiResult = {
      label: options.label,
      baseUrl: options.baseUrl,
      studentId,
      completionState: options.expectRejection ? "rejected" : "success",
      startToPreparingMs,
      startToRecordingMs,
      recordToStopEnabledMs,
      stopToSuccessMs,
      totalMs,
      navigationDialogMessage,
      runpodStoppedAfterRun,
      nextMeetingMemoStatus: artifacts?.nextMeetingMemoStatus ?? null,
      createdSessionId: artifacts?.sessionId ?? null,
      createdConversationId: artifacts?.conversationId ?? null,
      generatedLogPreview,
      observedStates: Array.from(observedStates),
      consoleErrors,
    };

    await writeFile(options.outputPath, JSON.stringify(result, null, 2), "utf8");
    return result;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (studentId && !options.keepArtifacts) {
      await cleanupRecordingArtifacts(options.envFile, studentId).catch(() => {});
    }
  }
}
