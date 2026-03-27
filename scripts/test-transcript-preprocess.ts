import assert from "node:assert/strict";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "../lib/transcript/preprocess";

async function main() {
  const raw = "講師: えっと、今日は 英語長文 をやる。\n生徒: あの、根拠の位置で少し止まりました。";
  const pre = preprocessTranscript(raw);
  assert.equal(pre.rawTextOriginal, raw);
  assert.equal(pre.displayTranscript, pre.rawTextCleaned);
  assert.match(pre.displayTranscript, /今日は 英語長文 をやる/);
  assert.match(pre.displayTranscript, /根拠の位置で少し止まりました/);
  assert.doesNotMatch(pre.displayTranscript, /えっと/);
  assert.doesNotMatch(pre.displayTranscript, /あの/);
  assert.ok(pre.blocks.length >= 1);

  const withSegments = preprocessTranscriptWithSegments(raw, [
    { start: 0, end: 2, text: "講師: えっと、今日は 英語長文 をやる。" },
    { start: 2.5, end: 5, text: "生徒: あの、根拠の位置で少し止まりました。" },
  ]);
  assert.equal(withSegments.rawTextOriginal, raw);
  assert.equal(withSegments.displayTranscript, withSegments.rawTextCleaned);
  assert.ok(withSegments.blocks.length >= 1);

  console.log("transcript preprocess regression checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
