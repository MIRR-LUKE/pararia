import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Check = {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const workflowPath = join(ROOT, ".github", "workflows", "android-internal-testing.yml");
const androidRoot = join(ROOT, "native", "android");
const docsPath = join(ROOT, "docs", "teacher-app-internal-testing.md");
const gitignorePath = join(ROOT, ".gitignore");

const checks: Check[] = [];

function add(name: string, status: Check["status"], detail: string) {
  checks.push({ name, status, detail });
}

function fileExists(path: string) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function nonEmptyFile(path: string) {
  try {
    return statSync(path).isFile() && statSync(path).size > 0;
  } catch {
    return false;
  }
}

function readText(path: string) {
  return readFileSync(path, "utf8");
}

function envPresent(name: string) {
  return (process.env[name] ?? "").trim().length > 0;
}

function commandCandidates(command: string) {
  const candidates = [command];
  const localAppData = process.env.LOCALAPPDATA;
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const javaHome = process.env.JAVA_HOME;

  if (command === "adb") {
    if (androidHome) {
      candidates.push(join(androidHome, "platform-tools", "adb.exe"));
      candidates.push(join(androidHome, "platform-tools", "adb"));
    }
    if (localAppData) {
      candidates.push(join(localAppData, "Android", "Sdk", "platform-tools", "adb.exe"));
    }
  }

  if (command === "keytool") {
    if (javaHome) {
      candidates.push(join(javaHome, "bin", "keytool.exe"));
      candidates.push(join(javaHome, "bin", "keytool"));
    }
    candidates.push(join("C:", "Program Files", "Android", "Android Studio", "jbr", "bin", "keytool.exe"));
  }

  return [...new Set(candidates)];
}

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });

  if (result.error) {
    return {
      ok: false,
      reason: result.error.message,
    };
  }

  return {
    ok: result.status === 0,
    reason: result.status === 0 ? "available" : `exit ${result.status}`,
  };
}

function commandAvailable(command: string, args: string[]) {
  const failures: string[] = [];

  for (const candidate of commandCandidates(command)) {
    if (candidate !== command && !fileExists(candidate)) {
      continue;
    }

    const result = runCommand(candidate, args);
    if (result.ok) {
      return {
        ok: true,
        reason: candidate === command ? "available" : `available at ${candidate}`,
      };
    }
    failures.push(`${candidate}: ${result.reason}`);
  }

  return {
    ok: false,
    reason: failures.length > 0 ? failures.join("; ") : "not found",
  };
}

function githubRegisteredNames(kind: "secret" | "variable") {
  const result = spawnSync("gh", [kind, "list"], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean)
  );
}

function checkWorkflow() {
  if (!fileExists(workflowPath)) {
    add("GitHub Actions workflow", "fail", ".github/workflows/android-internal-testing.yml がありません。");
    return;
  }

  const workflow = readText(workflowPath);
  const requiredSnippets = [
    "name: Android Device Handoff",
    "ANDROID_UPLOAD_KEYSTORE_BASE64",
    "ANDROID_UPLOAD_KEYSTORE_PASSWORD",
    "ANDROID_UPLOAD_KEY_ALIAS",
    "ANDROID_UPLOAD_KEY_PASSWORD",
    "PARARIA_ANDROID_BASE_URL",
    "chmod +x ./gradlew",
    "keytool -list",
    "apksigner",
    "sha256sum",
    "actions/upload-artifact",
  ];
  const missing = requiredSnippets.filter((snippet) => !workflow.includes(snippet));

  add(
    "GitHub Actions workflow",
    missing.length === 0 ? "pass" : "fail",
    missing.length === 0
      ? "Android Device Handoff workflow と signing / checksum / artifact 検査を確認しました。"
      : `workflow に必要な記述が足りません: ${missing.join(", ")}`
  );
}

function checkSigningEnvironment() {
  const requiredSecrets = [
    "ANDROID_UPLOAD_KEYSTORE_BASE64",
    "ANDROID_UPLOAD_KEYSTORE_PASSWORD",
    "ANDROID_UPLOAD_KEY_ALIAS",
    "ANDROID_UPLOAD_KEY_PASSWORD",
  ];
  const githubSecrets = githubRegisteredNames("secret");
  const missingLocal = requiredSecrets.filter((name) => !envPresent(name));
  const missingEverywhere = requiredSecrets.filter((name) => !envPresent(name) && !githubSecrets?.has(name));

  add(
    "Android signing secrets",
    missingEverywhere.length === 0 ? "pass" : "fail",
    missingLocal.length === 0
      ? "必要な signing secret 環境変数は存在します。値は出力していません。"
      : missingEverywhere.length === 0
        ? "GitHub Actions の signing secrets は登録済みです。値は出力していません。"
        : `未設定の signing secret: ${missingEverywhere.join(", ")}`
  );

  const base64 = process.env.ANDROID_UPLOAD_KEYSTORE_BASE64?.trim();
  if (base64) {
    try {
      const decoded = Buffer.from(base64, "base64");
      const normalized = decoded.toString("base64").replace(/=+$/, "");
      const input = base64.replace(/\s+/g, "").replace(/=+$/, "");
      add(
        "Keystore base64 shape",
        decoded.length > 0 && normalized === input ? "pass" : "fail",
        decoded.length > 0 && normalized === input
          ? "ANDROID_UPLOAD_KEYSTORE_BASE64 は base64 として読めます。内容は出力していません。"
          : "ANDROID_UPLOAD_KEYSTORE_BASE64 は base64 として復元できません。"
      );
    } catch {
      add("Keystore base64 shape", "fail", "ANDROID_UPLOAD_KEYSTORE_BASE64 は base64 として復元できません。");
    }
  } else {
    add(
      "Keystore base64 shape",
      "warn",
      githubSecrets?.has("ANDROID_UPLOAD_KEYSTORE_BASE64")
        ? "GitHub Secret 登録済みですが、値は読み出せないためローカル base64 形式チェックは未実行です。"
        : "secret 未設定のため base64 形式チェックは未実行です。"
    );
  }
}

function checkTools() {
  const keytool = commandAvailable("keytool", ["-help"]);
  add(
    "keytool",
    keytool.ok ? "pass" : "fail",
    keytool.ok ? `keytool を実行できます: ${keytool.reason}` : `keytool を実行できません: ${keytool.reason}`
  );

  const adb = commandAvailable("adb", ["version"]);
  add(
    "adb",
    adb.ok ? "pass" : "fail",
    adb.ok ? `adb を実行できます: ${adb.reason}` : `adb を実行できません: ${adb.reason}`
  );

  const gradlew = fileExists(join(androidRoot, "gradlew"));
  const gradlewBat = fileExists(join(androidRoot, "gradlew.bat"));
  const wrapperJar = nonEmptyFile(join(androidRoot, "gradle", "wrapper", "gradle-wrapper.jar"));
  const wrapperProperties = fileExists(join(androidRoot, "gradle", "wrapper", "gradle-wrapper.properties"));
  const ok = gradlew && gradlewBat && wrapperJar && wrapperProperties;

  add(
    "Gradle wrapper",
    ok ? "pass" : "fail",
    ok
      ? "native/android の Gradle wrapper 一式を確認しました。"
      : "native/android の gradlew / gradlew.bat / wrapper jar / wrapper properties のいずれかが不足しています。"
  );
}

function checkBaseUrl() {
  const defaultBaseUrl = "https://pararia.vercel.app";
  const baseUrl =
    process.env.PARARIA_ANDROID_BASE_URL?.trim() ||
    process.env.PARARIA_BASE_URL?.trim() ||
    defaultBaseUrl;
  const valid = /^https?:\/\/\S+$/.test(baseUrl) && !/["\\]/.test(baseUrl);

  add(
    "Android base URL",
    valid ? "pass" : "fail",
    valid
      ? `base URL 形式は有効です: ${baseUrl}`
      : "PARARIA_ANDROID_BASE_URL / PARARIA_BASE_URL は http:// または https:// で始まり、空白・引用符・バックスラッシュを含まない値にしてください。"
  );

  const gradlePropertiesPath = join(androidRoot, "gradle.properties");
  const hasDefault = fileExists(gradlePropertiesPath) && readText(gradlePropertiesPath).includes(`PARARIA_BASE_URL=${defaultBaseUrl}`);
  add(
    "Gradle base URL default",
    hasDefault ? "pass" : "fail",
    hasDefault ? "native/android/gradle.properties の既定 base URL を確認しました。" : "Gradle の既定 base URL が確認できません。"
  );
}

function checkDocsAndEvidence() {
  if (!fileExists(docsPath)) {
    add("Handoff docs", "fail", "docs/teacher-app-internal-testing.md がありません。");
    return;
  }

  const docs = readText(docsPath);
  const requiredDocs = [
    "npm run test:android-release-handoff-preflight",
    "APK SHA-256",
    "QA evidence",
    "adb install -r",
    "keytool",
    "ANDROID_UPLOAD_KEYSTORE_BASE64",
    "PARARIA_ANDROID_BASE_URL",
    "この端末で残る作業",
  ];
  const missing = requiredDocs.filter((snippet) => !docs.includes(snippet));

  add(
    "Handoff docs",
    missing.length === 0 ? "pass" : "fail",
    missing.length === 0
      ? "preflight 手順、checksum、QA evidence、残作業の記載を確認しました。"
      : `docs に必要な記述が足りません: ${missing.join(", ")}`
  );
}

function checkIgnoredSensitivePaths() {
  if (!fileExists(gitignorePath)) {
    add(".gitignore safety", "fail", ".gitignore がありません。");
    return;
  }

  const gitignore = readText(gitignorePath);
  const requiredIgnores = [".tmp/", "native/android/local.properties", "native/android/**/build/"];
  const missing = requiredIgnores.filter((entry) => !gitignore.includes(entry));

  add(
    ".gitignore safety",
    missing.length === 0 ? "pass" : "fail",
    missing.length === 0
      ? ".tmp/、native/android/local.properties、Android build outputs は ignore 済みです。"
      : `.gitignore に必要な ignore が足りません: ${missing.join(", ")}`
  );
}

function printResults() {
  console.log("Android release handoff preflight");
  for (const check of checks) {
    const label = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`[${label}] ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");
  console.log(`summary: ${checks.length - failed.length - warned.length} passed, ${warned.length} warned, ${failed.length} failed.`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

checkWorkflow();
checkSigningEnvironment();
checkTools();
checkBaseUrl();
checkDocsAndEvidence();
checkIgnoredSensitivePaths();
printResults();
