#!/usr/bin/env tsx

import { runConversationEval } from "./lib/conversation-eval-core";
import { runScriptStep } from "./lib/script-step";

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  const outPath = argValue("--out");
  const { report, failed } = await runScriptStep("conversation-eval", "evaluate", () => runConversationEval(outPath));

  if (!outPath) {
    process.stdout.write(`${report}\n`);
  } else {
    console.log(`conversation eval report written to ${outPath}`);
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
