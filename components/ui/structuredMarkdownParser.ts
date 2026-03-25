export type StructuredBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "meta"; items: Array<{ label: string; value: string }> }
  | { type: "dialogue"; speaker: string; text: string };

function normalizeLine(line: string) {
  return line.replace(/\r/g, "").trim();
}

function parseDialogueLine(line: string) {
  const boldMatch = line.match(/^\*\*(.+?)\*\*[：:]\s*(.+)$/);
  if (boldMatch) {
    const speaker = boldMatch[1]?.trim();
    const text = boldMatch[2]?.trim();
    if (speaker && text) return { speaker, text };
  }

  const plainMatch = line.match(/^((?:講師|生徒|話者不明)|(?:[^:：\n]{1,16}(?:先生|さん|様|君|くん)))[：:]\s*(.+)$/);
  if (plainMatch) {
    const speaker = plainMatch[1]?.trim();
    const text = plainMatch[2]?.trim();
    if (speaker && text) return { speaker, text };
  }

  return null;
}

function parseMetaLine(line: string) {
  const normalized = line.replace(/^[•・]\s*/, "");
  const match = normalized.match(/^([^:：\n]{1,24})[：:]\s*(.+)$/);
  if (!match) return null;
  const label = match[1]?.trim();
  const value = match[2]?.trim();
  if (!label || !value) return null;
  if (parseDialogueLine(normalized)) return null;
  return { label, value };
}

export function parseStructuredMarkdown(markdown?: string | null): StructuredBlock[] {
  const lines = String(markdown ?? "")
    .split("\n")
    .map(normalizeLine);
  const blocks: StructuredBlock[] = [];
  let paragraphBuffer: string[] = [];
  let listBuffer: string[] = [];
  let metaBuffer: Array<{ label: string; value: string }> = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    blocks.push({ type: "paragraph", text: paragraphBuffer.join("\n").trim() });
    paragraphBuffer = [];
  };

  const flushList = () => {
    if (!listBuffer.length) return;
    blocks.push({ type: "list", items: listBuffer });
    listBuffer = [];
  };

  const flushMeta = () => {
    if (!metaBuffer.length) return;
    blocks.push({ type: "meta", items: metaBuffer });
    metaBuffer = [];
  };

  for (const line of lines) {
    if (!line) {
      flushParagraph();
      flushList();
      flushMeta();
      continue;
    }

    if (/^【/.test(line)) {
      flushParagraph();
      flushList();
      flushMeta();
      blocks.push({ type: "heading", text: line });
      continue;
    }

    if (/^(#{1,6}\s+|■\s*)/.test(line)) {
      flushParagraph();
      flushList();
      flushMeta();
      blocks.push({ type: "heading", text: line.replace(/^(#{1,6}\s+|■\s*)/, "").trim() });
      continue;
    }

    const dialogue = parseDialogueLine(line);
    if (dialogue) {
      flushParagraph();
      flushList();
      flushMeta();
      blocks.push({ type: "dialogue", speaker: dialogue.speaker, text: dialogue.text });
      continue;
    }

    const meta = parseMetaLine(line);
    if (meta) {
      flushParagraph();
      flushList();
      metaBuffer.push(meta);
      continue;
    }

    if (/^[•・*\-]\s+/.test(line)) {
      flushParagraph();
      flushMeta();
      listBuffer.push(line.replace(/^[•・*\-]\s+/, "").trim());
      continue;
    }

    flushList();
    flushMeta();
    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushList();
  flushMeta();

  return blocks.filter((block) => {
    if (block.type === "list") return block.items.length > 0;
    if (block.type === "meta") return block.items.length > 0;
    return Boolean(block.text);
  });
}
