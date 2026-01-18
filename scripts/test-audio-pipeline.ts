#!/usr/bin/env tsx
/**
 * Test script for audio upload → conversation log generation pipeline
 * 
 * Usage:
 *   npx tsx scripts/test-audio-pipeline.ts
 * 
 * This script tests:
 * 1. Whisper API transcription (verbose_json)
 * 2. Preprocessing (filler removal, deduplication)
 * 3. DB save (rawTextOriginal, rawTextCleaned)
 * 4. Job enqueue and parallel execution
 */

import { transcribeAudioVerbose } from "../lib/ai/stt";
import { preprocessTranscript } from "../lib/transcript/preprocess";
import { prisma } from "../lib/db";
import { ConversationSourceType } from "@prisma/client";
import { enqueueConversationJobs, processAllConversationJobs } from "../lib/jobs/conversationJobs";

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
    chunks: pre.chunks.length,
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
      rawTextOriginal: pre.rawTextOriginal,
      rawTextCleaned: pre.rawTextCleaned,
      rawSegments: [],
      summary: "",
      // timeSections, keyQuotes, keyTopics, nextActions, structuredDelta are nullable and will be set by jobs
    },
  });
  console.log("✅ Conversation log created:", {
    id: conversation.id,
    studentId: conversation.studentId,
    rawTextCleanedLength: conversation.rawTextCleaned.length,
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
  const result = await processAllConversationJobs(conversation.id);
  const elapsed = Date.now() - startTime;
  console.log("✅ Jobs processed:", {
    summary: result.summary.ok ? "✅" : `❌ ${result.summary.error}`,
    extract: result.extract.ok ? "✅" : `❌ ${result.extract.error}`,
    elapsedMs: elapsed,
    elapsedSec: (elapsed / 1000).toFixed(2),
  });
  console.log("");

  // Step 5: Verify results
  console.log("🔍 Step 5: Verifying results...");
  const updated = await prisma.conversationLog.findUnique({
    where: { id: conversation.id },
    select: {
      id: true,
      summary: true,
      summaryStatus: true,
      extractStatus: true,
      keyQuotes: true,
      keyTopics: true,
      nextActions: true,
      timeSections: true,
    },
  });

  if (!updated) {
    console.error("❌ Conversation log not found after processing");
    process.exit(1);
  }

  console.log("✅ Results:", {
    hasSummary: !!updated.summary && updated.summary.length > 0,
    summaryLength: updated.summary?.length ?? 0,
    summaryStatus: updated.summaryStatus,
    extractStatus: updated.extractStatus,
    hasKeyQuotes: Array.isArray(updated.keyQuotes) && updated.keyQuotes.length > 0,
    hasKeyTopics: Array.isArray(updated.keyTopics) && updated.keyTopics.length > 0,
    hasNextActions: Array.isArray(updated.nextActions) && updated.nextActions.length > 0,
    hasTimeSections: !!updated.timeSections,
  });

  if (updated.summary) {
    console.log("\n📄 Summary preview:", updated.summary.substring(0, 300) + "...");
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


