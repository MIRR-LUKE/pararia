import assert from "node:assert/strict";

async function main() {
  const [{ buildInterviewDraftFallbackMarkdown }, { buildDraftInputBlock, estimateTokens }, { isWeakDraftMarkdown }, { buildInterviewMarkdownUserPromptBundle }, { buildInterviewMarkdownSystemPrompt }] =
    await Promise.all([
      import("../lib/ai/conversation/fallback"),
      import("../lib/ai/conversation/shared"),
      import("../lib/ai/conversation/normalize"),
      import("../lib/ai/conversation/generate/prompt"),
      import("../lib/ai/conversation/spec"),
    ]);

  const weakInterviewDraft = [
    "■ 基本情報",
    "対象生徒: 山田花子 様",
    "面談日: 2026-03-25",
    "面談時間: 52分",
    "担当チューター: 佐藤先生",
    "テーマ: 学習状況の確認と次回方針の整理",
    "",
    "■ 1. サマリー",
    "講師: 最近の英語の音読はどうですか？",
    "",
    "■ 2. 学習状況と課題分析",
    "- 講師: 最近の英語の音読はどうですか？",
    "",
    "■ 3. 今後の対策・指導内容",
    "- 生徒: 前より読みやすいです。",
    "",
    "■ 4. 志望校に関する検討事項",
    "- 今回の面談では、志望校や進路の具体的な話はしていませんでした。",
    "",
    "■ 5. 次回のお勧め話題",
    "- 今回の面談では、次回に向けた具体的な確認項目までは話していませんでした。",
  ].join("\n");

  const interviewTranscript = [
    "講師: 最近の英語の音読はどうですか？",
    "生徒: 前より読みやすいです。でも寝る時間が遅い日は集中が落ちます。",
    "講師: 宿題の入り方は変わりましたか？",
    "生徒: 寝る前にスマホを早めに切った日は、宿題の読み直しが短くなります。",
  ].join("\n");

  assert.equal(isWeakDraftMarkdown(weakInterviewDraft, "INTERVIEW", 700, interviewTranscript), true);

  const interviewFallback = buildInterviewDraftFallbackMarkdown({
    transcript: interviewTranscript,
    studentName: "山田花子",
    teacherName: "佐藤先生",
    sessionDate: "2026-03-25",
    durationMinutes: 52,
  });
  assert.match(interviewFallback, /睡眠|英語|宿題/);
  assert.doesNotMatch(interviewFallback, /会話をそのまま/);
  assert.doesNotMatch(interviewFallback, /根拠:/);
  assert.match(interviewFallback, /面談時間: 52分/);
  assert.match(interviewFallback, /■ 2\. 学習状況と課題分析/);
  assert.match(interviewFallback, /■ 3\. 今後の対策・指導内容/);
  assert.match(interviewFallback, /■ 4\. 志望校に関する検討事項/);
  assert.match(interviewFallback, /■ 5\. 次回のお勧め話題/);

  const longInterviewTranscript = Array.from(
    { length: 80 },
    (_, index) => `講師: 志望校の話題 ${index + 1} と時間配分の確認をした。`
  ).join("\n");
  const interviewInput = buildDraftInputBlock("INTERVIEW", longInterviewTranscript);
  assert.match(interviewInput.label, /抽出済み重要発話 \+ 文字起こし全文/);
  assert.match(interviewInput.content, /文字起こし全文/);

  const interviewPromptInput = buildDraftInputBlock("INTERVIEW", interviewTranscript);
  const interviewPromptA = buildInterviewMarkdownUserPromptBundle(
    {
      transcript: interviewTranscript,
      studentName: "山田花子",
      teacherName: "佐藤先生",
      sessionDate: "2026-03-25",
      durationMinutes: 52,
      minSummaryChars: 700,
      sessionType: "INTERVIEW",
    },
    interviewPromptInput
  );
  const interviewPromptB = buildInterviewMarkdownUserPromptBundle(
    {
      transcript: interviewTranscript,
      studentName: "鈴木太郎",
      teacherName: "別の先生",
      sessionDate: "2026-04-01",
      durationMinutes: 48,
      minSummaryChars: 700,
      sessionType: "INTERVIEW",
    },
    interviewPromptInput
  );
  assert.equal(interviewPromptA.cacheStablePrefix, interviewPromptB.cacheStablePrefix);
  assert.ok(interviewPromptA.userPrompt.indexOf("入力メタデータ:") > interviewPromptA.userPrompt.indexOf("固定仕様:"));
  assert.doesNotMatch(interviewPromptA.cacheStablePrefix, /山田花子|佐藤先生|2026-03-25|52分/);
  assert.ok(
    estimateTokens(`${buildInterviewMarkdownSystemPrompt()}\n${interviewPromptA.cacheStablePrefix}`) >= 1024,
    "interview prompt should keep at least ~1024 tokens of stable prefix before variable metadata"
  );

  console.log("conversation draft quality regression check passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
