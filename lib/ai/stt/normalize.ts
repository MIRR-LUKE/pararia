import { normalizeRawTranscriptText } from "@/lib/transcript/source";
import type {
  TranscriptQualityWarning,
  TranscriptSegment,
  WorkerSegment,
  WorkerSuccessResponse,
} from "./types";

export type NormalizedSegmentsResult = {
  segments: TranscriptSegment[];
  qualityWarnings: TranscriptQualityWarning[];
};

export function normalizeSegmentText(text: unknown) {
  return typeof text === "string" ? text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() : "";
}

export function comparableSegmentText(text: string) {
  return text.replace(/[\s、。,，．！？!?\-ー〜～]/g, "");
}

export function joinSegmentText(left: string, right: string) {
  if (!left) return right;
  if (!right) return left;
  if (/[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)) {
    return `${left} ${right}`.trim();
  }
  return `${left}${right}`.trim();
}

export function buildRawTextFromSegments(segments: TranscriptSegment[]) {
  return segments
    .map((segment) => normalizeSegmentText(segment.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function normalizeSegments(data: {
  segments?: WorkerSegment[];
}): NormalizedSegmentsResult {
  if (!Array.isArray(data.segments)) {
    return {
      segments: [],
      qualityWarnings: [],
    };
  }

  const mapped = data.segments
    .map((segment, index) => ({
      id:
        typeof segment.id === "number" || typeof segment.id === "string"
          ? segment.id
          : index,
      start: typeof segment.start === "number" ? segment.start : undefined,
      end: typeof segment.end === "number" ? segment.end : undefined,
      text: normalizeSegmentText(segment.text),
    }))
    .filter((segment) => Boolean(segment.text));

  const merged: TranscriptSegment[] = [];
  let removedDuplicateCount = 0;

  for (const current of mapped) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(current);
      continue;
    }

    const previousComparable = comparableSegmentText(previous.text ?? "");
    const currentComparable = comparableSegmentText(current.text ?? "");
    const gap =
      typeof previous.end === "number" && typeof current.start === "number"
        ? current.start - previous.end
        : null;
    const exactDuplicate =
      previousComparable.length > 0 &&
      previousComparable === currentComparable &&
      (gap === null || gap <= 1.2);
    const overlapDuplicate =
      previousComparable.length > 8 &&
      currentComparable.length > 8 &&
      (previousComparable.includes(currentComparable) || currentComparable.includes(previousComparable)) &&
      (gap === null || gap <= 0.8);
    const shortContinuation =
      gap !== null &&
      gap >= 0 &&
      gap <= 0.35 &&
      currentComparable.length > 0 &&
      currentComparable.length <= 12 &&
      !/[。！？!?]$/.test(previous.text ?? "");

    if (exactDuplicate || overlapDuplicate) {
      const richerText =
        (current.text?.length ?? 0) > (previous.text?.length ?? 0) ? current.text : previous.text;
      merged[merged.length - 1] = {
        ...previous,
        end: typeof current.end === "number" ? current.end : previous.end,
        text: richerText,
      };
      removedDuplicateCount += 1;
      continue;
    }

    if (shortContinuation) {
      merged[merged.length - 1] = {
        ...previous,
        end: typeof current.end === "number" ? current.end : previous.end,
        text: joinSegmentText(previous.text ?? "", current.text ?? ""),
      };
      continue;
    }

    merged.push(current);
  }

  const shortSegmentRatio =
    merged.length > 0
      ? merged.filter((segment) => comparableSegmentText(segment.text ?? "").length <= 4).length /
        merged.length
      : 0;

  const qualityWarnings: TranscriptQualityWarning[] = [];
  if (shortSegmentRatio >= 0.55 && merged.length >= 8) qualityWarnings.push("too_many_short_segments");
  if (removedDuplicateCount > 0) qualityWarnings.push("adjacent_duplicates_removed");

  return {
    segments: merged,
    qualityWarnings,
  };
}

export function buildRawTranscriptText(
  responses: Array<Pick<WorkerSuccessResponse, "text">>,
  segments: TranscriptSegment[]
) {
  const fromResponses = normalizeRawTranscriptText(
    responses
      .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
      .filter(Boolean)
      .join("\n")
  );
  return fromResponses || normalizeRawTranscriptText(buildRawTextFromSegments(segments));
}
