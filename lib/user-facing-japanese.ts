type TopicSuggestion = {
  category: string;
  title: string;
  reason: string;
  question: string;
  priority: number;
};

type QuickQuestion = {
  category: string;
  question: string;
  reason: string;
};

function normalizeWhitespace(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripMarkdown(text: string) {
  return text
    .replace(/^#+\s*/gm, "")
    .replace(/^[>*-]\s*/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countJapaneseChars(text: string) {
  return (text.match(/[ぁ-んァ-ヶ一-龠]/g) ?? []).length;
}

const JAPANESE_SCRIPT_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々ー]/u;
const UNICODE_LETTER_RE = /\p{Letter}/u;
const LATIN_RUN_RE = /\p{Script=Latin}[\p{Script=Latin}\p{Number}'._/-]*/gu;

function countForeignLetters(text: string) {
  let count = 0;
  for (const char of text) {
    if (UNICODE_LETTER_RE.test(char) && !JAPANESE_SCRIPT_CHAR_RE.test(char)) {
      count += 1;
    }
  }
  return count;
}

function stripLatinRuns(text: string) {
  return text.replace(LATIN_RUN_RE, " ");
}

function stripNonJapaneseLetters(text: string) {
  let out = "";
  for (const char of text) {
    if (!UNICODE_LETTER_RE.test(char) || JAPANESE_SCRIPT_CHAR_RE.test(char)) {
      out += char;
    } else {
      out += " ";
    }
  }
  return out;
}

function cleanupTranscriptLine(text: string) {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([、。，．！？!?:：;；）)】\]」』])/g, "$1")
    .replace(/([（(【\[「『])\s+/g, "$1")
    .replace(/^[、。，．！？!?:：;；・\-ー\s]+/g, "")
    .replace(/^(と|が|を|に|で|は|へ|も)\s+/g, "")
    .replace(/[、。，．！？!?:：;；・\s]+$/g, "")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

export function sanitizeTranscriptLine(value: unknown) {
  const source = normalizeWhitespace(value);
  if (!source) return "";

  const japaneseChars = countJapaneseChars(source);
  const foreignLetters = countForeignLetters(source);

  if (foreignLetters > 0 && japaneseChars === 0) {
    return "";
  }
  if (foreignLetters >= Math.max(12, japaneseChars * 2)) {
    return "";
  }

  const stripped = cleanupTranscriptLine(stripNonJapaneseLetters(stripLatinRuns(source)));
  const strippedJapaneseChars = countJapaneseChars(stripped);
  if (strippedJapaneseChars === 0) return "";
  if (strippedJapaneseChars < 3 && stripped.length < 8) return "";
  return stripped;
}

function sanitizeTranscriptHeading(line: string) {
  const heading = line.replace(/^##\s+/, "").trim();
  return countJapaneseChars(heading) > 0 ? `## ${heading}` : "";
}

export function sanitizeTranscriptText(text: unknown) {
  const source = String(text ?? "").replace(/\r/g, "").trim();
  if (!source) return "";
  const lines = source.split("\n");
  const out: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      const heading = sanitizeTranscriptHeading(trimmed);
      if (heading) out.push(heading);
      continue;
    }
    const cleaned = sanitizeTranscriptLine(trimmed);
    if (cleaned) out.push(cleaned);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function sanitizeFormattedTranscript(markdown: unknown) {
  const source = String(markdown ?? "").replace(/\r/g, "").trim();
  if (!source) return "";
  const out: string[] = [];

  for (const rawLine of source.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }

    if (/^##\s+/.test(trimmed)) {
      const heading = sanitizeTranscriptHeading(trimmed);
      if (heading) out.push(heading);
      continue;
    }

    const speakerMatch = trimmed.match(/^(\*\*[^*]+\*\*:\s*)(.*)$/);
    if (speakerMatch) {
      const body = sanitizeTranscriptLine(speakerMatch[2]);
      if (body) out.push(`${speakerMatch[1]}${body}`);
      continue;
    }

    const cleaned = sanitizeTranscriptLine(trimmed);
    if (cleaned) out.push(cleaned);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function sanitizeTranscriptSegments<T extends { text?: string | null }>(segments: T[] | null | undefined): T[] {
  if (!Array.isArray(segments)) return [];
  const out: T[] = [];
  for (const segment of segments) {
    const cleaned = sanitizeTranscriptLine(segment?.text ?? "");
    if (!cleaned) continue;
    out.push({
      ...segment,
      text: cleaned,
    } as T);
  }
  return out;
}

function countEnglishWords(text: string) {
  return (text.match(/\b[A-Za-z][A-Za-z'/-]{2,}\b/g) ?? []).length;
}

export function isJapanesePrimaryText(value: unknown) {
  const normalized = normalizeWhitespace(stripMarkdown(String(value ?? "")));
  if (!normalized) return false;
  const japaneseChars = countJapaneseChars(normalized);
  const latinChars = (normalized.match(/[A-Za-z]/g) ?? []).length;
  const englishWords = countEnglishWords(normalized);
  if (japaneseChars === 0) return false;
  if (englishWords >= 4) return false;
  if (latinChars >= Math.max(18, japaneseChars)) return false;
  return true;
}

function sanitizeLine(value: unknown, maxLength: number) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";
  const sliced = normalized.slice(0, maxLength).trim();
  if (!sliced) return "";
  return isJapanesePrimaryText(sliced) ? sliced : "";
}

function toJapaneseCategory(value: unknown) {
  const text = normalizeWhitespace(value);
  if (!text) return "学習";
  const lowered = text.toLowerCase();
  if (text === "学習" || lowered === "study" || lowered === "learning") return "学習";
  if (text === "生活" || lowered === "life") return "生活";
  if (text === "学校" || lowered === "school") return "学校";
  if (text === "進路" || lowered === "career" || lowered === "future") return "進路";
  return "学習";
}

function extractJapaneseMarkdown(markdown: unknown) {
  const text = String(markdown ?? "").replace(/\r/g, "").trim();
  if (!text) return "";
  const blocks = text.split(/\n\s*\n/g).map((block) => block.trim()).filter(Boolean);
  const keptBlocks = blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const keptLines = lines
        .map((line) => {
          if (/^#+\s*/.test(line)) {
            const heading = line.replace(/^#+\s*/, "").trim();
            return isJapanesePrimaryText(heading) ? `## ${heading}` : "";
          }
          return isJapanesePrimaryText(line) ? line : "";
        })
        .filter(Boolean);
      return keptLines.join("\n").trim();
    })
    .filter(Boolean);
  return keptBlocks.join("\n\n").trim();
}

export function sanitizeSummaryMarkdown(markdown: unknown) {
  const cleaned = extractJapaneseMarkdown(markdown);
  if (cleaned) return cleaned;
  return String(markdown ?? "").trim()
    ? "## 要再生成\nこのログは旧仕様の英語混在データです。日本語版へ再生成してください。"
    : "";
}

export function sanitizeReportMarkdown(markdown: unknown) {
  const cleaned = extractJapaneseMarkdown(markdown);
  if (cleaned) return cleaned;
  return String(markdown ?? "").trim()
    ? "## 要再生成\nこのレポートは旧仕様の英語混在データです。日本語版へ再生成してください。"
    : "";
}

export function sanitizeReportMarkdownForReuse(markdown: unknown) {
  return extractJapaneseMarkdown(markdown);
}

export function sanitizeTopicSuggestions(items: unknown): TopicSuggestion[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => ({
      category: toJapaneseCategory((item as any)?.category),
      title: sanitizeLine((item as any)?.title, 56),
      reason: sanitizeLine((item as any)?.reason, 140),
      question: sanitizeLine((item as any)?.question, 100),
      priority: Math.max(1, Math.min(7, Number((item as any)?.priority ?? index + 1))),
    }))
    .filter((item) => item.title && item.question)
    .slice(0, 7);
}

export function sanitizeQuickQuestions(items: unknown): QuickQuestion[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      category: toJapaneseCategory((item as any)?.category),
      question: sanitizeLine((item as any)?.question, 100),
      reason: sanitizeLine((item as any)?.reason, 140),
    }))
    .filter((item) => item.question)
    .slice(0, 6);
}
