import type { ConversationArtifact } from "./types";
import { parseConversationArtifact } from "./accessor";

export function renderConversationArtifactMarkdown(artifactInput: ConversationArtifact | unknown) {
  const artifact = parseConversationArtifact(artifactInput);
  if (!artifact) return "";

  const lines: string[] = [];
  for (const section of artifact.sections) {
    lines.push(`■ ${section.title}`);
    lines.push(...section.lines);
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function renderConversationArtifactOrFallback(
  artifactInput: ConversationArtifact | unknown,
  fallbackMarkdown?: string | null
) {
  const rendered = renderConversationArtifactMarkdown(artifactInput);
  if (rendered) return rendered;
  return String(fallbackMarkdown ?? "").trim();
}
