import assert from "node:assert/strict";
import {
  calculateOpenAiTextCostJpy,
  calculateOpenAiTextCostUsd,
  getOpenAiCostUsdJpyRate,
  resolveOpenAiTextPricing,
} from "../lib/ai/openai-pricing";

process.env.OPENAI_COST_USD_JPY_RATE = "160";

const usage = {
  inputTokens: 1_000_000,
  cachedInputTokens: 100_000,
  outputTokens: 100_000,
};

assert.deepEqual(resolveOpenAiTextPricing("gpt-5.5"), {
  inputPerMillion: 5,
  cachedInputPerMillion: 0.5,
  outputPerMillion: 30,
});
assert.equal(calculateOpenAiTextCostUsd("gpt-5.5", usage), 7.55);
assert.equal(calculateOpenAiTextCostJpy("gpt-5.5", usage), 1208);
assert.equal(getOpenAiCostUsdJpyRate(), 160);

console.log("openai pricing JPY checks passed");
