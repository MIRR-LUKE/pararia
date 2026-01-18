type WhisperSegment = {
  id?: number;
  seek?: number;
  start?: number;
  end?: number;
  text?: string;
};

export type PreprocessResult = {
  rawTextOriginal: string;
  rawTextCleaned: string;
  // sentence-ish chunks (not perfect; used for lightweight downstream prompts if needed)
  chunks: string[];
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

export function preprocessTranscript(rawTextOriginal: string): PreprocessResult {
  const normalized = normalizeJa(rawTextOriginal);
  const noFillers = removeFillers(normalized);
  const dedupedLines = dedupeAdjacentLines(noFillers);
  const chunks = dedupeChunkNearDuplicates(chunkByPunctuation(dedupedLines));
  const rawTextCleaned = normalizeJa(chunks.join("\n"));
  return { rawTextOriginal: normalized, rawTextCleaned, chunks };
}

export function segmentsToText(segments: WhisperSegment[] | undefined | null) {
  if (!segments?.length) return "";
  return segments
    .map((s) => (s?.text ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}



