import {
  ProperNounKind,
  ProperNounSuggestionSource,
  ProperNounSuggestionStatus,
  SessionPartStatus,
  SessionPartType,
  SessionType,
  TranscriptReviewState,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/prisma-json";
import { extractMarkdownSectionBody, transcriptLines } from "@/lib/ai/conversation/shared";
import { buildDisplayTranscriptText, normalizeRawTranscriptText, pickEvidenceTranscriptText } from "@/lib/transcript/source";

type GlossaryCandidate = {
  glossaryEntryId?: string | null;
  canonicalValue: string;
  aliases: string[];
  kind: ProperNounKind;
  source: ProperNounSuggestionSource;
  reasonPrefix: string;
};

type SuggestionSpan = {
  start: number;
  end: number;
  line: number;
};

type SuggestionDraft = {
  kind: ProperNounKind;
  rawValue: string;
  suggestedValue: string;
  reason: string;
  confidence: number;
  source: ProperNounSuggestionSource;
  span: SuggestionSpan;
  glossaryEntryId?: string | null;
};

type StoredSuggestion = {
  id: string;
  kind: ProperNounKind;
  rawValue: string;
  suggestedValue: string;
  finalValue: string | null;
  reason: string;
  confidence: number;
  source: ProperNounSuggestionSource;
  status: ProperNounSuggestionStatus;
  glossaryEntryId: string | null;
  spanJson: unknown;
};

type ReviewReason = {
  code: string;
  message: string;
  count?: number;
};

type ReviewAssessment = {
  reviewState: TranscriptReviewState;
  reviewRequired: boolean;
  reasons: ReviewReason[];
  pendingSuggestionCount: number;
  suggestionCount: number;
};

type SessionPartReviewSummary = ReviewAssessment & {
  reviewedText: string;
};

type ConversationReviewSummary = ReviewAssessment & {
  reviewedText: string;
  rawTextOriginal: string;
};

const CANDIDATE_STOP_WORDS = new Set([
  "先生",
  "講師",
  "生徒",
  "学校",
  "宿題",
  "授業",
  "面談",
  "今回",
  "次回",
  "確認",
  "共有",
  "保護者",
  "学習",
  "数学",
  "英語",
  "国語",
  "理科",
  "社会",
  "チェックイン",
  "チェックアウト",
]);

const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("ja", { granularity: "word" })
    : null;

function normalizeCompareText(text: string) {
  return normalizeRawTranscriptText(text)
    .normalize("NFKC")
    .replace(/[ 　\t\r\n]/g, "")
    .replace(/[・･\-ー_]/g, "")
    .replace(/[()（）「」『』【】\[\]]/g, "")
    .toLowerCase();
}

function normalizeTokenText(text: string) {
  return normalizeRawTranscriptText(text).replace(/\s+/g, " ").trim();
}

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

function readAliases(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => normalizeTokenText(entry))
    .filter(Boolean);
}

function buildContextGlossaryCandidates(input: {
  studentName?: string | null;
  studentNameKana?: string | null;
  teacherName?: string | null;
  glossaryEntries: Array<{
    id: string;
    kind: ProperNounKind;
    canonicalValue: string;
    aliasesJson: unknown;
  }>;
}) {
  const candidates: GlossaryCandidate[] = [];

  const pushCandidate = (candidate: GlossaryCandidate) => {
    const canonicalValue = normalizeTokenText(candidate.canonicalValue);
    if (!canonicalValue) return;
    const aliases = Array.from(new Set([canonicalValue, ...candidate.aliases.map(normalizeTokenText).filter(Boolean)]));
    candidates.push({
      ...candidate,
      canonicalValue,
      aliases,
    });
  };

  if (input.studentName?.trim()) {
    pushCandidate({
      canonicalValue: input.studentName.trim(),
      aliases: [input.studentNameKana ?? ""],
      kind: ProperNounKind.STUDENT,
      source: ProperNounSuggestionSource.CONTEXT,
      reasonPrefix: "生徒情報",
    });
  }

  if (input.teacherName?.trim()) {
    pushCandidate({
      canonicalValue: input.teacherName.trim(),
      aliases: [],
      kind: ProperNounKind.TUTOR,
      source: ProperNounSuggestionSource.CONTEXT,
      reasonPrefix: "担当講師情報",
    });
  }

  for (const entry of input.glossaryEntries) {
    pushCandidate({
      glossaryEntryId: entry.id,
      canonicalValue: entry.canonicalValue,
      aliases: readAliases(entry.aliasesJson),
      kind: entry.kind,
      source: ProperNounSuggestionSource.GLOSSARY,
      reasonPrefix: "辞書候補",
    });
  }

  return candidates;
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
      const matches = currentLine.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{Number}][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{Number}・ー\-]*/gu);
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

function buildSuggestionDrafts(text: string, glossaryCandidates: GlossaryCandidate[]) {
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

function parseSpan(value: unknown): SuggestionSpan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const current = value as Record<string, unknown>;
  const start = typeof current.start === "number" ? current.start : null;
  const end = typeof current.end === "number" ? current.end : null;
  const line = typeof current.line === "number" ? current.line : 0;
  if (start === null || end === null) return null;
  return { start, end, line };
}

function suggestionKey(input: {
  rawValue: string;
  suggestedValue: string;
  span: SuggestionSpan;
}) {
  return [input.span.start, input.span.end, input.rawValue, input.suggestedValue].join(":");
}

function mergeDraftsWithStored(drafts: SuggestionDraft[], stored: StoredSuggestion[]) {
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

function resolveSuggestionReplacement(suggestion: {
  status: ProperNounSuggestionStatus;
  suggestedValue: string;
  finalValue?: string | null;
}) {
  if (suggestion.status === ProperNounSuggestionStatus.REJECTED) return null;
  if (suggestion.status === ProperNounSuggestionStatus.MANUALLY_EDITED) {
    return normalizeTokenText(suggestion.finalValue ?? "");
  }
  if (suggestion.status === ProperNounSuggestionStatus.CONFIRMED) {
    return normalizeTokenText(suggestion.finalValue ?? suggestion.suggestedValue);
  }
  return normalizeTokenText(suggestion.suggestedValue);
}

function applySuggestionsToText(
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

function countMeaningfulChars(text: string) {
  return normalizeRawTranscriptText(text).replace(/[\s、。，．！？!?:：;；・\-]/g, "").length;
}

function assessReviewState(reasons: ReviewReason[], suggestions: Array<{ status: ProperNounSuggestionStatus }>): ReviewAssessment {
  const pendingSuggestionCount = suggestions.filter((item) => item.status === ProperNounSuggestionStatus.PENDING).length;
  const reviewRequired = reasons.length > 0;
  let reviewState: TranscriptReviewState = TranscriptReviewState.NONE;
  if (reviewRequired) {
    reviewState = TranscriptReviewState.REQUIRED;
  } else if (suggestions.length > 0) {
    reviewState = TranscriptReviewState.RESOLVED;
  }
  return {
    reviewState,
    reviewRequired,
    reasons,
    pendingSuggestionCount,
    suggestionCount: suggestions.length,
  };
}

function assessSessionPartReview(input: {
  rawTextOriginal: string;
  suggestions: Array<{ status: ProperNounSuggestionStatus }>;
  qualityMetaJson?: unknown;
}) {
  const qualityMeta =
    input.qualityMetaJson && typeof input.qualityMetaJson === "object" && !Array.isArray(input.qualityMetaJson)
      ? (input.qualityMetaJson as Record<string, unknown>)
      : {};
  const sttWarnings = Array.isArray(qualityMeta.sttQualityWarnings)
    ? qualityMeta.sttQualityWarnings.filter((item): item is string => typeof item === "string")
    : [];
  const reasons: ReviewReason[] = [];
  const pendingSuggestionCount = input.suggestions.filter((item) => item.status === ProperNounSuggestionStatus.PENDING).length;
  if (pendingSuggestionCount > 0) {
    reasons.push({
      code: "pending_proper_noun",
      message: "固有名詞の候補があり、確認が必要です。",
      count: pendingSuggestionCount,
    });
  }
  if (pendingSuggestionCount >= 6) {
    reasons.push({
      code: "too_many_proper_noun_candidates",
      message: "固有名詞候補が多く、自動補正だけでは危険です。",
      count: pendingSuggestionCount,
    });
  }
  if (sttWarnings.length > 0) {
    reasons.push({
      code: "stt_quality_warning",
      message: "文字起こし品質の注意が出ています。",
      count: sttWarnings.length,
    });
  }
  if (countMeaningfulChars(input.rawTextOriginal) < 40) {
    reasons.push({
      code: "transcript_too_short",
      message: "文字起こしが短く、確認が必要です。",
    });
  }
  return assessReviewState(reasons, input.suggestions);
}

function assessConversationReview(input: {
  sessionType?: SessionType | null;
  rawTextOriginal: string;
  suggestions: Array<{ status: ProperNounSuggestionStatus }>;
  qualityMetaJson?: unknown;
}) {
  const qualityMeta =
    input.qualityMetaJson && typeof input.qualityMetaJson === "object" && !Array.isArray(input.qualityMetaJson)
      ? (input.qualityMetaJson as Record<string, unknown>)
      : {};
  const reasons: ReviewReason[] = [];
  const pendingSuggestionCount = input.suggestions.filter((item) => item.status === ProperNounSuggestionStatus.PENDING).length;
  if (pendingSuggestionCount > 0) {
    reasons.push({
      code: "pending_proper_noun",
      message: "固有名詞候補が残っているため、確認した方が安全です。",
      count: pendingSuggestionCount,
    });
  }
  if (pendingSuggestionCount >= 6) {
    reasons.push({
      code: "too_many_proper_noun_candidates",
      message: "固有名詞候補が多く、確認が必要です。",
      count: pendingSuggestionCount,
    });
  }
  if (qualityMeta.usedFallbackSummary === true) {
    reasons.push({
      code: "fallback_used",
      message: "保守的な fallback でログを作成しました。",
    });
  }
  const sttWarnings = Array.isArray(qualityMeta.sttQualityWarnings)
    ? qualityMeta.sttQualityWarnings.filter((item): item is string => typeof item === "string")
    : [];
  if (sttWarnings.length > 0) {
    reasons.push({
      code: "stt_quality_warning",
      message: "文字起こし品質の注意が残っています。",
      count: sttWarnings.length,
    });
  }
  if (countMeaningfulChars(input.rawTextOriginal) < 80) {
    reasons.push({
      code: "transcript_too_short",
      message: "会話ログ生成に使う入力が短いため、確認が必要です。",
    });
  }
  const lines = transcriptLines(input.rawTextOriginal);
  if (input.sessionType === SessionType.INTERVIEW && lines.length < 5) {
    reasons.push({
      code: "weak_interview_input",
      message: "面談の入力が弱く、根拠が足りない可能性があります。",
    });
  }
  if (input.sessionType === SessionType.LESSON_REPORT) {
    const checkInLines = transcriptLines(extractMarkdownSectionBody(input.rawTextOriginal, "授業前チェックイン"));
    const checkOutLines = transcriptLines(extractMarkdownSectionBody(input.rawTextOriginal, "授業後チェックアウト"));
    if (checkInLines.length < 2) {
      reasons.push({
        code: "weak_check_in",
        message: "チェックインの情報が弱いため、確認が必要です。",
      });
    }
    if (checkOutLines.length < 2) {
      reasons.push({
        code: "weak_check_out",
        message: "チェックアウトの情報が弱いため、確認が必要です。",
      });
    }
    if (lines.length < 6) {
      reasons.push({
        code: "weak_lesson_input",
        message: "指導報告の入力が弱く、根拠が足りない可能性があります。",
      });
    }
  }
  return assessReviewState(reasons, input.suggestions);
}

function buildReviewMetaPatch(review: ReviewAssessment) {
  return {
    transcriptReview: {
      reviewState: review.reviewState,
      reviewRequired: review.reviewRequired,
      reasons: review.reasons,
      pendingSuggestionCount: review.pendingSuggestionCount,
      suggestionCount: review.suggestionCount,
      updatedAt: new Date().toISOString(),
    },
  };
}

function orderForSessionType(sessionType: SessionType) {
  if (sessionType === SessionType.LESSON_REPORT) {
    return {
      [SessionPartType.CHECK_IN]: 0,
      [SessionPartType.FULL]: 1,
      [SessionPartType.CHECK_OUT]: 2,
      [SessionPartType.TEXT_NOTE]: 3,
    } as const;
  }
  return {
    [SessionPartType.FULL]: 0,
    [SessionPartType.CHECK_IN]: 1,
    [SessionPartType.CHECK_OUT]: 2,
    [SessionPartType.TEXT_NOTE]: 3,
  } as const;
}

function combineSessionTranscript(
  sessionType: SessionType,
  parts: Array<{
    partType: SessionPartType;
    status: SessionPartStatus;
    rawTextOriginal?: string | null;
    rawTextCleaned?: string | null;
    reviewedText?: string | null;
  }>,
  kind: "raw" | "reviewed"
) {
  const order = orderForSessionType(sessionType);
  const labelMap: Record<SessionPartType, string> = {
    FULL: "面談・通し録音",
    CHECK_IN: "授業前チェックイン",
    CHECK_OUT: "授業後チェックアウト",
    TEXT_NOTE: "補足メモ",
  };
  return [...parts]
    .filter((part) => part.status === SessionPartStatus.READY)
    .sort((left, right) => order[left.partType] - order[right.partType])
    .map((part) => {
      const body =
        kind === "reviewed"
          ? pickEvidenceTranscriptText({
              reviewedText: part.reviewedText,
              rawTextOriginal: part.rawTextOriginal,
            })
          : normalizeRawTranscriptText(part.rawTextOriginal);
      if (!body) return null;
      return `## ${labelMap[part.partType]}\n${body}`;
    })
    .filter((chunk): chunk is string => Boolean(chunk))
    .join("\n\n")
    .trim();
}

async function loadGlossaryEntries(input: {
  organizationId: string;
  studentId: string;
  tutorUserId?: string | null;
}) {
  return prisma.properNounGlossaryEntry.findMany({
    where: {
      organizationId: input.organizationId,
      OR: [
        { studentId: null, tutorUserId: null },
        { studentId: input.studentId },
        ...(input.tutorUserId ? [{ tutorUserId: input.tutorUserId }] : []),
      ],
    },
    select: {
      id: true,
      kind: true,
      canonicalValue: true,
      aliasesJson: true,
    },
  });
}

async function syncSuggestionsForSessionPart(input: {
  sessionPartId: string;
  organizationId: string;
  studentId: string;
  sessionId: string;
  drafts: ReturnType<typeof mergeDraftsWithStored>;
  existing: StoredSuggestion[];
}) {
  const keepIds: string[] = [];
  const existingById = new Map(input.existing.map((item) => [item.id, item]));

  for (const draft of input.drafts) {
    const payload = {
      organizationId: input.organizationId,
      studentId: input.studentId,
      sessionId: input.sessionId,
      sessionPartId: input.sessionPartId,
      kind: draft.kind,
      rawValue: draft.rawValue,
      suggestedValue: draft.suggestedValue,
      finalValue: draft.finalValue ?? null,
      reason: draft.reason,
      confidence: draft.confidence,
      source: draft.source,
      status: draft.status,
      spanJson: toPrismaJson(draft.span),
      glossaryEntryId: draft.glossaryEntryId ?? null,
    };

    if (draft.id && existingById.has(draft.id)) {
      keepIds.push(draft.id);
      await prisma.properNounSuggestion.update({
        where: { id: draft.id },
        data: payload,
      });
      continue;
    }

    const created = await prisma.properNounSuggestion.create({
      data: payload,
      select: { id: true },
    });
    keepIds.push(created.id);
  }

  const staleIds = input.existing.map((item) => item.id).filter((id) => !keepIds.includes(id));
  if (staleIds.length > 0) {
    await prisma.properNounSuggestion.deleteMany({
      where: { id: { in: staleIds } },
    });
  }
}

export async function ensureSessionPartReviewedTranscript(sessionPartId: string): Promise<SessionPartReviewSummary> {
  const part = await prisma.sessionPart.findUnique({
    where: { id: sessionPartId },
    include: {
      session: {
        select: {
          id: true,
          organizationId: true,
          studentId: true,
          student: {
            select: {
              name: true,
              nameKana: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      properNounSuggestions: {
        select: {
          id: true,
          kind: true,
          rawValue: true,
          suggestedValue: true,
          finalValue: true,
          reason: true,
          confidence: true,
          source: true,
          status: true,
          glossaryEntryId: true,
          spanJson: true,
        },
      },
    },
  });
  if (!part?.session) {
    throw new Error("session part not found");
  }

  const rawTextOriginal = normalizeRawTranscriptText(part.rawTextOriginal);
  if (!rawTextOriginal) {
    const empty = assessSessionPartReview({
      rawTextOriginal,
      suggestions: [],
      qualityMetaJson: part.qualityMetaJson,
    });
    await prisma.sessionPart.update({
      where: { id: part.id },
      data: {
        reviewedText: null,
        reviewState: empty.reviewState,
        qualityMetaJson: toPrismaJson({
          ...(part.qualityMetaJson as Record<string, unknown> | null),
          ...buildReviewMetaPatch(empty),
        }),
      },
    });
    return {
      ...empty,
      reviewedText: "",
    };
  }

  const glossaryEntries = await loadGlossaryEntries({
    organizationId: part.session.organizationId,
    studentId: part.session.studentId,
    tutorUserId: part.session.user?.id ?? null,
  });
  const glossaryCandidates = buildContextGlossaryCandidates({
    studentName: part.session.student.name,
    studentNameKana: part.session.student.nameKana,
    teacherName: part.session.user?.name,
    glossaryEntries,
  });
  const drafts = buildSuggestionDrafts(rawTextOriginal, glossaryCandidates);
  const merged = mergeDraftsWithStored(drafts, part.properNounSuggestions as StoredSuggestion[]);

  await syncSuggestionsForSessionPart({
    sessionPartId: part.id,
    organizationId: part.session.organizationId,
    studentId: part.session.studentId,
    sessionId: part.session.id,
    drafts: merged,
    existing: part.properNounSuggestions as StoredSuggestion[],
  });

  const storedSuggestions = await prisma.properNounSuggestion.findMany({
    where: { sessionPartId: part.id },
    select: {
      id: true,
      rawValue: true,
      suggestedValue: true,
      finalValue: true,
      status: true,
      spanJson: true,
      kind: true,
      reason: true,
      confidence: true,
      source: true,
      glossaryEntryId: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const applicable = storedSuggestions
    .map((suggestion) => ({
      ...suggestion,
      span: parseSpan(suggestion.spanJson),
    }))
    .filter((suggestion): suggestion is typeof suggestion & { span: SuggestionSpan } => Boolean(suggestion.span));

  const reviewedText = applySuggestionsToText(rawTextOriginal, applicable);
  const review = assessSessionPartReview({
    rawTextOriginal,
    suggestions: storedSuggestions,
    qualityMetaJson: part.qualityMetaJson,
  });

  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      reviewedText: normalizeRawTranscriptText(reviewedText) || null,
      reviewState: review.reviewState,
      qualityMetaJson: toPrismaJson({
        ...(part.qualityMetaJson as Record<string, unknown> | null),
        ...buildReviewMetaPatch(review),
      }),
    },
  });

  return {
    ...review,
    reviewedText,
  };
}

async function syncDirectConversationSuggestions(input: {
  conversationId: string;
  organizationId: string;
  studentId: string;
  rawTextOriginal: string;
  studentName?: string | null;
  studentNameKana?: string | null;
  teacherId?: string | null;
  teacherName?: string | null;
  qualityMetaJson?: unknown;
  existingSuggestions: StoredSuggestion[];
}) {
  const glossaryEntries = await loadGlossaryEntries({
    organizationId: input.organizationId,
    studentId: input.studentId,
    tutorUserId: input.teacherId ?? null,
  });
  const glossaryCandidates = buildContextGlossaryCandidates({
    studentName: input.studentName,
    studentNameKana: input.studentNameKana,
    teacherName: input.teacherName,
    glossaryEntries,
  });
  const drafts = buildSuggestionDrafts(input.rawTextOriginal, glossaryCandidates);
  const merged = mergeDraftsWithStored(drafts, input.existingSuggestions);

  const keepIds: string[] = [];
  const existingById = new Map(input.existingSuggestions.map((item) => [item.id, item]));
  for (const draft of merged) {
    const payload = {
      organizationId: input.organizationId,
      studentId: input.studentId,
      conversationId: input.conversationId,
      kind: draft.kind,
      rawValue: draft.rawValue,
      suggestedValue: draft.suggestedValue,
      finalValue: draft.finalValue ?? null,
      reason: draft.reason,
      confidence: draft.confidence,
      source: draft.source,
      status: draft.status,
      spanJson: toPrismaJson(draft.span),
      glossaryEntryId: draft.glossaryEntryId ?? null,
    };
    if (draft.id && existingById.has(draft.id)) {
      keepIds.push(draft.id);
      await prisma.properNounSuggestion.update({
        where: { id: draft.id },
        data: payload,
      });
      continue;
    }
    const created = await prisma.properNounSuggestion.create({
      data: payload,
      select: { id: true },
    });
    keepIds.push(created.id);
  }

  const staleIds = input.existingSuggestions.map((item) => item.id).filter((id) => !keepIds.includes(id));
  if (staleIds.length > 0) {
    await prisma.properNounSuggestion.deleteMany({
      where: { id: { in: staleIds } },
    });
  }

  const suggestions = await prisma.properNounSuggestion.findMany({
    where: { conversationId: input.conversationId, sessionPartId: null },
    select: {
      id: true,
      rawValue: true,
      suggestedValue: true,
      finalValue: true,
      status: true,
      spanJson: true,
      kind: true,
      reason: true,
      confidence: true,
      source: true,
      glossaryEntryId: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const applicable = suggestions
    .map((suggestion) => ({
      ...suggestion,
      span: parseSpan(suggestion.spanJson),
    }))
    .filter((suggestion): suggestion is typeof suggestion & { span: SuggestionSpan } => Boolean(suggestion.span));
  const reviewedText = applySuggestionsToText(input.rawTextOriginal, applicable);
  const review = assessConversationReview({
    rawTextOriginal: input.rawTextOriginal,
    suggestions,
    qualityMetaJson: input.qualityMetaJson,
  });

  await prisma.conversationLog.update({
    where: { id: input.conversationId },
    data: {
      reviewedText: normalizeRawTranscriptText(reviewedText) || null,
      reviewState: review.reviewState,
      qualityMetaJson: toPrismaJson({
        ...(input.qualityMetaJson as Record<string, unknown> | null),
        ...buildReviewMetaPatch(review),
      }),
    },
  });

  return {
    ...review,
    reviewedText,
    rawTextOriginal: input.rawTextOriginal,
  };
}

export async function ensureConversationReviewedTranscript(conversationId: string): Promise<ConversationReviewSummary> {
  const conversation = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          nameKana: true,
        },
      },
      user: {
        select: {
          id: true,
          name: true,
        },
      },
      session: {
        include: {
          parts: {
            select: {
              id: true,
              partType: true,
              status: true,
              rawTextOriginal: true,
              rawTextCleaned: true,
              reviewedText: true,
              reviewState: true,
            },
          },
        },
      },
      properNounSuggestions: {
        select: {
          id: true,
          kind: true,
          rawValue: true,
          suggestedValue: true,
          finalValue: true,
          reason: true,
          confidence: true,
          source: true,
          status: true,
          glossaryEntryId: true,
          spanJson: true,
          sessionPartId: true,
        },
      },
    },
  });
  if (!conversation) {
    throw new Error("conversation not found");
  }

  if (conversation.session) {
    const readyPartIds = conversation.session.parts
      .filter((part) => part.status === SessionPartStatus.READY)
      .map((part) => part.id);
    for (const partId of readyPartIds) {
      await ensureSessionPartReviewedTranscript(partId);
    }

    const refreshedSession = await prisma.session.findUnique({
      where: { id: conversation.session.id },
      include: {
        parts: {
          select: {
            id: true,
            partType: true,
            status: true,
            rawTextOriginal: true,
            rawTextCleaned: true,
            reviewedText: true,
            reviewState: true,
            properNounSuggestions: {
              select: {
                id: true,
                status: true,
                rawValue: true,
                suggestedValue: true,
                finalValue: true,
                spanJson: true,
              },
            },
          },
        },
      },
    });
    if (!refreshedSession) {
      throw new Error("session not found");
    }

    const rawTextOriginal = combineSessionTranscript(refreshedSession.type, refreshedSession.parts, "raw");
    const reviewedText = combineSessionTranscript(refreshedSession.type, refreshedSession.parts, "reviewed");
    const suggestions = refreshedSession.parts.flatMap((part) => part.properNounSuggestions);
    const review = assessConversationReview({
      sessionType: refreshedSession.type,
      rawTextOriginal,
      suggestions,
      qualityMetaJson: conversation.qualityMetaJson,
    });

    if (readyPartIds.length > 0) {
      await prisma.properNounSuggestion.updateMany({
        where: {
          sessionPartId: { in: readyPartIds },
        },
        data: {
          conversationId: conversation.id,
        },
      });
    }

    await prisma.conversationLog.update({
      where: { id: conversation.id },
      data: {
        rawTextOriginal: rawTextOriginal || conversation.rawTextOriginal,
        reviewedText: normalizeRawTranscriptText(reviewedText) || null,
        reviewState: review.reviewState,
        qualityMetaJson: toPrismaJson({
          ...(conversation.qualityMetaJson as Record<string, unknown> | null),
          ...buildReviewMetaPatch(review),
        }),
      },
    });

    return {
      ...review,
      reviewedText,
      rawTextOriginal,
    };
  }

  return syncDirectConversationSuggestions({
    conversationId: conversation.id,
    organizationId: conversation.organizationId,
    studentId: conversation.studentId,
    rawTextOriginal: normalizeRawTranscriptText(conversation.rawTextOriginal),
    studentName: conversation.student?.name,
    studentNameKana: conversation.student?.nameKana,
    teacherId: conversation.user?.id,
    teacherName: conversation.user?.name,
    qualityMetaJson: conversation.qualityMetaJson,
    existingSuggestions: (conversation.properNounSuggestions as StoredSuggestion[]).filter(
      (item: any) => !item.sessionPartId
    ),
  });
}

async function syncReviewedTextFromStoredSuggestionsForPart(sessionPartId: string) {
  const part = await prisma.sessionPart.findUnique({
    where: { id: sessionPartId },
    select: {
      id: true,
      rawTextOriginal: true,
      qualityMetaJson: true,
      properNounSuggestions: {
        select: {
          id: true,
          rawValue: true,
          suggestedValue: true,
          finalValue: true,
          status: true,
          spanJson: true,
        },
      },
    },
  });
  if (!part) throw new Error("session part not found");

  const rawTextOriginal = normalizeRawTranscriptText(part.rawTextOriginal);
  const applicable = part.properNounSuggestions
    .map((suggestion) => ({
      ...suggestion,
      span: parseSpan(suggestion.spanJson),
    }))
    .filter((suggestion): suggestion is typeof suggestion & { span: SuggestionSpan } => Boolean(suggestion.span));
  const reviewedText = applySuggestionsToText(rawTextOriginal, applicable);
  const review = assessSessionPartReview({
    rawTextOriginal,
    suggestions: part.properNounSuggestions,
    qualityMetaJson: part.qualityMetaJson,
  });

  await prisma.sessionPart.update({
    where: { id: part.id },
    data: {
      reviewedText: normalizeRawTranscriptText(reviewedText) || null,
      reviewState: review.reviewState,
      qualityMetaJson: toPrismaJson({
        ...(part.qualityMetaJson as Record<string, unknown> | null),
        ...buildReviewMetaPatch(review),
      }),
    },
  });

  return review;
}

export async function updateProperNounSuggestionDecision(input: {
  suggestionId: string;
  status: ProperNounSuggestionStatus;
  finalValue?: string | null;
}) {
  const suggestion = await prisma.properNounSuggestion.findUnique({
    where: { id: input.suggestionId },
    select: {
      id: true,
      sessionPartId: true,
      conversationId: true,
    },
  });
  if (!suggestion) {
    throw new Error("proper noun suggestion not found");
  }

  await prisma.properNounSuggestion.update({
    where: { id: suggestion.id },
    data: {
      status: input.status,
      finalValue:
        input.status === ProperNounSuggestionStatus.MANUALLY_EDITED
          ? normalizeTokenText(input.finalValue ?? "")
          : input.status === ProperNounSuggestionStatus.CONFIRMED
            ? normalizeTokenText(input.finalValue ?? "")
            : null,
    },
  });

  if (suggestion.sessionPartId) {
    await syncReviewedTextFromStoredSuggestionsForPart(suggestion.sessionPartId);
  }
  if (suggestion.conversationId) {
    await ensureConversationReviewedTranscript(suggestion.conversationId);
  } else if (suggestion.sessionPartId) {
    const linkedConversation = await prisma.conversationLog.findFirst({
      where: {
        session: {
          parts: {
            some: {
              id: suggestion.sessionPartId,
            },
          },
        },
      },
      select: { id: true },
    });
    if (linkedConversation?.id) {
      await ensureConversationReviewedTranscript(linkedConversation.id);
    }
  }
}

export async function listConversationProperNounSuggestions(conversationId: string) {
  const conversation = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      sessionId: true,
      rawTextOriginal: true,
      reviewedText: true,
      rawTextCleaned: true,
      reviewState: true,
      qualityMetaJson: true,
      properNounSuggestions: {
        select: {
          id: true,
          kind: true,
          rawValue: true,
          suggestedValue: true,
          finalValue: true,
          reason: true,
          confidence: true,
          source: true,
          status: true,
          spanJson: true,
          sessionPartId: true,
        },
        orderBy: [{ createdAt: "asc" }],
      },
      session: {
        select: {
          parts: {
            select: {
              id: true,
              partType: true,
              properNounSuggestions: {
                select: {
                  id: true,
                  kind: true,
                  rawValue: true,
                  suggestedValue: true,
                  finalValue: true,
                  reason: true,
                  confidence: true,
                  source: true,
                  status: true,
                  spanJson: true,
                  sessionPartId: true,
                },
                orderBy: [{ createdAt: "asc" }],
              },
            },
          },
        },
      },
    },
  });
  if (!conversation) {
    throw new Error("conversation not found");
  }

  const partSuggestions = conversation.session?.parts.flatMap((part) =>
    part.properNounSuggestions.map((suggestion) => ({
      ...suggestion,
      partType: part.partType,
    }))
  ) ?? [];
  const suggestions = partSuggestions.length > 0 ? partSuggestions : conversation.properNounSuggestions;

  return {
    conversationId: conversation.id,
    rawTextOriginal: normalizeRawTranscriptText(conversation.rawTextOriginal),
    reviewedText: normalizeRawTranscriptText(conversation.reviewedText),
    displayText: buildDisplayTranscriptText(conversation.rawTextCleaned || conversation.reviewedText || conversation.rawTextOriginal),
    reviewState: conversation.reviewState,
    qualityMetaJson: conversation.qualityMetaJson,
    suggestions: suggestions.map((suggestion) => ({
      ...suggestion,
      span: parseSpan(suggestion.spanJson),
    })),
  };
}
