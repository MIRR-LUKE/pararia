import type { ConversationArtifactEntry } from "./types";
import { classifyActionType } from "./schema";

export function splitActionEntries(entries: ConversationArtifactEntry[]) {
  const assessment: ConversationArtifactEntry[] = [];
  const nextChecks: ConversationArtifactEntry[] = [];
  for (const entry of entries) {
    const actionType = classifyActionType(entry.text, entry.actionType);
    if (actionType === "nextCheck") {
      nextChecks.push({ ...entry, actionType });
    } else {
      assessment.push({ ...entry, actionType });
    }
  }
  return { assessment, nextChecks };
}
