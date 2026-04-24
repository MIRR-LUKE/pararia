import assert from "node:assert/strict";

const originalBackgroundMode = process.env.PARARIA_BACKGROUND_MODE;
const originalRunpodPodId = process.env.RUNPOD_POD_ID;
const originalProvider = process.env.PARARIA_STT_PROVIDER;

async function main() {
  const { transcribeAudioForPipeline } = await import("../lib/ai/stt");

  process.env.PARARIA_BACKGROUND_MODE = "external";
  delete process.env.RUNPOD_POD_ID;
  delete process.env.PARARIA_STT_PROVIDER;

  await assert.rejects(
    () =>
      transcribeAudioForPipeline({
        buffer: Buffer.from("fake-audio-buffer"),
        filename: "sample.webm",
        mimeType: "audio/webm",
        language: "ja",
      }),
    /Runpod STT worker is temporarily unavailable/,
    "external mode on the app must not transcribe audio inline"
  );

  process.env.PARARIA_STT_PROVIDER = "openai";
  await assert.rejects(
    () =>
      transcribeAudioForPipeline({
        buffer: Buffer.from("fake-audio-buffer"),
        filename: "sample.webm",
        mimeType: "audio/webm",
        language: "ja",
      }),
    /STT は Runpod \/ faster-whisper only です/,
    "OpenAI STT provider selection should be rejected"
  );

  console.log("runpod-only STT contract regression check passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
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
    if (originalProvider === undefined) {
      delete process.env.PARARIA_STT_PROVIDER;
    } else {
      process.env.PARARIA_STT_PROVIDER = originalProvider;
    }
  });
