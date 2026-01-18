/**
 * Whisper API接続テストスクリプト
 * 実行: npx tsx scripts/test-whisper.ts
 */

import { transcribeAudio } from "../lib/ai/stt";
import { createStructuredConversationLog } from "../lib/analytics/conversationAnalysis";
import { ConversationSourceType } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

async function testWhisper() {
  console.log("🧪 Whisper API接続テスト開始\n");

  // 1. 環境変数チェック
  const apiKey = process.env.OPENAI_API_KEY || process.env.STT_API_KEY;
  if (!apiKey) {
    console.error("❌ OPENAI_API_KEY または STT_API_KEY が設定されていません");
    console.log("💡 .env.local に OPENAI_API_KEY を設定してください");
    process.exit(1);
  }
  console.log("✅ API Key が設定されています:", apiKey.substring(0, 10) + "...\n");

  // 2. テスト用の音声ファイルがあるか確認（オプション）
  // 実際の音声ファイルがない場合は、モックテストを実行
  console.log("📝 モック文字起こしテスト...");
  try {
    const mockTranscript = await transcribeAudio({
      buffer: Buffer.from("test"),
      filename: "test.webm",
      mimeType: "audio/webm",
      language: "ja",
    });
    console.log("✅ 文字起こし成功:", mockTranscript.substring(0, 100) + "...\n");
  } catch (error: any) {
    console.error("❌ 文字起こし失敗:", error.message);
    process.exit(1);
  }

  // 3. 構造化テスト
  console.log("📊 構造化テスト...");
  const testTranscript = "今日は模試の結果が返ってきて、数学が不安です。最近は抹茶アイスにハマっています。";
  try {
    const structured = await import("../lib/ai/llm").then(m => m.structureConversation(testTranscript));
    console.log("✅ 構造化成功:");
    console.log("  - Summary:", structured.summary.substring(0, 50) + "...");
    console.log("  - Key Quotes:", structured.keyQuotes.length, "件");
    console.log("  - Key Topics:", structured.keyTopics.join(", "));
    console.log("  - Next Actions:", structured.nextActions.length, "件\n");
  } catch (error: any) {
    console.error("❌ 構造化失敗:", error.message);
    process.exit(1);
  }

  // 4. ログ生成テスト（データベース接続が必要）
  console.log("💾 ログ生成テスト...");
  try {
    const conversation = await createStructuredConversationLog({
      transcript: testTranscript,
      organizationId: "org-demo",
      studentId: "s-1",
      sourceType: ConversationSourceType.AUDIO,
    });
    console.log("✅ ログ生成成功:");
    console.log("  - Conversation ID:", conversation.id);
    console.log("  - Summary:", conversation.summary.substring(0, 50) + "...");
    console.log("  - Created At:", conversation.createdAt);
    console.log("\n🎉 すべてのテストが成功しました！");
  } catch (error: any) {
    console.error("❌ ログ生成失敗:", error.message);
    console.error("   スタック:", error.stack);
    console.log("\n💡 データベース接続を確認してください");
    process.exit(1);
  }
}

testWhisper().catch((error) => {
  console.error("❌ テスト実行エラー:", error);
  process.exit(1);
});

