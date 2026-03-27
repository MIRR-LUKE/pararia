import { ProperNounKind, ProperNounSuggestionSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { GlossaryCandidate } from "@/lib/transcript/review-types";
import { normalizeTokenText } from "@/lib/transcript/review-shared";

type GlossaryEntryRow = {
  id: string;
  kind: ProperNounKind;
  canonicalValue: string;
  aliasesJson: unknown;
  sendToProvider: boolean;
};

function readAliases(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => normalizeTokenText(entry))
    .filter(Boolean);
}

function pushCandidate(target: GlossaryCandidate[], candidate: GlossaryCandidate) {
  const canonicalValue = normalizeTokenText(candidate.canonicalValue);
  if (!canonicalValue) return;
  const aliases = Array.from(new Set([canonicalValue, ...candidate.aliases.map(normalizeTokenText).filter(Boolean)]));
  target.push({
    ...candidate,
    canonicalValue,
    aliases,
  });
}

export async function loadGlossaryEntries(input: {
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
      sendToProvider: true,
    },
  });
}

export function buildContextGlossaryCandidates(input: {
  studentName?: string | null;
  studentNameKana?: string | null;
  teacherName?: string | null;
  glossaryEntries: GlossaryEntryRow[];
}) {
  const candidates: GlossaryCandidate[] = [];

  if (input.studentName?.trim()) {
    pushCandidate(candidates, {
      canonicalValue: input.studentName.trim(),
      aliases: [input.studentNameKana ?? ""],
      kind: ProperNounKind.STUDENT,
      source: ProperNounSuggestionSource.CONTEXT,
      reasonPrefix: "生徒情報",
      sendToProvider: false,
    });
  }

  if (input.teacherName?.trim()) {
    pushCandidate(candidates, {
      canonicalValue: input.teacherName.trim(),
      aliases: [],
      kind: ProperNounKind.TUTOR,
      source: ProperNounSuggestionSource.CONTEXT,
      reasonPrefix: "担当講師情報",
      sendToProvider: false,
    });
  }

  for (const entry of input.glossaryEntries) {
    pushCandidate(candidates, {
      glossaryEntryId: entry.id,
      canonicalValue: entry.canonicalValue,
      aliases: readAliases(entry.aliasesJson),
      kind: entry.kind,
      source: ProperNounSuggestionSource.GLOSSARY,
      reasonPrefix: "辞書候補",
      sendToProvider: entry.sendToProvider === true,
    });
  }

  return candidates;
}

export async function loadInternalGlossaryCandidates(input: {
  organizationId: string;
  studentId: string;
  tutorUserId?: string | null;
  studentName?: string | null;
  studentNameKana?: string | null;
  teacherName?: string | null;
}) {
  const glossaryEntries = await loadGlossaryEntries(input);
  return buildContextGlossaryCandidates({
    studentName: input.studentName,
    studentNameKana: input.studentNameKana,
    teacherName: input.teacherName,
    glossaryEntries,
  });
}

export async function listProviderHintTerms(input: {
  organizationId: string;
  studentId: string;
  tutorUserId?: string | null;
}) {
  const glossaryEntries = await loadGlossaryEntries(input);
  const terms = glossaryEntries
    .filter((entry) => entry.sendToProvider === true)
    .flatMap((entry) => [entry.canonicalValue, ...readAliases(entry.aliasesJson)])
    .map((entry) => normalizeTokenText(entry))
    .filter(Boolean);

  return Array.from(new Set(terms)).slice(0, 128);
}
