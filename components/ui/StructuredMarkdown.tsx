import type { ReactNode } from "react";
import { parseStructuredMarkdown } from "./structuredMarkdownParser";
import styles from "./StructuredMarkdown.module.css";

type Props = {
  markdown?: string | null;
  emptyMessage?: string;
  className?: string;
};

function renderInline(text: string): ReactNode[] {
  return String(text ?? "")
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return (
          <strong key={`${part}-${index}`} className={styles.strong}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
}

export function StructuredMarkdown({ markdown, emptyMessage = "まだ生成されていません。", className }: Props) {
  const blocks = parseStructuredMarkdown(markdown);

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
              {renderInline(block.text)}
            </h3>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={`${block.type}-${index}`} className={styles.list}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`} className={styles.listItem}>
                  {renderInline(item)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "meta") {
          return (
            <div key={`${block.type}-${index}`} className={styles.metaGrid}>
              {block.items.map((item, itemIndex) => (
                <div key={`${item.label}-${itemIndex}`} className={styles.metaItem}>
                  <span className={styles.metaLabel}>{item.label}</span>
                  <p className={styles.metaValue}>{renderInline(item.value)}</p>
                </div>
              ))}
            </div>
          );
        }

        if (block.type === "dialogue") {
          return (
            <div key={`${block.type}-${index}-${block.speaker}`} className={styles.dialogueRow}>
              <span className={styles.dialogueSpeaker}>{block.speaker}</span>
              <p className={styles.dialogueText}>{renderInline(block.text)}</p>
            </div>
          );
        }

        return (
          <p key={`${block.type}-${index}-${block.text}`} className={styles.paragraph}>
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}
