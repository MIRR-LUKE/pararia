import assert from "node:assert/strict";

process.env.OPENAI_API_KEY ??= "test-key";

const originalFetch = globalThis.fetch;

async function main() {
  const { transcribeAudioForPipeline } = await import("../lib/ai/stt");

  let fetchCalls = 0;
  const seenBodies: string[] = [];

  globalThis.fetch = (async (_input, init) => {
    fetchCalls += 1;
    const body = init?.body;
    if (!(body instanceof FormData)) {
      throw new Error("expected FormData body");
    }

    const model = String(body.get("model") ?? "");
    const responseFormat = String(body.get("response_format") ?? "");
    const chunkingStrategy = body.get("chunking_strategy");
    seenBodies.push(`${model}:${responseFormat}:${chunkingStrategy ?? "none"}`);

    if (fetchCalls === 1) {
      assert.equal(model, "gpt-4o-transcribe-diarize");
      assert.equal(responseFormat, "diarized_json");
      assert.equal(chunkingStrategy, "auto");
      return new Response(
        JSON.stringify({
          text: "",
          segments: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    assert.equal(model, "gpt-4o-transcribe");
    assert.equal(responseFormat, "json");
    assert.equal(chunkingStrategy, null);
    return new Response(
      JSON.stringify({
        text: "今日は英語長文の根拠確認が安定していた。",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }) as typeof fetch;

  const result = await transcribeAudioForPipeline({
    buffer: Buffer.from("test-audio"),
    filename: "sample.mp3",
    mimeType: "audio/mpeg",
    language: "ja",
  });

  assert.equal(fetchCalls, 2);
  assert.match(result.rawTextOriginal, /今日は英語長文の根拠確認が安定していた/);
  assert.equal(result.meta.model, "gpt-4o-transcribe");
  assert.equal(result.meta.responseFormat, "json");
  assert.equal(result.meta.fallbackUsed, true);
  assert.equal(result.meta.recoveryUsed, false);
  assert.equal(result.meta.attemptCount, 2);
  assert.deepEqual(result.segments, []);
  assert.deepEqual(seenBodies, [
    "gpt-4o-transcribe-diarize:diarized_json:auto",
    "gpt-4o-transcribe:json:none",
  ]);

  console.log("stt fallback regression check passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
  });
