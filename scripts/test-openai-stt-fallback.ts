import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
const originalBackgroundMode = process.env.PARARIA_BACKGROUND_MODE;
const originalRunpodPodId = process.env.RUNPOD_POD_ID;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_STT_MODEL;

async function main() {
  process.env.PARARIA_BACKGROUND_MODE = "external";
  delete process.env.RUNPOD_POD_ID;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_STT_MODEL = "gpt-4o-transcribe";

  const { buildOpenAiChunkSeconds } = await import("../lib/ai/stt/openai");
  assert.equal(buildOpenAiChunkSeconds(0, 120), 0);
  assert.equal(buildOpenAiChunkSeconds(10 * 1024 * 1024, 600), 1320);
  assert.ok(
    buildOpenAiChunkSeconds(58_708_813, 3570.021333333333) <= 1320,
    "OpenAI chunk duration should stay within the API-safe cap"
  );

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(init?.method, "POST");
    assert.match(String(init?.headers && (init.headers as Record<string, string>).Authorization), /^Bearer sk-test$/);
    return new Response(JSON.stringify({ text: "今日は英語長文と数学を振り返りました。" }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  const { transcribeAudioForPipeline } = await import("../lib/ai/stt");
  const result = await transcribeAudioForPipeline({
    buffer: Buffer.from("fake-audio-buffer"),
    filename: "sample.webm",
    mimeType: "audio/webm",
    language: "ja",
  });

  assert.match(result.rawTextOriginal, /英語長文/);
  assert.equal(result.meta.model, "openai:gpt-4o-transcribe");
  assert.equal(result.meta.responseFormat, "json");
  assert.equal(result.meta.fallbackUsed, true);
  assert.equal(result.meta.device, "openai");
  assert.equal(result.meta.pipeline, "openai-api");
  assert.deepEqual(result.segments, []);

  console.log("openai STT fallback regression check passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
    if (originalBackgroundMode === undefined) {
      delete process.env.PARARIA_BACKGROUND_MODE;
    } else {
      process.env.PARARIA_BACKGROUND_MODE = originalBackgroundMode;
    }
    if (originalRunpodPodId === undefined) {
      delete process.env.RUNPOD_POD_ID;
    } else {
      process.env.RUNPOD_POD_ID = originalRunpodPodId;
    }
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
    if (originalModel === undefined) {
      delete process.env.OPENAI_STT_MODEL;
    } else {
      process.env.OPENAI_STT_MODEL = originalModel;
    }
  });
