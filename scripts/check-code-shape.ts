import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type Rule = {
  name: string;
  match: (relativePath: string) => boolean;
  targetLines: number;
  hardLines: number;
};

type Exception = {
  hardLines: number;
  note: string;
};

type FileStat = {
  relativePath: string;
  lines: number;
  rule: Rule;
  targetOverBy: number;
  hardLimit: number;
  hardOverBy: number;
  exception?: Exception;
};

const ROOT = process.cwd();
const SCAN_ROOTS = ["app", "components", "lib", "scripts"];
const EXTENSIONS = new Set([".ts", ".tsx"]);

const RULES: Rule[] = [
  {
    name: "api-route",
    match: (relativePath) => relativePath.startsWith("app/api/") && relativePath.endsWith("/route.ts"),
    targetLines: 220,
    hardLines: 500,
  },
  {
    name: "client-page",
    match: (relativePath) =>
      relativePath.startsWith("app/") &&
      (relativePath.endsWith("PageClient.tsx") || relativePath.endsWith("Client.tsx")),
    targetLines: 320,
    hardLines: 700,
  },
  {
    name: "page-or-screen",
    match: (relativePath) =>
      relativePath.startsWith("app/") && (relativePath.endsWith("/page.tsx") || relativePath.endsWith("/loading.tsx")),
    targetLines: 180,
    hardLines: 420,
  },
  {
    name: "component",
    match: (relativePath) => relativePath.startsWith("components/") || relativePath.startsWith("app/"),
    targetLines: 260,
    hardLines: 700,
  },
  {
    name: "library",
    match: (relativePath) => relativePath.startsWith("lib/"),
    targetLines: 260,
    hardLines: 700,
  },
  {
    name: "script",
    match: (relativePath) => relativePath.startsWith("scripts/"),
    targetLines: 260,
    hardLines: 700,
  },
];

const EXCEPTIONS: Record<string, Exception> = {
  "app/app/students/[studentId]/StudentSessionConsole.tsx": {
    hardLines: 1700,
    note: "recording controller / upload / lock / progress polling を段階分割予定",
  },
  "lib/jobs/conversationJobs.ts": {
    hardLines: 1200,
    note: "job orchestration の責務整理を次フェーズで分割予定",
  },
  "lib/jobs/sessionPartJobs.ts": {
    hardLines: 1100,
    note: "session part pipeline を分割予定",
  },
  "lib/ai/conversation/generate.ts": {
    hardLines: 1000,
    note: "prompt / normalization / render の責務分離予定",
  },
  "scripts/runpod-measure-ux.ts": {
    hardLines: 950,
    note: "計測 CLI の整理対象",
  },
  "app/app/students/[studentId]/StudentDetailPageClient.tsx": {
    hardLines: 800,
    note: "screen orchestration / url sync / overlay state の分割対象",
  },
  "lib/runpod/worker-control.ts": {
    hardLines: 820,
    note: "Runpod API client と orchestration の分割対象",
  },
};

async function walk(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) {
      continue;
    }

    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(nextPath)));
      continue;
    }

    if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      files.push(nextPath);
    }
  }

  return files;
}

function toRelativePath(filePath: string) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function pickRule(relativePath: string) {
  return RULES.find((rule) => rule.match(relativePath)) ?? RULES[RULES.length - 1];
}

function countLines(source: string) {
  return source.split(/\r?\n/).length;
}

async function collectStats() {
  const files = (
    await Promise.all(
      SCAN_ROOTS.map(async (scanRoot) => {
        const absoluteRoot = path.join(ROOT, scanRoot);
        return walk(absoluteRoot);
      })
    )
  ).flat();

  const stats: FileStat[] = [];

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");
    const relativePath = toRelativePath(filePath);
    const rule = pickRule(relativePath);
    const exception = EXCEPTIONS[relativePath];
    const hardLimit = exception?.hardLines ?? rule.hardLines;
    const lines = countLines(source);
    stats.push({
      relativePath,
      lines,
      rule,
      targetOverBy: Math.max(0, lines - rule.targetLines),
      hardLimit,
      hardOverBy: Math.max(0, lines - hardLimit),
      exception,
    });
  }

  return stats.sort((left, right) => right.lines - left.lines);
}

async function main() {
  const stats = await collectStats();
  const overBudget = stats.filter((stat) => stat.targetOverBy > 0);
  const hardViolations = stats.filter((stat) => stat.hardOverBy > 0);

  console.log("Code shape summary");
  console.log(`- scanned files: ${stats.length}`);
  console.log(`- over target budget: ${overBudget.length}`);
  console.log(`- over hard limit: ${hardViolations.length}`);
  console.log("");

  if (overBudget.length > 0) {
    console.log("Top budget debt");
    for (const stat of overBudget.slice(0, 15)) {
      const suffix = stat.exception ? ` | legacy exception: ${stat.exception.note}` : "";
      console.log(
        `- ${stat.relativePath} | ${stat.lines} lines | target ${stat.rule.targetLines} | +${stat.targetOverBy}${suffix}`
      );
    }
    console.log("");
  }

  if (hardViolations.length > 0) {
    console.error("Hard limit violations");
    for (const stat of hardViolations) {
      console.error(
        `- ${stat.relativePath} | ${stat.lines} lines | hard ${stat.hardLimit} | +${stat.hardOverBy}`
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log("No hard limit violations.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
