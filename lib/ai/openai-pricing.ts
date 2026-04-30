import type { LlmTokenUsage } from "@/lib/ai/conversation/types";

type OpenAiTextPricing = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
};

// 2026-04-30 時点の OpenAI 公式 API Pricing を元にした計算用定数。
// https://openai.com/api/pricing/
const TEXT_PRICING: Record<string, OpenAiTextPricing> = {
  "gpt-5.5": {
    inputPerMillion: 5,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 30,
  },
  "gpt-5.4": {
    inputPerMillion: 2.5,
    cachedInputPerMillion: 0.25,
    outputPerMillion: 15,
  },
  "gpt-5.4-mini": {
    inputPerMillion: 0.75,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 4.5,
  },
  "gpt-5.4-nano": {
    inputPerMillion: 0.2,
    cachedInputPerMillion: 0.02,
    outputPerMillion: 1.25,
  },
};

function normalizeModelName(model: string) {
  const normalized = String(model ?? "").trim().toLowerCase();
  if (!normalized) return "gpt-5.5";
  if (normalized.includes("gpt-5.5")) return "gpt-5.5";
  if (normalized.includes("gpt-5.4-mini")) return "gpt-5.4-mini";
  if (normalized.includes("gpt-5.4-nano")) return "gpt-5.4-nano";
  if (normalized.includes("gpt-5.4")) return "gpt-5.4";
  return normalized;
}

export function getOpenAiCostUsdJpyRate() {
  const value = Number(process.env.OPENAI_COST_USD_JPY_RATE ?? process.env.USD_JPY_RATE ?? 160);
  if (!Number.isFinite(value) || value <= 0) return 160;
  return value;
}

export function resolveOpenAiTextPricing(model: string) {
  return TEXT_PRICING[normalizeModelName(model)] ?? null;
}

export function calculateOpenAiTextCostUsd(model: string, usage?: Partial<LlmTokenUsage> | null) {
  const pricing = resolveOpenAiTextPricing(model);
  if (!pricing) return 0;

  const inputTokens = Math.max(0, Math.floor(Number(usage?.inputTokens ?? 0)));
  const cachedInputTokens = Math.max(0, Math.floor(Number(usage?.cachedInputTokens ?? 0)));
  const outputTokens = Math.max(0, Math.floor(Number(usage?.outputTokens ?? 0)));
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);

  return (
    (uncachedInputTokens / 1_000_000) * pricing.inputPerMillion +
    (cachedInputTokens / 1_000_000) * pricing.cachedInputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

export function calculateOpenAiTextCostJpy(
  model: string,
  usage?: Partial<LlmTokenUsage> | null,
  usdJpyRate = getOpenAiCostUsdJpyRate()
) {
  return calculateOpenAiTextCostUsd(model, usage) * usdJpyRate;
}
