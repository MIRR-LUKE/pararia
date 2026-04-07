import assert from "node:assert/strict";

process.env.LLM_API_KEY ??= "test-key";
process.env.OPENAI_API_KEY ??= process.env.LLM_API_KEY;

const originalFetch = globalThis.fetch;

async function main() {
  const [
    { parseStructuredMarkdown },
    { normalizeTranscriptKanji },
    {
      buildDraftRetrySystemPrompt,
      buildDraftSystemPrompt,
      buildInterviewMarkdownRetrySystemPrompt,
      buildInterviewMarkdownSystemPrompt,
    },
    { generateConversationDraftFast },
  ] =
    await Promise.all([
      import("../components/ui/structuredMarkdownParser"),
      import("../lib/ai/llm"),
      import("../lib/ai/conversation/spec"),
      import("../lib/ai/conversation/generate"),
    ]);

  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return new Response(JSON.stringify({ error: { message: "rate limit" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: "今日は数学をやる。" },
            finish_reason: "stop",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }) as typeof fetch;

  const normalized = await normalizeTranscriptKanji("きょうは すうがく を やる");
  assert.equal(normalized, "今日は数学をやる。");
  assert.equal(fetchCalls, 2);

  const basePrompt = buildDraftSystemPrompt("INTERVIEW");
  const retryPrompt = buildDraftRetrySystemPrompt("INTERVIEW");
  assert.match(basePrompt, /transcript にない事実は足さない。/);
  assert.match(basePrompt, /長い逐語転写を貼らない。/);
  assert.match(retryPrompt, /根拠がある項目だけを残す。/);
  assert.match(retryPrompt, /fallback でも意味を盛らない。/);
  assert.match(retryPrompt, /観察 \/ 推測 \/ 不足 と 判断 \/ 次回確認 の分離を崩さない。/);
  assert.match(retryPrompt, /長い transcript の丸貼りにしない。/);
  assert.doesNotMatch(retryPrompt, /すべて教務文体へ言い換える/);
  assert.doesNotMatch(retryPrompt, /口語の引用や断片文を絶対に残さず/);

  const interviewPrompt = buildInterviewMarkdownSystemPrompt();
  const interviewRetryPrompt = buildInterviewMarkdownRetrySystemPrompt();
  assert.match(interviewPrompt, /markdown 本文のみ/);
  assert.match(interviewPrompt, /■ 5\. 次回のお勧め話題/);
  assert.match(interviewPrompt, /根拠:.*出さない/);
  assert.match(interviewRetryPrompt, /markdown 本文だけを返す。JSON は返さない/);

  const sample = [
    "■ 基本情報",
    "対象生徒: 山田 太郎 様",
    "面談日: 2026年3月25日",
    "",
    "## 面談",
    "**講師**: 長文は前より止まりにくくなったね。",
    "**生徒**: 前より読みやすいです。",
    "",
    "■ 2. ポジティブな話題",
    "• 英語は音読を続けた日に読み直しが減っている。",
    "現状（Before）: 設問だけを追うと根拠位置が曖昧だった。",
  ].join("\n");

  const blocks = parseStructuredMarkdown(sample);
  assert.ok(blocks.some((block) => block.type === "heading" && block.text.includes("基本情報")));
  assert.ok(
    blocks.some(
      (block) => block.type === "meta" && block.items.some((item) => item.label === "対象生徒" && item.value.includes("山田"))
    )
  );
  assert.ok(blocks.some((block) => block.type === "dialogue" && block.speaker === "講師"));
  assert.ok(blocks.some((block) => block.type === "dialogue" && block.speaker === "生徒"));
  assert.ok(blocks.some((block) => block.type === "list" && block.items.some((item) => item.includes("音読"))));
  assert.ok(
    blocks.some(
      (block) => block.type === "meta" && block.items.some((item) => item.label.includes("現状") && item.value.includes("曖昧"))
    )
  );

  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({
        output_text: [
          "■ 基本情報",
          "対象生徒: 山田 花子 様",
          "面談日: 2026年3月25日",
          "面談時間: 52分",
          "担当チューター: 佐藤先生",
          "テーマ: 学習状況の確認と次回方針の整理",
          "",
          "■ 1. サマリー",
          "今回は、英語の音読、睡眠、宿題の入り方を中心に面談した。",
          "",
          "音読は前より読みやすくなっている一方で、睡眠が遅い日は集中が落ちやすいことも確認した。",
          "",
          "■ 2. 学習状況と課題分析",
          "- 英語は音読を続けた日に読み直しが減っている。",
          "- 寝る時間が遅い日は集中が落ちやすい。",
          "",
          "■ 3. 今後の対策・指導内容",
          "- 寝る前のスマホを早めに切る流れを習慣化する。",
          "- 宿題は読み直し時間まで含めて短く終える設計にする。",
          "- 音読は集中しやすい時間帯に先に回す。",
          "",
          "■ 4. 志望校に関する検討事項",
          "今回の面談では、志望校や進路の具体的な話はしていませんでした。",
          "",
          "■ 5. 次回のお勧め話題",
          "- 睡眠が整った日の集中度を確認する。",
          "- 宿題の読み直し時間が短くなったかを確認する。",
        ].join("\n"),
        usage: {
          input_tokens: 1200,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 520,
          total_tokens: 1720,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }) as typeof fetch;

  const generated = await generateConversationDraftFast({
    transcript: [
      "講師: 最近の英語の音読はどうですか？",
      "生徒: 前より読みやすいです。でも寝る時間が遅い日は集中が落ちます。",
      "講師: 宿題の入り方は変わりましたか？",
      "生徒: 寝る前にスマホを早めに切った日は、宿題の読み直しが短くなります。",
    ].join("\n"),
    studentName: "山田 花子",
    teacherName: "佐藤先生",
    sessionDate: "2026-03-25",
    durationMinutes: 52,
    minSummaryChars: 420,
    sessionType: "INTERVIEW",
  });
  assert.equal(fetchCalls, 1);
  assert.equal(generated.apiCalls, 1);
  assert.equal(generated.usedFallback, false);
  assert.match(generated.summaryMarkdown, /■ 5\. 次回のお勧め話題/);
  assert.match(generated.summaryMarkdown, /睡眠が整った日の集中度/);
  assert.equal(generated.artifact.nextChecks.length >= 1, true);

  console.log("log render and llm retry smoke test passed");
  console.log(`fetch calls: ${fetchCalls}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
  });
