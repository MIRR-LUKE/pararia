import { prisma } from "../lib/db";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "../lib/transcript/preprocess";

function clampBatchSize(v: number) {
  if (!Number.isFinite(v)) return 2;
  return Math.max(1, Math.min(6, Math.floor(v)));
}

function oldCalls(blocks: number) {
  return blocks + 2; // analyze per block + reduce + finalize
}

function newCalls(blocks: number, batchSize: number) {
  const analyze = Math.ceil(blocks / batchSize);
  const reduce = blocks > 1 ? 1 : 0; // single-block reduce is reused
  return analyze + reduce + 1; // + finalize
}

async function main() {
  const batchSize = clampBatchSize(Number(process.env.ANALYZE_BATCH_SIZE ?? 2));
  const logs = await prisma.conversationLog.findMany({
    where: { rawTextOriginal: { not: null } },
    select: { id: true, rawTextOriginal: true, rawSegments: true, createdAt: true },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  let count = 0;
  let totalBlocks = 0;
  let totalOld = 0;
  let totalNew = 0;

  for (const log of logs) {
    const raw = (log.rawTextOriginal ?? "").trim();
    if (!raw) continue;
    const segments = Array.isArray(log.rawSegments) ? (log.rawSegments as any[]) : [];
    const pre = segments.length
      ? preprocessTranscriptWithSegments(raw, segments as any)
      : preprocessTranscript(raw);
    const blocks = pre.blocks.length;
    if (blocks < 1) continue;

    count += 1;
    totalBlocks += blocks;
    totalOld += oldCalls(blocks);
    totalNew += newCalls(blocks, batchSize);
  }

  const avgBlocks = count ? totalBlocks / count : 0;
  const avgOld = count ? totalOld / count : 0;
  const avgNew = count ? totalNew / count : 0;
  const reduction = avgOld ? ((avgOld - avgNew) / avgOld) * 100 : 0;

  console.log(
    JSON.stringify(
      {
        analyzedLogs: count,
        batchSize,
        avgBlocks: Number(avgBlocks.toFixed(2)),
        avgOldLlmCalls: Number(avgOld.toFixed(2)),
        avgNewLlmCalls: Number(avgNew.toFixed(2)),
        llmCallReductionPct: Number(reduction.toFixed(1)),
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
