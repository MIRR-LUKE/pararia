import assert from "node:assert/strict";
import { buildCustomTranscriptionPlan, buildTranscriptionPlan } from "../lib/transcription-plan";

const currentInterview = buildTranscriptionPlan({
  sessionType: "INTERVIEW",
  durationSeconds: 3600,
});

assert.equal(currentInterview.shouldSplit, true);
assert.equal(currentInterview.chunkSeconds, 120);
assert.equal(currentInterview.chunkCount, 30);
assert.equal(currentInterview.requestWaves, 4);

const previousInterview = buildCustomTranscriptionPlan({
  sessionType: "INTERVIEW",
  durationSeconds: 3600,
  minSplitSeconds: 75,
  chunkSeconds: 60,
  concurrency: 8,
});

assert.equal(previousInterview.chunkCount, 60);
assert.equal(previousInterview.requestWaves, 8);

const requestReductionRatio = Math.round(
  ((previousInterview.requestCount - currentInterview.requestCount) / previousInterview.requestCount) * 100
);
const waveReductionRatio = Math.round(
  ((previousInterview.requestWaves - currentInterview.requestWaves) / previousInterview.requestWaves) * 100
);

assert.equal(requestReductionRatio, 50);
assert.equal(waveReductionRatio, 50);

console.log("60分面談 chunk plan benchmark");
console.log(`旧: ${previousInterview.chunkSeconds}秒 x ${previousInterview.chunkCount}本 (${previousInterview.requestWaves} wave)`);
console.log(`新: ${currentInterview.chunkSeconds}秒 x ${currentInterview.chunkCount}本 (${currentInterview.requestWaves} wave)`);
console.log(`API呼び出し本数: ${requestReductionRatio}% 削減`);
console.log(`並列 wave 数: ${waveReductionRatio}% 削減`);
