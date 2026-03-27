import { ProperNounSuggestionStatus } from "@prisma/client";
import type { SuggestionSpan } from "@/lib/transcript/review-types";
import { parseSpan } from "@/lib/transcript/suggestion";
import { normalizeTokenText } from "@/lib/transcript/review-shared";

export function resolveSuggestionReplacement(input: {
  status: ProperNounSuggestionStatus;
  suggestedValue: string;
  finalValue?: string | null;
}) {
  if (input.status === ProperNounSuggestionStatus.REJECTED) return null;
  if (input.status === ProperNounSuggestionStatus.MANUALLY_EDITED) {
    return normalizeTokenText(input.finalValue ?? "");
  }
  if (input.status === ProperNounSuggestionStatus.CONFIRMED) {
    return normalizeTokenText(input.finalValue ?? input.suggestedValue);
  }
  return normalizeTokenText(input.suggestedValue);
}

export function applySuggestionsToText(
  text: string,
  suggestions: Array<{
    rawValue: string;
    suggestedValue: string;
    finalValue?: string | null;
    status: ProperNounSuggestionStatus;
    span: SuggestionSpan;
  }>
) {
  const applicable = suggestions
    .map((suggestion) => ({
      ...suggestion,
      replacement: resolveSuggestionReplacement(suggestion),
    }))
    .filter((suggestion) => Boolean(suggestion.replacement))
    .sort((left, right) => right.span.start - left.span.start);

  let next = text;
  for (const suggestion of applicable) {
    const replacement = suggestion.replacement ?? "";
    if (!replacement) continue;
    const current = next.slice(suggestion.span.start, suggestion.span.end);
    if (normalizeTokenText(current) !== normalizeTokenText(suggestion.rawValue)) continue;
    next = `${next.slice(0, suggestion.span.start)}${replacement}${next.slice(suggestion.span.end)}`;
  }
  return next;
}

export function selectSuggestionsWithSpan<
  T extends {
    rawValue: string;
    suggestedValue: string;
    finalValue?: string | null;
    status: ProperNounSuggestionStatus;
    spanJson: unknown;
  },
>(suggestions: T[]) {
  return suggestions
    .map((suggestion) => ({
      ...suggestion,
      span: parseSpan(suggestion.spanJson),
    }))
    .filter((suggestion): suggestion is T & { span: SuggestionSpan } => Boolean(suggestion.span));
}
