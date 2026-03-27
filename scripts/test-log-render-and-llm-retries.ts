import assert from "node:assert/strict";

process.env.LLM_API_KEY ??= "test-key";
process.env.OPENAI_API_KEY ??= process.env.LLM_API_KEY;

const originalFetch = globalThis.fetch;

async function main() {
  const [{ parseStructuredMarkdown }, { normalizeTranscriptKanji }, { buildDraftRetrySystemPrompt, buildDraftSystemPrompt }] =
    await Promise.all([
    import("../components/ui/structuredMarkdownParser"),
    import("../lib/ai/llm"),
    import("../lib/ai/conversation/spec"),
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
  assert.match(retryPrompt, /根拠がある項目だけを残す。/);
  assert.match(retryPrompt, /fallback でも意味を盛らない。/);
  assert.match(retryPrompt, /観察 \/ 推測 \/ 不足 と 判断 \/ 次回確認 の分離を崩さない。/);
  assert.doesNotMatch(retryPrompt, /すべて教務文体へ言い換える/);
  assert.doesNotMatch(retryPrompt, /口語の引用や断片文を絶対に残さず/);

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
