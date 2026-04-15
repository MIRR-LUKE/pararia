import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import { execFileSync } from "node:child_process";

type Finding = {
  file: string;
  line: number;
  rule: string;
  match: string;
};

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".markdown",
  ".yml",
  ".yaml",
  ".sh",
  ".prisma",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".env",
  ".template",
  ".txt",
  ".toml",
  ".ini",
  ".csv",
  ".pem",
  ".key",
  ".crt",
  ".asc",
]);

const TEXT_FILENAMES = new Set([".nvmrc", "Dockerfile", "package-lock.json", "package.json", "vercel.json"]);

const SECRET_PATTERNS: Array<{ rule: string; regex: RegExp }> = [
  {
    rule: "OpenAI / secret key",
    regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    rule: "GitHub token",
    regex: /\b(?:ghp|gho|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    rule: "Vercel token",
    regex: /\bvercel_[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    rule: "Slack token",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    rule: "Private key block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
];

function shouldScan(filePath: string) {
  const base = basename(filePath);
  if (TEXT_FILENAMES.has(base)) {
    return true;
  }

  if (base.startsWith("Dockerfile")) {
    return true;
  }

  return TEXT_EXTENSIONS.has(extname(base).toLowerCase());
}

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output.split("\0").filter(Boolean);
}

async function scanFile(filePath: string) {
  const raw = await readFile(filePath, "utf8");
  if (raw.includes("\u0000")) return [] as Finding[];

  const findings: Finding[] = [];
  const lines = raw.replace(/\r/g, "").split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(line);
      if (!match) continue;
      findings.push({
        file: filePath,
        line: lineIndex + 1,
        rule: pattern.rule,
        match: match[0],
      });
    }
  }

  return findings;
}

async function main() {
  const files = listTrackedFiles().filter(shouldScan);
  const findings: Finding[] = [];

  for (const file of files) {
    try {
      findings.push(...(await scanFile(file)));
    } catch {
      // 文字として読めないファイルは静かに飛ばす
    }
  }

  if (findings.length > 0) {
    console.error("secret scan failed:");
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} [${finding.rule}] ${finding.match}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`secret scan passed: ${files.length} tracked text files checked, no findings.`);
}

main().catch((error) => {
  console.error("[scan-secrets] failed:", error);
  process.exitCode = 1;
});
