import { calculateOpenAiTextCostUsd } from "@/lib/ai/openai-pricing";
import { renderConversationArtifactMarkdown } from "@/lib/conversation-artifact";
import {
  buildDraftSystemPrompt,
  buildInterviewMarkdownSystemPrompt,
  buildStructuredArtifactJsonSchema,
} from "./spec";
import { callJsonGeneration, callTextGeneration } from "./transport";
import {
  buildArtifactFromStructuredPayload,
} from "./generate/render";
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
  buildMarkdownRecoveryUserPrompt,
  buildRepairUserPrompt,
  buildStructuredUserPromptBundle,
  getFastModel,
  getPromptVersion as getConversationPromptVersion,
  resolvePromptCacheSettings,
} from "./generate/prompt";
import { estimateTokens } from "./shared";
import type { StructuredDraftPayload } from "./generate/normalize";
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
  const sessionType = input.sessionType ?? "INTERVIEW";
  const draftInput = buildDraftPromptInput(input, input.transcript);
  const model = getFastModel();
  const { promptCacheKey, promptCacheRetention } = resolvePromptCacheSettings(model, input, sessionType);

  let apiCalls = 0;
  let tokenUsage = emptyTokenUsage();
  const validationErrors: string[] = [];

  if (sessionType === "INTERVIEW") {
    const system = buildInterviewMarkdownSystemPrompt();
    const promptBundle = buildInterviewMarkdownUserPromptBundle(input, draftInput);
    const user = promptBundle.userPrompt;
    const promptCacheDiagnostics = buildPromptCacheDiagnostics({
      system,
      cacheStablePrefix: promptBundle.cacheStablePrefix,
      promptCacheKey,
      promptCacheRetention,
    });
    const promptInputTokensEstimate = estimateTokens(system) + estimateTokens(user);

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
        if (built) return { ...built, ...promptCacheDiagnostics };
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

  const system = buildDraftSystemPrompt(sessionType);
  const promptBundle = buildStructuredUserPromptBundle(input, draftInput);
  const user = promptBundle.userPrompt;
  const jsonSchema = buildStructuredArtifactJsonSchema(sessionType);
  const promptInputTokensEstimate = estimateTokens(system) + estimateTokens(user);
  const promptCacheDiagnostics = buildPromptCacheDiagnostics({
    system,
    cacheStablePrefix: promptBundle.cacheStablePrefix,
    promptCacheKey,
    promptCacheRetention,
  });

  try {
    apiCalls += 1;
    const { json, raw, contentText, usage } = await callJsonGeneration({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      timeoutMs: Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000),
      max_output_tokens: sessionType === "LESSON_REPORT" ? 2200 : 3600,
      prompt_cache_key: promptCacheKey,
      prompt_cache_retention: promptCacheRetention ?? undefined,
      json_schema: jsonSchema,
    });
    tokenUsage = mergeTokenUsage(tokenUsage, usage);
    const artifact = buildArtifactFromStructuredPayload(sessionType, input, (json ?? {}) as StructuredDraftPayload);
    if (artifact) {
      const rendered = renderConversationArtifactMarkdown(artifact);
      if (!isUnsafeStructuredSummary(rendered)) {
        return {
          summaryMarkdown: rendered,
          artifact,
          model,
          apiCalls,
          evidenceChars: draftInput.content.length,
          usedFallback: false,
          inputTokensEstimate: promptInputTokensEstimate,
          tokenUsage,
          llmCostUsd: calculateOpenAiTextCostUsd(model, tokenUsage),
          ...promptCacheDiagnostics,
        };
      }
      validationErrors.push("構造化出力は得られたが、render 後に長すぎる行や unsafe な断片が残った。");
    } else {
      validationErrors.push("JSON は返ったが、必要な配列や text/evidence が足りない。");
    }
    if ((contentText ?? raw).trim()) {
      validationErrors.push("前回の出力は短い要点ではなく、情報の粒度や section 用データが不足していた。");
    }
  } catch (error) {
    validationErrors.push(error instanceof Error ? error.message : "structured generation failed");
  }

  try {
    apiCalls += 1;
    const { json, raw, contentText, usage } = await callJsonGeneration({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        { role: "user", content: buildRepairUserPrompt(validationErrors, undefined) },
      ],
      timeoutMs: Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000),
      max_output_tokens: sessionType === "LESSON_REPORT" ? 2400 : 4200,
      prompt_cache_key: promptCacheKey,
      prompt_cache_retention: promptCacheRetention ?? undefined,
      json_schema: jsonSchema,
    });
    tokenUsage = mergeTokenUsage(tokenUsage, usage);
    const artifact = buildArtifactFromStructuredPayload(sessionType, input, (json ?? {}) as StructuredDraftPayload);
    if (artifact) {
      const rendered = renderConversationArtifactMarkdown(artifact);
      if (!isUnsafeStructuredSummary(rendered)) {
        return {
          summaryMarkdown: rendered,
          artifact,
          model,
          apiCalls,
          evidenceChars: draftInput.content.length,
          usedFallback: false,
          inputTokensEstimate: promptInputTokensEstimate,
          tokenUsage,
          llmCostUsd: calculateOpenAiTextCostUsd(model, tokenUsage),
          ...promptCacheDiagnostics,
        };
      }
      validationErrors.push("repair 後も長すぎる行や unsafe な断片が残った。");
    } else {
      validationErrors.push("repair 後も JSON の shape が不足している。");
    }
    if ((contentText ?? raw).trim()) {
      validationErrors.push("repair 後も要点化と section 用データが足りない。");
    }
  } catch (error) {
    validationErrors.push(error instanceof Error ? error.message : "structured repair failed");
  }

  try {
    apiCalls += 1;
    const markdownResult = await callTextGeneration({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        { role: "user", content: buildMarkdownRecoveryUserPrompt(sessionType, validationErrors) },
      ],
      timeoutMs: Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000),
      max_output_tokens: sessionType === "LESSON_REPORT" ? 2400 : 4200,
      prompt_cache_key: promptCacheKey,
      prompt_cache_retention: promptCacheRetention ?? undefined,
      verbosity: "medium",
    });
    tokenUsage = mergeTokenUsage(tokenUsage, markdownResult.usage);
    const markdown = String(markdownResult.contentText ?? markdownResult.raw ?? "").trim();
    if (markdown) {
      const rendered = buildMarkdownDraftResult({
        sessionType,
        input,
        model,
        apiCalls,
        evidenceChars: draftInput.content.length,
        promptInputTokensEstimate,
        tokenUsage,
        markdown,
      });
      if (rendered) {
        return { ...rendered, ...promptCacheDiagnostics };
      }
      validationErrors.push("markdown 再生成でも unsafe な逐語転写が残った。");
    } else {
      validationErrors.push("markdown 再生成が空だった。");
    }
  } catch (error) {
    validationErrors.push(error instanceof Error ? error.message : "markdown recovery failed");
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
