import { calculateOpenAiTextCostUsd } from "@/lib/ai/openai-pricing";
import {
  buildInterviewMarkdownSystemPrompt,
} from "./spec";
import { callTextGeneration } from "./transport";
import {
  buildDeterministicRecovery,
  buildMarkdownDraftResult,
  emptyTokenUsage,
  isFatalGenerationErrorMessage,
  isUnsafeStructuredSummary,
  mergeTokenUsage,
} from "./generate/normalize";
import {
  buildInterviewMarkdownRepairPrompt,
  buildInterviewMarkdownUserPromptBundle,
  buildDraftPromptInput,
  getFastModel,
  getPromptVersion as getConversationPromptVersion,
  resolvePromptCacheSettings,
} from "./generate/prompt";
import { estimateTokens } from "./shared";
import type { DraftGenerationInput, DraftGenerationResult } from "./types";

function buildPromptCacheDiagnostics(params: {
  system: string;
  cacheStablePrefix: string;
  promptCacheKey?: string;
  promptCacheRetention?: "in_memory" | "24h";
}) {
  const stablePrefix = [params.system, params.cacheStablePrefix].join("\n");
  return {
    promptCacheKey: params.promptCacheKey,
    promptCacheRetention: params.promptCacheRetention,
    promptCacheStablePrefixChars: stablePrefix.length,
    promptCacheStablePrefixTokensEstimate: estimateTokens(stablePrefix),
  } satisfies Pick<
    DraftGenerationResult,
    "promptCacheKey" | "promptCacheRetention" | "promptCacheStablePrefixChars" | "promptCacheStablePrefixTokensEstimate"
  >;
}

export async function generateConversationDraftFast(input: DraftGenerationInput): Promise<DraftGenerationResult> {
  const sessionType = "INTERVIEW";
  const draftInput = buildDraftPromptInput(input, input.transcript);
  const model = getFastModel();
  const { promptCacheKey, promptCacheRetention } = resolvePromptCacheSettings(model, input, sessionType);

  let apiCalls = 0;
  let tokenUsage = emptyTokenUsage();
  const validationErrors: string[] = [];

  const system = buildInterviewMarkdownSystemPrompt();
  const promptBundle = buildInterviewMarkdownUserPromptBundle(input, draftInput);
  const user = promptBundle.userPrompt;
  const promptInputTokensEstimate = estimateTokens(system) + estimateTokens(user);
  const promptCacheDiagnostics = buildPromptCacheDiagnostics({
    system,
    cacheStablePrefix: promptBundle.cacheStablePrefix,
    promptCacheKey,
    promptCacheRetention,
  });

  try {
    apiCalls += 1;
    const result = await callTextGeneration({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      timeoutMs: Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000),
      max_output_tokens: 2200,
      prompt_cache_key: promptCacheKey,
      prompt_cache_retention: promptCacheRetention ?? undefined,
      verbosity: "low",
    });
    tokenUsage = mergeTokenUsage(tokenUsage, result.usage);
    const markdown = String(result.contentText ?? result.raw ?? "").trim();
    if (markdown) {
      const built = buildMarkdownDraftResult({
        sessionType,
        input,
        model,
        apiCalls,
        evidenceChars: draftInput.content.length,
        promptInputTokensEstimate,
        tokenUsage,
        markdown,
      });
      if (built) return { ...built, ...promptCacheDiagnostics };
      validationErrors.push("interview markdown が弱く、逐語転写や重複が残った。");
    } else {
      validationErrors.push("interview markdown が空だった。");
    }
  } catch (error) {
    validationErrors.push(error instanceof Error ? error.message : "interview markdown generation failed");
  }

  try {
    apiCalls += 1;
    const retryResult = await callTextGeneration({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        { role: "user", content: buildInterviewMarkdownRepairPrompt(validationErrors) },
      ],
      timeoutMs: Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000),
      max_output_tokens: 2600,
      prompt_cache_key: promptCacheKey,
      prompt_cache_retention: promptCacheRetention ?? undefined,
      verbosity: "medium",
    });
    tokenUsage = mergeTokenUsage(tokenUsage, retryResult.usage);
    const markdown = String(retryResult.contentText ?? retryResult.raw ?? "").trim();
    if (markdown) {
      const built = buildMarkdownDraftResult({
        sessionType,
        input,
        model,
        apiCalls,
        evidenceChars: draftInput.content.length,
        promptInputTokensEstimate,
        tokenUsage,
        markdown,
      });
      if (built) {
        return { ...built, ...promptCacheDiagnostics };
      }
      validationErrors.push("retry 後の interview markdown でも重複や逐語転写が残った。");
    } else {
      validationErrors.push("retry 後の interview markdown が空だった。");
    }
  } catch (error) {
    validationErrors.push(error instanceof Error ? error.message : "interview markdown retry failed");
  }

  const fatalError = validationErrors.find((message) => isFatalGenerationErrorMessage(message));
  if (fatalError) {
    throw new Error(`LLM generation failed: ${fatalError}`);
  }

  const recovered = buildDeterministicRecovery(input);
  return {
    summaryMarkdown: recovered.summaryMarkdown,
    artifact: recovered.artifact,
    model,
    apiCalls: Math.max(apiCalls, 1),
    evidenceChars: draftInput.content.length,
    usedFallback: true,
    inputTokensEstimate: promptInputTokensEstimate,
    tokenUsage,
    llmCostUsd: calculateOpenAiTextCostUsd(model, tokenUsage),
    ...promptCacheDiagnostics,
  };
}

export function getPromptVersion() {
  return getConversationPromptVersion();
}
