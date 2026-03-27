import { ProperNounSuggestionSource, ProperNounSuggestionStatus } from "@prisma/client";
import type {
  GlossaryCandidate,
  StoredSuggestion,
  SuggestionDraft,
  SuggestionDraftWithState,
  SuggestionSpan,
} from "@/lib/transcript/review-types";
import { CANDIDATE_STOP_WORDS, normalizeCompareText, normalizeTokenText } from "@/lib/transcript/review-shared";

const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("ja", { granularity: "word" })
    : null;

function isLikelyProperNounToken(token: string) {
  const normalized = normalizeTokenText(token);
  const comparable = normalizeCompareText(normalized);
  if (!normalized || comparable.length < 2 || comparable.length > 24) return false;
  if (/^\d+$/.test(comparable)) return false;
  if (!/[\p{Script=Han}\p{Script=Katakana}\p{Script=Latin}]/u.test(normalized)) return false;
  if (CANDIDATE_STOP_WORDS.has(normalized)) return false;
  return true;
}

function levenshtein(left: string, right: string) {
  const a = Array.from(left);
  const b = Array.from(right);
  const matrix = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

function computeSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function iterateTokenSpans(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const spans: Array<{ text: string; start: number; end: number; line: number }> = [];
  let cursor = 0;

  lines.forEach((line, lineIndex) => {
    const currentLine = line ?? "";
    if (!currentLine.trim() || /^##\s+/.test(currentLine.trim())) {
      cursor += currentLine.length + 1;
      return;
    }

    if (segmenter) {
      const segments = segmenter.segment(currentLine);
      for (const segment of segments) {
        const token = normalizeTokenText(segment.segment);
        if (!token) continue;
        if ("isWordLike" in segment && segment.isWordLike === false) continue;
        spans.push({
          text: token,
          start: cursor + segment.index,
          end: cursor + segment.index + segment.segment.length,
          line: lineIndex + 1,
        });
      }
    } else {
      const matches = currentLine.matchAll(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{Number}][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{Number}・ー\-]*/gu
      );
      for (const match of matches) {
        const token = normalizeTokenText(match[0] ?? "");
        if (!token) continue;
        const index = match.index ?? 0;
        spans.push({
          text: token,
          start: cursor + index,
          end: cursor + index + (match[0]?.length ?? 0),
          line: lineIndex + 1,
        });
      }
    }

    cursor += currentLine.length + 1;
  });

  return spans.filter((span) => isLikelyProperNounToken(span.text));
}

function buildSuggestionReason(candidate: GlossaryCandidate, aliasMatched: boolean, similarity: number) {
  if (aliasMatched) {
    return `${candidate.reasonPrefix}の別名と一致したため`;
  }
  if (candidate.source === ProperNounSuggestionSource.CONTEXT) {
    return `${candidate.reasonPrefix}と表記が近いため`;
  }
  if (similarity >= 0.9) {
    return `${candidate.reasonPrefix}とほぼ同じ表記のため`;
  }
  return `${candidate.reasonPrefix}と文脈上近い固有名詞のため`;
}

function buildSuggestionConfidence(aliasMatched: boolean, similarity: number) {
  if (aliasMatched) return 96;
  return Math.max(55, Math.min(94, Math.round(similarity * 100)));
}

export function buildSuggestionDrafts(text: string, glossaryCandidates: GlossaryCandidate[]) {
  const spans = iterateTokenSpans(text);
  const suggestions: SuggestionDraft[] = [];
  const seen = new Set<string>();

  const pushSuggestion = (draft: SuggestionDraft) => {
    const key = [draft.span.start, draft.span.end, draft.rawValue, draft.suggestedValue].join(":");
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push(draft);
  };

  for (const candidate of glossaryCandidates) {
    for (const alias of candidate.aliases) {
      if (!alias || alias === candidate.canonicalValue) continue;
      let cursor = 0;
      while (cursor < text.length) {
        const start = text.indexOf(alias, cursor);
        if (start === -1) break;
        const end = start + alias.length;
        const line = text.slice(0, start).split("\n").length;
        pushSuggestion({
          kind: candidate.kind,
          rawValue: alias,
          suggestedValue: candidate.canonicalValue,
          reason: buildSuggestionReason(candidate, true, 1),
          confidence: buildSuggestionConfidence(true, 1),
          source:
            candidate.source === ProperNounSuggestionSource.CONTEXT
              ? ProperNounSuggestionSource.CONTEXT
              : ProperNounSuggestionSource.ALIAS,
          span: { start, end, line },
          glossaryEntryId: candidate.glossaryEntryId ?? null,
        });
        cursor = end;
      }
    }
  }

  for (const span of spans) {
    const comparableToken = normalizeCompareText(span.text);
    if (!comparableToken) continue;

    let best:
      | {
          candidate: GlossaryCandidate;
          similarity: number;
          aliasMatched: boolean;
        }
      | null = null;

    for (const candidate of glossaryCandidates) {
      const canonicalComparable = normalizeCompareText(candidate.canonicalValue);
      if (!canonicalComparable || comparableToken === canonicalComparable) continue;

      for (const alias of candidate.aliases) {
        const comparableAlias = normalizeCompareText(alias);
        if (!comparableAlias) continue;
        const aliasMatched = comparableToken === comparableAlias && comparableAlias !== canonicalComparable;
        const similarity = aliasMatched ? 1 : computeSimilarity(comparableToken, comparableAlias);
        const lengthGap = Math.abs(comparableToken.length - comparableAlias.length);
        const minimum = comparableToken.length <= 3 ? 0.9 : comparableToken.length <= 5 ? 0.82 : 0.72;
        if (!aliasMatched && (similarity < minimum || lengthGap > 3)) continue;
        if (!best || similarity > best.similarity || (similarity === best.similarity && aliasMatched && !best.aliasMatched)) {
          best = { candidate, similarity, aliasMatched };
        }
      }
    }

    if (!best) continue;

    pushSuggestion({
      kind: best.candidate.kind,
      rawValue: span.text,
      suggestedValue: best.candidate.canonicalValue,
      reason: buildSuggestionReason(best.candidate, best.aliasMatched, best.similarity),
      confidence: buildSuggestionConfidence(best.aliasMatched, best.similarity),
      source: best.aliasMatched
        ? best.candidate.source === ProperNounSuggestionSource.CONTEXT
          ? ProperNounSuggestionSource.CONTEXT
          : ProperNounSuggestionSource.ALIAS
        : best.candidate.source,
      span,
      glossaryEntryId: best.candidate.glossaryEntryId ?? null,
    });
  }

  return suggestions.sort((left, right) => {
    if (left.span.start !== right.span.start) return left.span.start - right.span.start;
    return right.confidence - left.confidence;
  });
}

export function parseSpan(value: unknown): SuggestionSpan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const current = value as Record<string, unknown>;
  const start = typeof current.start === "number" ? current.start : null;
  const end = typeof current.end === "number" ? current.end : null;
  const line = typeof current.line === "number" ? current.line : 0;
  if (start === null || end === null) return null;
  return { start, end, line };
}

function suggestionKey(input: { rawValue: string; suggestedValue: string; span: SuggestionSpan }) {
  return [input.span.start, input.span.end, input.rawValue, input.suggestedValue].join(":");
}

export function mergeDraftsWithStored(
  drafts: SuggestionDraft[],
  stored: StoredSuggestion[]
): SuggestionDraftWithState[] {
  const storedByKey = new Map<string, StoredSuggestion>();
  for (const item of stored) {
    const span = parseSpan(item.spanJson);
    if (!span) continue;
    storedByKey.set(
      suggestionKey({
        rawValue: item.rawValue,
        suggestedValue: item.suggestedValue,
        span,
      }),
      item
    );
  }

  return drafts.map((draft) => {
    const existing = storedByKey.get(suggestionKey(draft));
    return {
      ...draft,
      id: existing?.id,
      status: existing?.status ?? ProperNounSuggestionStatus.PENDING,
      finalValue: existing?.finalValue ?? null,
    };
  });
}
