import styles from "./StructuredMarkdown.module.css";

type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

type Props = {
  markdown?: string | null;
  emptyMessage?: string;
  className?: string;
};

function normalizeLine(line: string) {
  return line.replace(/\r/g, "").trim();
}

function toBlocks(markdown?: string | null): Block[] {
  const lines = String(markdown ?? "")
    .split("\n")
    .map(normalizeLine);
  const blocks: Block[] = [];
  let paragraphBuffer: string[] = [];
  let listBuffer: string[] = [];

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

  for (const line of lines) {
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^(#{1,6}\s+|■\s*)/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: line.replace(/^(#{1,6}\s+|■\s*)/, "").trim() });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      listBuffer.push(line.replace(/^[-*]\s+/, "").trim());
      continue;
    }

    flushList();
    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.filter((block) => {
    if (block.type === "list") return block.items.length > 0;
    return Boolean(block.text);
  });
}

export function StructuredMarkdown({ markdown, emptyMessage = "まだ生成されていません。", className }: Props) {
  const blocks = toBlocks(markdown);

  if (!blocks.length) {
    return (
      <div className={[styles.root, className].filter(Boolean).join(" ")}>
        <p className={styles.paragraph}>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <h3 key={`${block.type}-${index}-${block.text}`} className={styles.heading}>
              {block.text}
            </h3>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={`${block.type}-${index}`} className={styles.list}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`} className={styles.listItem}>
                  {item}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={`${block.type}-${index}-${block.text}`} className={styles.paragraph}>
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
