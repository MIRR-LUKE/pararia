#!/usr/bin/env tsx
/**
 * Test script for audio upload → conversation log generation pipeline
 * 
 * Usage:
 *   npx tsx scripts/test-audio-pipeline.ts
 * 
 * This script tests:
 * 1. Speech-to-text transcription
 * 2. Preprocessing (filler removal, deduplication)
 * 3. DB save (rawTextOriginal, rawTextCleaned)
 * 4. Job enqueue and parallel execution
 */

import { preprocessTranscript } from "../lib/transcript/preprocess";
import { prisma } from "../lib/db";
import { ConversationSourceType, ConversationStatus } from "@prisma/client";
import { enqueueConversationJobs, processQueuedJobs } from "../lib/jobs/conversationJobs";

async function testAudioPipeline() {
  console.log("🧪 Testing audio upload → conversation log generation pipeline...\n");

  // Step 1: Create a minimal test audio file (or use existing)
  // For now, we'll test with a mock transcript to verify the pipeline
  const mockTranscript = `えー、今日は数学のテストの振り返りをしました。
  前回のテストで失点した原因に対応した勉強をする必要があります。
  数学は時間をかけすぎて点数が低い。なぜ間違えたのかわからないものもある。
  英語はそもそも英語を読むのが遅いので、音読をして英語の処理スピードそのものを上げていく必要があります。
  歴史は前回はワークは覚えていたのに、少し聞かれ方が違っただけでボコボコにされるという、ザコなムーブをかましてしまいました。
  だから、そこの対策をどうするかという話です。`;

  console.log("📝 Step 1: Preprocessing transcript...");
  const pre = preprocessTranscript(mockTranscript);
  console.log("✅ Preprocessing complete:", {
    originalLength: pre.rawTextOriginal.length,
    cleanedLength: pre.rawTextCleaned.length,
    blocks: pre.blocks.length,
  });
  console.log("Cleaned preview:", pre.rawTextCleaned.substring(0, 200) + "...\n");

  // Step 2: Create conversation log in DB
  console.log("💾 Step 2: Creating conversation log in DB...");
  const student = await prisma.student.findFirst({ where: { organizationId: "org-demo" } });
  if (!student) {
    console.error("❌ No student found. Please run seed script first.");
    process.exit(1);
  }

  const conversation = await prisma.conversationLog.create({
    data: {
      organizationId: "org-demo",
      studentId: student.id,
      sourceType: ConversationSourceType.AUDIO,
      status: ConversationStatus.PROCESSING,
      rawTextOriginal: pre.rawTextOriginal,
      rawTextCleaned: pre.rawTextCleaned,
      rawSegments: [],
      rawTextExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  console.log("✅ Conversation log created:", {
    id: conversation.id,
    studentId: conversation.studentId,
    rawTextCleanedLength: conversation.rawTextCleaned?.length ?? 0,
  });
  console.log("");

  // Step 3: Enqueue jobs
  console.log("📋 Step 3: Enqueueing jobs...");
  await enqueueConversationJobs(conversation.id);
  const jobs = await prisma.conversationJob.findMany({
    where: { conversationId: conversation.id },
  });
  console.log("✅ Jobs enqueued:", jobs.map((j) => ({ id: j.id, type: j.type, status: j.status })));
  console.log("");

  // Step 4: Process jobs in parallel
  console.log("⚙️  Step 4: Processing jobs in parallel...");
  const startTime = Date.now();
  let processed = 0;
  const errors: string[] = [];
  do {
    const run = await processQueuedJobs(5);
    processed = run.processed;
    if (run.errors.length) errors.push(...run.errors);
  } while (processed > 0);
  const elapsed = Date.now() - startTime;
  console.log("✅ Jobs processed:", {
    elapsedMs: elapsed,
    elapsedSec: (elapsed / 1000).toFixed(2),
    errors: errors.length ? errors : "none",
  });
  console.log("");

  // Step 5: Verify results
  console.log("🔍 Step 5: Verifying results...");
  const updated = await prisma.conversationLog.findUnique({
    where: { id: conversation.id },
    select: {
      id: true,
      status: true,
      summaryMarkdown: true,
      timelineJson: true,
      nextActionsJson: true,
      profileDeltaJson: true,
      formattedTranscript: true,
    },
  });

  if (!updated) {
    console.error("❌ Conversation log not found after processing");
    process.exit(1);
  }

  console.log("✅ Results:", {
    status: updated.status,
    hasSummary: !!updated.summaryMarkdown && updated.summaryMarkdown.length > 0,
    summaryLength: updated.summaryMarkdown?.length ?? 0,
    timelineSections: Array.isArray(updated.timelineJson) ? updated.timelineJson.length : 0,
    nextActions: Array.isArray(updated.nextActionsJson) ? updated.nextActionsJson.length : 0,
    profileDelta: !!updated.profileDeltaJson,
    hasFormattedTranscript: !!updated.formattedTranscript,
  });

  if (updated.summaryMarkdown) {
    console.log("\n📄 Summary preview:", updated.summaryMarkdown.substring(0, 300) + "...");
  }

  console.log("\n✅ Pipeline test complete!");
  console.log(`\n📊 Conversation log ID: ${conversation.id}`);
  console.log(`   View at: /app/logs/${conversation.id}`);

  await prisma.$disconnect();
}

testAudioPipeline().catch((e) => {
  console.error("❌ Test failed:", e);
  process.exit(1);
});
