import { SessionPartStatus, SessionPartType, SessionType } from "@prisma/client";
import { normalizeRawTranscriptText, pickEvidenceTranscriptText } from "@/lib/transcript/source";

type SessionTranscriptPart = {
  partType: SessionPartType;
  status: SessionPartStatus;
  rawTextOriginal?: string | null;
  reviewedText?: string | null;
};

const PART_LABEL: Record<SessionPartType, string> = {
  FULL: "面談・通し録音",
  CHECK_IN: "授業前チェックイン",
  CHECK_OUT: "授業後チェックアウト",
  TEXT_NOTE: "補足メモ",
};

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

export function combineSessionTranscript(
  sessionType: SessionType,
  parts: SessionTranscriptPart[],
  kind: "raw" | "reviewed"
) {
  const order = orderForSessionType(sessionType);

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
      return `## ${PART_LABEL[part.partType]}\n${body}`;
    })
    .filter((chunk): chunk is string => Boolean(chunk))
    .join("\n\n")
    .trim();
}
