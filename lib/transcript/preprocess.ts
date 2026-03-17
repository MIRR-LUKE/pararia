import { createHash } from "crypto";

type WhisperSegment = {
  id?: number | string;
  seek?: number;
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
};

export type PreprocessResult = {
  rawTextOriginal: string;
  rawTextCleaned: string;
  // sentence-ish chunks (not perfect; used for lightweight downstream prompts if needed)
  chunks: string[];
  // merged blocks for chunk-based LLM processing
  blocks: Array<{ index: number; text: string; approxTokens: number; hash: string }>;
};

const DEFAULT_FILLERS = [
  "えー",
  "ええ",
  "えっと",
  "あの",
  "その",
  "そのー",
  "なんか",
  "まあ",
  "ていうか",
  "というか",
  "えーと",
  "うーん",
  "うん",
  "うーんと",
];

function normalizeJa(text: string) {
  return (
    text
      // unify whitespace
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function removeFillers(text: string) {
  // Remove standalone fillers surrounded by punctuation/whitespace.
  const fillers = DEFAULT_FILLERS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // Example: "えっと、" / "（えー）" / " なんか "
  const re = new RegExp(
    `(^|[\\s、。,，．\\n「」『』（）()【】\\[\\]{}<>])(?:${fillers})(?=([\\s、。,，．\\n「」『』（）()【】\\[\\]{}<>]|$))`,
    "g"
  );
  return text.replace(re, "$1").replace(/[ \t]+/g, " ");
}

function dedupeAdjacentLines(text: string) {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (out.length && out[out.length - 1] === t) continue;
    out.push(t);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function chunkByPunctuation(text: string) {
  // Lightweight sentence-ish chunking for Japanese.
  // Split on 。！？ plus newline boundaries; keep them.
  const parts: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (ch === "。" || ch === "！" || ch === "？" || ch === "\n") {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = "";
    }
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  // merge very short chunks into previous
  const merged: string[] = [];
  for (const p of parts) {
    if (merged.length && p.replace(/\s/g, "").length < 8) {
      merged[merged.length - 1] = (merged[merged.length - 1] + " " + p).trim();
    } else {
      merged.push(p);
    }
  }
  return merged;
}

function dedupeChunkNearDuplicates(chunks: string[]) {
  // remove immediate near-duplicates (common in STT for overlaps)
  const out: string[] = [];
  for (const c of chunks) {
    const t = c.trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    if (prev) {
      const a = prev.replace(/\s/g, "");
      const b = t.replace(/\s/g, "");
      if (a === b) continue;
      // If one contains the other and difference is tiny, drop the shorter.
      if (a.length > 20 && (a.includes(b) || b.includes(a))) {
        const longer = a.length >= b.length ? prev : t;
        out[out.length - 1] = longer;
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

const TOPIC_BOUNDARY_PATTERNS = [
  /^ところで/,
  /^では/,
  /^じゃあ/,
  /^それでは/,
  /^それじゃ/,
  /^それから/,
  /^次に/,
  /^あとで/,
  /^ちなみに/,
  /^話を戻すと/,
  /^本題に戻ると/,
];

function estimateTokens(text: string) {
  // Rough estimate for Japanese: 1 token ~= 2 chars
  return Math.ceil(text.length / 2);
}

function hashText(text: string) {
  // Use a short stable hash for diffing
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function splitByTopicBoundaries(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const segments: string[] = [];
  for (const para of paragraphs) {
    const lines = para.split(/\n/).map((l) => l.trim()).filter(Boolean);
    let buffer = "";
    for (const line of lines) {
      const isBoundary = TOPIC_BOUNDARY_PATTERNS.some((re) => re.test(line));
      if (isBoundary && buffer) {
        segments.push(buffer.trim());
        buffer = line;
      } else {
        buffer = buffer ? `${buffer}\n${line}` : line;
      }
    }
    if (buffer.trim()) segments.push(buffer.trim());
  }
  return segments;
}

function buildBlocks(segments: string[], maxTokens = 4200, targetMin = 2600) {
  const blocks: Array<{ index: number; text: string; approxTokens: number; hash: string }> = [];
  let buffer: string[] = [];
  let tokenCount = 0;
  let index = 0;

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join("\n").trim();
    if (!text) return;
    blocks.push({ index, text, approxTokens: estimateTokens(text), hash: hashText(text) });
    index += 1;
    buffer = [];
    tokenCount = 0;
  };

  for (const seg of segments) {
    const segTokens = estimateTokens(seg);
    if (!buffer.length) {
      buffer.push(seg);
      tokenCount = segTokens;
      continue;
    }
    if (tokenCount + segTokens > maxTokens) {
      flush();
      buffer.push(seg);
      tokenCount = segTokens;
      continue;
    }
    buffer.push(seg);
    tokenCount += segTokens;
    if (tokenCount >= targetMin) {
      flush();
    }
  }
  flush();
  return blocks;
}

export function preprocessTranscript(rawTextOriginal: string): PreprocessResult {
  const normalized = normalizeJa(rawTextOriginal);
  const noFillers = removeFillers(normalized);
  const dedupedLines = dedupeAdjacentLines(noFillers);
  const chunks = dedupeChunkNearDuplicates(chunkByPunctuation(dedupedLines));
  const rawTextCleaned = normalizeJa(chunks.join("\n"));
  const topicSegments = splitByTopicBoundaries(rawTextCleaned);
  const blocks = buildBlocks(topicSegments);
  return { rawTextOriginal: normalized, rawTextCleaned, chunks, blocks };
}

function buildTimingSegments(
  segments: WhisperSegment[],
  opts: { silenceGap?: number; maxWindow?: number; minWindow?: number }
) {
  const silenceGap = opts.silenceGap ?? 1.2;
  const maxWindow = opts.maxWindow ?? 75;
  const minWindow = opts.minWindow ?? 45;
  const buffers: string[] = [];
  let buffer: string[] = [];
  let startTime: number | null = null;
  let lastEnd: number | null = null;

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join("\n").trim();
    if (text) buffers.push(text);
    buffer = [];
    startTime = null;
    lastEnd = null;
  };

  for (const seg of segments) {
    const textRaw = (seg.text ?? "").trim();
    if (!textRaw) continue;
    const cleaned = removeFillers(textRaw).trim();
    if (!cleaned) continue;
    const segStart = typeof seg.start === "number" ? seg.start : null;
    const segEnd = typeof seg.end === "number" ? seg.end : segStart;

    if (startTime === null && segStart !== null) startTime = segStart;

    if (lastEnd !== null && segStart !== null) {
      const gap = segStart - lastEnd;
      const elapsed = startTime !== null ? segStart - startTime : 0;
      if (gap >= silenceGap && elapsed >= minWindow) {
        flush();
      }
      if (elapsed >= maxWindow) {
        flush();
      }
    }

    if (startTime === null && segStart !== null) startTime = segStart;

    buffer.push(cleaned);
    if (segEnd !== null) lastEnd = segEnd;
  }

  flush();
  return buffers;
}

export function preprocessTranscriptWithSegments(
  rawTextOriginal: string,
  segments: WhisperSegment[] | null | undefined
): PreprocessResult {
  if (!segments?.length) {
    return preprocessTranscript(rawTextOriginal);
  }
  const normalized = normalizeJa(rawTextOriginal);
  const noFillers = removeFillers(normalized);
  const dedupedLines = dedupeAdjacentLines(noFillers);
  const chunks = dedupeChunkNearDuplicates(chunkByPunctuation(dedupedLines));
  const rawTextCleaned = normalizeJa(chunks.join("\n"));
  const timingSegments = buildTimingSegments(segments, {});
  const blocks = buildBlocks(timingSegments.length ? timingSegments : splitByTopicBoundaries(rawTextCleaned));
  return { rawTextOriginal: normalized, rawTextCleaned, chunks, blocks };
}

export function segmentsToText(segments: WhisperSegment[] | undefined | null) {
  if (!segments?.length) return "";
  return segments
    .map((s) => (s?.text ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}
