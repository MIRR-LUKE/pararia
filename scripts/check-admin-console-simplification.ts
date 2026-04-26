#!/usr/bin/env tsx

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type Finding = {
  level: "error" | "warning";
  message: string;
};

const root = process.cwd();
const strict = process.argv.includes("--strict");
const findings: Finding[] = [];

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function add(level: Finding["level"], message: string) {
  findings.push({ level, message });
}

function expectFile(relativePath: string) {
  if (!existsSync(path.join(root, relativePath))) {
    add("error", `${relativePath} が見つかりません。`);
    return false;
  }
  return true;
}

function expectIncludes(relativePath: string, expected: string, message: string) {
  if (!expectFile(relativePath)) return;
  const content = read(relativePath);
  if (!content.includes(expected)) {
    add("error", `${relativePath}: ${message}`);
  }
}

function collectFiles(dir: string, extensions: string[]) {
  const absoluteDir = path.join(root, dir);
  if (!existsSync(absoluteDir)) return [];

  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const absolute = path.join(current, entry);
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        walk(absolute);
      } else if (extensions.some((extension) => absolute.endsWith(extension))) {
        files.push(path.relative(root, absolute).replace(/\\/g, "/"));
      }
    }
  };
  walk(absoluteDir);
  return files;
}

function scanAdminUi() {
  const adminFiles = collectFiles("app/admin", [".tsx", ".ts"]);
  if (adminFiles.length === 0) {
    add("warning", "app/admin が見つかりません。UI 実装前なら問題ありません。");
    return;
  }

  const combined = adminFiles.map((file) => read(file)).join("\n");
  const metricCardCount = (combined.match(/metricCard|<Card\b|StatusCard|DashboardCard/g) ?? []).length;
  const graphLikeCount = (combined.match(/<Line|<Bar|<Area|<Pie|Chart\b|recharts|visx|canvas/g) ?? []).length;
  const visibleWorkerTerms = (combined.match(/Runpod worker|worker image|worker未設定|STT_WORKER|RUNPOD_/g) ?? []).length;
  const promptCount = (combined.match(/window\.prompt|prompt\(/g) ?? []).length;

  if (metricCardCount > 4) {
    add("warning", `admin UI の主要カード候補が ${metricCardCount} 件あります。初期表示は 4 つ以内にしてください。`);
  }
  if (graphLikeCount > 1) {
    add("warning", `admin UI のグラフ候補が ${graphLikeCount} 件あります。初期表示は 1 つ以内にしてください。`);
  }
  if (visibleWorkerTerms > 0) {
    add(
      "warning",
      `admin UI に worker / RUNPOD / STT 系の内部語候補が ${visibleWorkerTerms} 件あります。初期表示では日本語の原因分類に隠してください。`
    );
  }
  if (promptCount > 0) {
    add(
      "warning",
      `admin UI に window.prompt 候補が ${promptCount} 件あります。危険操作は対象・影響範囲・理由を確認できる専用 UI にしてください。`
    );
  }
}

function scanSettingsBoundary() {
  const settingsFiles = collectFiles("app/app/settings", [".tsx", ".ts"]);
  if (settingsFiles.length === 0) return;

  const combined = settingsFiles.map((file) => read(file)).join("\n");
  const leakedOperationsTerms = [
    "SettingsOperationsSection",
    "/api/admin",
    "/api/operations/runpod",
    "/api/operations/jobs",
    "/api/jobs/run",
    "Runpod worker",
  ].filter((term) => combined.includes(term));

  if (leakedOperationsTerms.length > 0) {
    add(
      "error",
      `/app/settings に platform admin / operations 候補が残っています: ${leakedOperationsTerms.join(", ")}`
    );
  }
}

expectIncludes(
  "docs/admin-console-platform-spec.md",
  "admin-console-review-checklist.md",
  "実装後レビュー checklist への導線が必要です。"
);
expectIncludes(
  "docs/admin-console-review-checklist.md",
  "非エンジニア向け 5 タスク確認",
  "非エンジニア向け確認タスクを checklist に残してください。"
);
expectIncludes(
  "docs/issues/115-admin-usability-simplification-check.md",
  "scripts/check-admin-console-simplification.ts",
  "単体実行できる簡素化チェック script への導線が必要です。"
);
expectIncludes(
  "docs/security-control-matrix.md",
  "PlatformOperator",
  "platform admin の権限境界を security matrix に反映してください。"
);
expectIncludes(
  "docs/production-slo-runbooks.md",
  "Platform Admin",
  "platform admin の incident / runbook 観点を追加してください。"
);

scanSettingsBoundary();
scanAdminUi();

const errors = findings.filter((finding) => finding.level === "error");
const warnings = findings.filter((finding) => finding.level === "warning");
for (const finding of findings) {
  const prefix = finding.level === "error" ? "ERROR" : "WARN";
  console.log(`[admin-simplification] ${prefix}: ${finding.message}`);
}

if (warnings.length === 0 && errors.length === 0) {
  console.log("[admin-simplification] ok");
} else {
  console.log(`[admin-simplification] ${errors.length} error(s), ${warnings.length} warning(s)`);
}

if (errors.length > 0 || (strict && warnings.length > 0)) {
  process.exitCode = 1;
}
