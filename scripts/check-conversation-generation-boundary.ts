#!/usr/bin/env tsx

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_ROOTS = ["app", "lib"];
const ALLOWED_MUTATION_FILES = new Set([
  "app/api/conversations/[id]/route-service.ts",
  "lib/jobs/conversation-jobs/handlers.ts",
  "lib/session-service.ts",
]);
const PROTECTED_FIELDS = ["artifactJson", "summaryMarkdown", "formattedTranscript"];
const EXTENSIONS = new Set([".ts", ".tsx"]);

function toRelativePath(filePath: string) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

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

function hasProtectedConversationMutation(source: string) {
  const mutationPattern =
    /\bconversationLog\.(?:create|update|updateMany)\s*\(\s*\{[\s\S]{0,4000}?data\s*:\s*\{[\s\S]{0,2500}?\b(?:artifactJson|summaryMarkdown|formattedTranscript)\s*:/g;
  return mutationPattern.test(source);
}

async function main() {
  const files = (
    await Promise.all(
      SCAN_ROOTS.map(async (scanRoot) => {
        const absoluteRoot = path.join(ROOT, scanRoot);
        return walk(absoluteRoot);
      })
    )
  ).flat();

  const offenders: string[] = [];

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");
    const relativePath = toRelativePath(filePath);
    if (!hasProtectedConversationMutation(source)) {
      continue;
    }
    if (!ALLOWED_MUTATION_FILES.has(relativePath)) {
      offenders.push(relativePath);
    }
  }

  console.log("Conversation generation boundary guard");
  console.log(`- scanned files: ${files.length}`);
  console.log(`- protected fields: ${PROTECTED_FIELDS.join(", ")}`);
  console.log(`- allowed writers: ${ALLOWED_MUTATION_FILES.size}`);

  if (offenders.length === 0) {
    console.log("- unauthorized writers: 0");
    console.log("conversation generation boundary guard passed");
    return;
  }

  console.error("- unauthorized writers:");
  for (const offender of offenders) {
    console.error(`  - ${offender}`);
  }
  console.error(
    "面談ログの正本フィールドを書き換えられる場所が増えています。許可済みの専用経路へ寄せるか、この guard を更新する前に責務を確認してください。"
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
