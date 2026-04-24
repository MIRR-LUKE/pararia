import { SessionPartStatus, SessionPartType, SessionType } from "@prisma/client";
import { normalizeRawTranscriptText, pickEvidenceTranscriptText } from "@/lib/transcript/source";

type SessionTranscriptPart = {
  partType: SessionPartType;
  status: SessionPartStatus;
  rawTextOriginal?: string | null;
  reviewedText?: string | null;
};

const PART_LABEL: Partial<Record<SessionPartType, string>> = {
  FULL: "面談・通し録音",
  TEXT_NOTE: "補足メモ",
};

function orderForPartType(partType: SessionPartType) {
  if (partType === SessionPartType.FULL) return 0;
  if (partType === SessionPartType.TEXT_NOTE) return 1;
  return 99;
}

export function combineSessionTranscript(
  _sessionType: SessionType,
  parts: SessionTranscriptPart[],
  kind: "raw" | "reviewed"
) {
  return [...parts]
    .filter((part) => part.status === SessionPartStatus.READY)
    .sort((left, right) => orderForPartType(left.partType) - orderForPartType(right.partType))
    .map((part) => {
      const body =
        kind === "reviewed"
          ? pickEvidenceTranscriptText({
              reviewedText: part.reviewedText,
              rawTextOriginal: part.rawTextOriginal,
            })
          : normalizeRawTranscriptText(part.rawTextOriginal);
      if (!body) return null;
      return `## ${PART_LABEL[part.partType] ?? part.partType}\n${body}`;
    })
    .filter((chunk): chunk is string => Boolean(chunk))
    .join("\n\n")
    .trim();
}
