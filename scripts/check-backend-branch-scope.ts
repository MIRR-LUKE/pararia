import { execFileSync } from "node:child_process";

type Violation = {
  file: string;
  reason: string;
};

const BYPASS_VALUES = new Set(["1", "true", "TRUE", "yes", "YES"]);
const TARGET_BRANCH_SEGMENTS = ["backend", "perf", "performance", "infra", "runpod", "worker", "jobs", "hardening", "guardrails"];

function readCommand(command: string, args: string[]) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function getCurrentBranchName() {
  const explicit = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
  if (explicit) {
    return explicit.trim();
  }
  return readCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
}

function isTargetBranch(branchName: string) {
  const segments = branchName
    .split(/[\\/]/)
    .flatMap((segment) => segment.split("-"))
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

  return segments.some((segment) => TARGET_BRANCH_SEGMENTS.includes(segment));
}

function resolveBaseSha() {
  const explicit = process.env.BASE_SHA?.trim();
  if (explicit) {
    return explicit;
  }

  const baseRef = process.env.GITHUB_BASE_REF?.trim();
  if (baseRef) {
    try {
      return readCommand("git", ["merge-base", "HEAD", `origin/${baseRef}`]);
    } catch {
      return "";
    }
  }

  try {
    return readCommand("git", ["rev-parse", "HEAD~1"]);
  } catch {
    return "";
  }
}

function listChangedFiles(baseSha: string) {
  if (!baseSha) {
    return [] as string[];
  }

  const output = readCommand("git", ["diff", "--name-only", "--diff-filter=ACMR", baseSha, "HEAD"]);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter(Boolean);
}

function classifyViolation(file: string): Violation | null {
  if (file.startsWith("app/api/")) {
    return null;
  }
  if (file.startsWith("app/")) {
    return { file, reason: "app/** UI or route surface is blocked on backend-only branches" };
  }
  if (file.startsWith("components/")) {
    return { file, reason: "components/** is blocked on backend-only branches" };
  }
  if (file.endsWith(".module.css")) {
    return { file, reason: "*.module.css is blocked on backend-only branches" };
  }
  return null;
}

function main() {
  if (BYPASS_VALUES.has(process.env.ALLOW_UI_CHANGES ?? "")) {
    console.log("backend-scope-guard: skipped because ALLOW_UI_CHANGES is enabled");
    return;
  }

  const branchName = getCurrentBranchName();
  if (!isTargetBranch(branchName)) {
    console.log(`backend-scope-guard: skipped for non-target branch "${branchName}"`);
    return;
  }

  const baseSha = resolveBaseSha();
  if (!baseSha) {
    console.warn("backend-scope-guard: could not resolve BASE_SHA, skipping");
    return;
  }

  const changedFiles = listChangedFiles(baseSha);
  const violations = changedFiles
    .map((file) => classifyViolation(file))
    .filter((violation): violation is Violation => Boolean(violation));

  if (violations.length === 0) {
    console.log(`backend-scope-guard: ok for branch "${branchName}"`);
    return;
  }

  console.error(`backend-scope-guard: UI changes are blocked on backend-only branch "${branchName}"`);
  console.error("Set ALLOW_UI_CHANGES=1 only when the branch intentionally includes UI work.");
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.reason}`);
  }
  process.exitCode = 1;
}

main();
