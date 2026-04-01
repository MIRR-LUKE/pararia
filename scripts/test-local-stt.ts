import assert from "node:assert/strict";
import path from "node:path";

process.env.FASTER_WHISPER_WORKER_COMMAND = process.execPath;
process.env.FASTER_WHISPER_WORKER_ARGS_JSON = JSON.stringify([
  path.join(process.cwd(), "scripts", "mock-faster-whisper-worker.mjs"),
]);
process.env.FASTER_WHISPER_MODEL = "large-v3";

async function main() {
  const { stopLocalSttWorker, transcribeAudioForPipeline } = await import("../lib/ai/stt");

  try {
    const result = await transcribeAudioForPipeline({
      buffer: Buffer.from("fake-audio-buffer"),
      filename: "sample.m4a",
      mimeType: "audio/mp4",
      language: "ja",
    });

    assert.match(result.rawTextOriginal, /英語長文/);
    assert.equal(result.meta.model, "faster-whisper:large-v3");
    assert.equal(result.meta.responseFormat, "segments_json");
    assert.equal(result.meta.fallbackUsed, false);
    assert.equal(result.meta.recoveryUsed, false);
    assert.equal(result.meta.attemptCount, 1);
    assert.equal(result.meta.segmentCount, 2);
    assert.equal(result.meta.speakerCount, 0);
    assert.deepEqual(result.meta.qualityWarnings, []);
    assert.equal(result.segments.length, 2);
    assert.match(String(result.segments[0]?.text ?? ""), /英語長文/);

    console.log("local faster-whisper bridge regression check passed");
  } finally {
    stopLocalSttWorker();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
