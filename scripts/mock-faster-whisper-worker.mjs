import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  const payload = JSON.parse(trimmed);
  const response = {
    id: payload.id,
    ok: true,
    text: "今日は英語長文の根拠確認を進めた。\n次回までに音読を五回続ける。",
    segments: [
      {
        id: 0,
        start: 0.0,
        end: 1.6,
        text: "今日は英語長文の根拠確認を進めた。",
      },
      {
        id: 1,
        start: 1.7,
        end: 2.8,
        text: "次回までに音読を五回続ける。",
      },
    ],
    model: "large-v3",
    device: "cuda",
    compute_type: "int8_float16",
    pipeline: "batched",
    batch_size: 8,
    vad_parameters: {
      min_silence_duration_ms: 1000,
      speech_pad_ms: 400,
      threshold: 0.5,
    },
    transcribe_elapsed_ms: 1234,
  };
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
