export type ArtifactSessionType = "INTERVIEW" | "LESSON_REPORT";
export type ArtifactSectionKey = "basic_info" | "summary" | "details" | "actions" | "share" | "unknown";
export type ClaimType = "observed" | "inferred" | "missing";
export type ActionType = "assessment" | "nextCheck";

// Persisted JSON section for artifactJson.
export type ConversationArtifactSection = {
  key: ArtifactSectionKey;
  title: string;
  lines: string[];
};

// Persisted JSON entry for artifactJson.
export type ConversationArtifactEntry = {
  text: string;
  evidence: string[];
  sourceSectionKey?: Exclude<ArtifactSectionKey, "unknown">;
  basis?: string;
  humanCheckNeeded?: boolean;
  confidence?: "low" | "medium" | "high";
  claimType?: ClaimType;
  actionType?: ActionType;
};

export type ConversationArtifact = {
  version: "conversation-artifact/v1";
  sessionType: ArtifactSessionType;
  generatedAt: string;
  summary: ConversationArtifactEntry[];
  claims: ConversationArtifactEntry[];
  nextActions: ConversationArtifactEntry[];
  sharePoints: ConversationArtifactEntry[];
  facts: string[];
  changes: string[];
  assessment: string[];
  nextChecks: string[];
  sections: ConversationArtifactSection[];
};
