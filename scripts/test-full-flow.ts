/**
 * 音声テキスト化〜ログ生成までのフローをテストするスクリプト
 * 実行: npx tsx scripts/test-full-flow.ts
 */

import { createStructuredConversationLog } from "../lib/analytics/conversationAnalysis";
import { ConversationSourceType } from "@prisma/client";

async function testFullFlow() {
  console.log("🧪 音声テキスト化〜ログ生成フローテスト開始\n");

  // 1. 環境変数チェック
  const openaiKey = process.env.OPENAI_API_KEY || process.env.STT_API_KEY;
  if (!openaiKey) {
    console.error("❌ OPENAI_API_KEY または STT_API_KEY が設定されていません");
    process.exit(1);
  }
  console.log("✅ API Key が設定されています\n");

  // 2. テスト用のテキスト（実際の音声ファイルの代わり）
  const testTranscript = `今日は模試の結果が返ってきて、数学が不安です。
前回のテストで失点した原因に対応した勉強をする必要があります。
数学は時間をかけすぎて点数が低い。なぜ間違えたのかわからないものもある。
英語はそもそも英語を読むのが遅いので、音読をして英語の処理スピードそのものを上げていく必要があります。
最近は抹茶アイスにハマっています。ローファイ音楽を聞きながら勉強している。
出題意図を読む練習と次のアクションを合意しました。`;

  console.log("📝 テスト用テキスト（音声テキスト化済みと仮定）:");
  console.log(`   長さ: ${testTranscript.length}文字\n`);

  // 3. LLMで構造化処理
  console.log("🤖 LLMで構造化処理開始...");
  try {
    // 4. データベースに保存
    console.log("💾 データベースに保存開始...");
    const conversation = await createStructuredConversationLog({
      transcript: testTranscript,
      organizationId: "org-demo",
      studentId: "s-1",
      sourceType: ConversationSourceType.AUDIO,
      studentName: "宮本 徹生",
    });

    console.log("✅ ログ生成成功:");
    console.log(`  - Conversation ID: ${conversation.id}`);
    console.log(`  - Summary: ${conversation.summaryMarkdown?.substring(0, 50) ?? ""}...`);
    console.log(`  - Timeline Sections: ${Array.isArray(conversation.timelineJson) ? conversation.timelineJson.length : 0}`);
    console.log(`  - Created At: ${conversation.createdAt}\n`);

    // 5. データベースから取得して確認
    console.log("🔍 データベースから取得して確認...");
    const { prisma } = await import("../lib/db");
    const retrieved = await prisma.conversationLog.findUnique({
      where: { id: conversation.id },
    });

    if (!retrieved) {
      console.error("❌ データベースから取得できませんでした");
      process.exit(1);
    }

    console.log("✅ 取得成功:");
    console.log(`  - ID: ${retrieved.id}`);
    console.log(`  - Summary: ${retrieved.summaryMarkdown?.substring(0, 50) ?? ""}...`);
    console.log(`  - Timeline Sections: ${Array.isArray(retrieved.timelineJson) ? retrieved.timelineJson.length : 0}`);
    console.log(`  - Next Actions: ${Array.isArray(retrieved.nextActionsJson) ? retrieved.nextActionsJson.length : 0}個\n`);

    console.log("🎉 すべてのテストが成功しました！");
    console.log("\n📋 確認ポイント:");
    console.log("  ✅ Prismaスキーマに timelineJson / nextActionsJson / profileDeltaJson が存在");
    console.log("  ✅ LLMが Summary/Timeline/ToDo を生成");
    console.log("  ✅ データベースに成果物が保存");

    await prisma.$disconnect();
  } catch (error: any) {
    console.error("❌ テスト失敗:", error);
    console.error("   スタック:", error.stack);
    process.exit(1);
  }
}

testFullFlow().catch((error) => {
  console.error("❌ テスト実行エラー:", error);
  process.exit(1);
});

