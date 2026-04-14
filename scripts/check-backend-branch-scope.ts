import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type Violation = {
  path: string;
  reason: string;
};

const RELEVANT_BRANCH_PATTERN = /(^|[\/-])(backend|perf|performance|infra|runpod|worker|jobs|hardening|guardrails)([\/-]|$)/i;
const UI_BYPASS_ENV = "ALLOW_UI_CHANGES";
const EMPTY_TREE_SHA = execFileSync("git", ["hash-object", "-t", "tree", "/dev/null"], { encoding: "utf8" }).trim();
const UI_STYLE_EXTENSION_PATTERN = /\.(css|scss|sass|less)$/i;
const UI_CONFIG_PATTERN = /(^|\/)(tailwind|postcss)\.config\.(js|cjs|mjs|ts)$/i;

export function envValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
}

export function normalizePath(filePath: string) {
  return filePath.replaceAll("\\", "/");
}

export function isRelevantBranch(branchName: string) {
  return RELEVANT_BRANCH_PATTERN.test(branchName);
}

export function collectViolationReasons(filePath: string) {
  const reasons: string[] = [];

  if (filePath.startsWith("app/api/")) {
    return reasons;
  }

  if (filePath.startsWith("app/")) {
    reasons.push("app/** (excluding app/api/**)");
  }

  if (filePath.startsWith("components/")) {
    reasons.push("components/**");
  }

  if (filePath.startsWith("public/")) {
    reasons.push("public/**");
  }

  if (filePath.startsWith("styles/")) {
    reasons.push("styles/**");
  }

  if (UI_STYLE_EXTENSION_PATTERN.test(filePath)) {
    reasons.push("UI stylesheet (*.css, *.scss, *.sass, *.less)");
  }

  if (UI_CONFIG_PATTERN.test(filePath)) {
    reasons.push("tailwind/postcss config");
  }

  return reasons;
}

export function isUiFile(filePath: string) {
  return collectViolationReasons(filePath).length > 0;
}

export function diffRange(eventName: string, baseSha: string, headSha: string) {
  const safeBaseSha = baseSha && !/^0+$/.test(baseSha) ? baseSha : EMPTY_TREE_SHA;
  const safeHeadSha = headSha || "HEAD";

  if (eventName === "pull_request") {
    return [safeBaseSha, safeHeadSha, "..."] as const;
  }

  return [safeBaseSha, safeHeadSha, ".."] as const;
}

export function listChangedFiles(eventName: string, baseSha: string, headSha: string) {
  const [safeBaseSha, safeHeadSha, operator] = diffRange(eventName, baseSha, headSha);
  const args = ["diff", "--name-only", `${safeBaseSha}${operator}${safeHeadSha}`];
  const output = execFileSync("git", args, { encoding: "utf8" }).trim();

  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map(normalizePath)
    .filter((filePath) => filePath.length > 0);
}

export function collectViolations(changedFiles: string[]) {
  return changedFiles
    .map((path): Violation => {
      const reasons = collectViolationReasons(path);

      return {
        path,
        reason: reasons.join(", "),
      };
    })
    .filter((violation) => violation.reason.length > 0);
}

function printViolations(violations: Violation[], branchName: string, eventName: string, baseSha: string, headSha: string) {
  console.error(`[backend-scope-guard] blocked branch scope on ${eventName}: ${branchName}`);
  console.error(`[backend-scope-guard] checked diff: ${baseSha || "unknown"} -> ${headSha || "unknown"}`);
  console.error("[backend-scope-guard] backend/perf style branches must not touch UI files:");

  for (const violation of violations) {
    console.error(`- ${violation.path} | matched ${violation.reason}`);
  }

  console.error("");
  console.error(
    "[backend-scope-guard] allowed areas for these branches: app/api/**, lib/**, scripts/**, prisma/**, .github/**, docs/**"
  );
  console.error(`[backend-scope-guard] intentional bypass: set ${UI_BYPASS_ENV}=1 and rerun the workflow.`);
}

export async function main() {
  const eventName = envValue("BACKEND_SCOPE_GUARD_EVENT", "GITHUB_EVENT_NAME") || "push";
  const branchName = envValue("BACKEND_SCOPE_GUARD_BRANCH", "GITHUB_HEAD_REF", "GITHUB_REF_NAME");
  const baseSha = envValue("BACKEND_SCOPE_GUARD_BASE_SHA", "GITHUB_EVENT_BEFORE");
  const headSha = envValue("BACKEND_SCOPE_GUARD_HEAD_SHA", "GITHUB_SHA");

  if (!branchName) {
    console.log("[backend-scope-guard] no branch name available; skipping.");
    return;
  }

  if (!isRelevantBranch(branchName)) {
    console.log(`[backend-scope-guard] branch '${branchName}' is outside backend/perf scope; skipping.`);
    return;
  }

  const changedFiles = listChangedFiles(eventName, baseSha, headSha);
  const violations = collectViolations(changedFiles);
  const bypassEnabled = process.env[UI_BYPASS_ENV]?.trim() === "1";

  console.log(`[backend-scope-guard] branch '${branchName}' is in backend/perf scope.`);
  console.log(`[backend-scope-guard] changed files: ${changedFiles.length}`);

  if (changedFiles.length === 0) {
    console.log("[backend-scope-guard] no changed files detected; passing.");
    return;
  }

  if (bypassEnabled) {
    if (violations.length > 0) {
      console.warn(`[backend-scope-guard] ${UI_BYPASS_ENV}=1 set; bypassing the guard for these UI changes.`);
      for (const violation of violations) {
        console.warn(`- ${violation.path} | matched ${violation.reason}`);
      }
    } else {
      console.log(`[backend-scope-guard] ${UI_BYPASS_ENV}=1 set; no UI violations detected.`);
    }
    return;
  }

  if (violations.length > 0) {
    printViolations(violations, branchName, eventName, baseSha, headSha);
    process.exitCode = 1;
    return;
  }

  console.log("[backend-scope-guard] no UI files changed; passing.");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error("[backend-scope-guard] fatal error", error);
    process.exitCode = 1;
  });
}
