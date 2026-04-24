import {
  buildConversationArtifactFromMarkdown,
  parseConversationArtifact,
} from "@/lib/conversation-artifact";
import { sanitizeSummaryMarkdown } from "@/lib/user-facing-japanese";

export type EditableConversationSessionType = "INTERVIEW";

export const UNSAVED_CONVERSATION_SUMMARY_MESSAGE =
  "未保存の本文編集があります。保存せずに離れると変更は失われます。よろしいですか？";

export function normalizeEditableConversationSummary(value?: string | null) {
  return sanitizeSummaryMarkdown(value ?? "").trim();
}

export function hasEditableConversationSummaryChanges(saved?: string | null, draft?: string | null) {
  return normalizeEditableConversationSummary(saved) !== normalizeEditableConversationSummary(draft);
}

export function buildConversationSummaryEditPayload(input: {
  sessionType: EditableConversationSessionType;
  summaryMarkdown?: string | null;
}) {
  const summaryMarkdown = normalizeEditableConversationSummary(input.summaryMarkdown);
  if (!summaryMarkdown) {
    return {
      summaryMarkdown: "",
      artifactJson: null,
    };
  }

  const artifact = buildConversationArtifactFromMarkdown({
    sessionType: input.sessionType,
    summaryMarkdown,
  });

  return {
    summaryMarkdown,
    artifactJson: parseConversationArtifact(artifact),
  };
}
