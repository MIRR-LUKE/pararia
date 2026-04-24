import type {
  ArtifactSectionKey,
  ArtifactSessionType,
  ConversationArtifact,
  ConversationArtifactEntry,
  ConversationArtifactSection,
} from "./types";
import {
  dedupeLines,
  formatActionPrefix,
  formatClaimPrefix,
  isSectionKey,
  normalizeActionType,
  normalizeClaimType,
  normalizeHeading,
  normalizeText,
  parseBooleanish,
  parseTypedEntryPrefix,
  stripBulletPrefix,
  titleMapForSessionType,
} from "./schema";
import { splitActionEntries } from "./trace";

function normalizeEntryEntry(entry: ConversationArtifactEntry) {
  return {
    ...entry,
    text: normalizeText(entry.text),
    evidence: dedupeLines(entry.evidence),
    basis: typeof entry.basis === "string" ? normalizeText(entry.basis) : undefined,
    humanCheckNeeded: entry.humanCheckNeeded === true,
    claimType: normalizeClaimType(entry.claimType),
    actionType: normalizeActionType(entry.actionType),
    confidence:
      entry.confidence === "low" || entry.confidence === "medium" || entry.confidence === "high"
        ? entry.confidence
        : undefined,
  };
}

function dedupeEntries(entries: ConversationArtifactEntry[]) {
  const seen = new Set<string>();
  const result: ConversationArtifactEntry[] = [];
  for (const entry of entries) {
    const normalized = normalizeEntryEntry(entry);
    if (!normalized.text) continue;
    const key = [
      normalized.sourceSectionKey ?? "unknown",
      normalized.text.replace(/[。．！？\s]/g, ""),
      normalized.evidence.join("|").replace(/[。．！？\s]/g, ""),
      normalized.basis ?? "",
      normalized.humanCheckNeeded ? "1" : "0",
      normalized.claimType ?? "",
      normalized.actionType ?? "",
      normalized.confidence ?? "",
    ].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function parseInlineEvidence(line: string) {
  const match = line.match(/^(.*?)(?:\s*[（(](?:根拠|evidence|basis|source)[:：]\s*(.+?)[)）])$/);
  if (!match) return null;
  const text = normalizeText(match[1]);
  const evidence = normalizeText(match[2]);
  if (!text || !evidence) return null;
  return { text, evidence: [evidence] };
}

function parseMetaLine(line: string) {
  const normalized = normalizeText(line);
  const evidenceMatch = normalized.match(/^(?:根拠|evidence|source)[:：]\s*(.+)$/i);
  if (evidenceMatch) {
    return { kind: "evidence" as const, value: normalizeText(evidenceMatch[1]) };
  }
  const basisMatch = normalized.match(/^(?:basis|理由)[:：]\s*(.+)$/i);
  if (basisMatch) {
    return { kind: "basis" as const, value: normalizeText(basisMatch[1]) };
  }
  const humanCheckMatch = normalized.match(/^(?:humanCheckNeeded|人手確認要|人手確認必要)[:：]\s*(.+)$/i);
  if (humanCheckMatch) {
    return { kind: "humanCheckNeeded" as const, value: normalizeText(humanCheckMatch[1]) };
  }
  const confidenceMatch = normalized.match(/^(?:confidence|確度)[:：]\s*(low|medium|high|低|中|高)\s*$/i);
  if (confidenceMatch) {
    const raw = normalizeText(confidenceMatch[1]).toLowerCase();
    const confidence =
      raw === "高" ? "high" : raw === "中" ? "medium" : raw === "低" ? "low" : (raw as "low" | "medium" | "high");
    return { kind: "confidence" as const, value: confidence };
  }
  return null;
}

function parseSectionEntries(lines: string[], sourceSectionKey: Exclude<ArtifactSectionKey, "unknown">) {
  const entries: ConversationArtifactEntry[] = [];
  let current: ConversationArtifactEntry | null = null;

  for (const rawLine of lines) {
    const trimmed = normalizeText(rawLine);
    if (!trimmed) continue;

    const line = stripBulletPrefix(trimmed);
    if (!line) continue;

    if (/^【.+】$/.test(line)) continue;
    if (/^[^:：]{1,24}[:：]$/.test(line)) continue;

    const meta = parseMetaLine(line);
    if (meta && current) {
      if (meta.kind === "evidence") {
        current.evidence.push(meta.value);
      } else if (meta.kind === "basis") {
        current.basis = meta.value;
      } else if (meta.kind === "humanCheckNeeded") {
        current.humanCheckNeeded = parseBooleanish(meta.value);
      } else if (meta.kind === "confidence") {
        current.confidence = meta.value as ConversationArtifactEntry["confidence"];
      }
      continue;
    }

    const typed = parseTypedEntryPrefix(line);
    const inline = parseInlineEvidence(typed?.value ?? line);
    const text = normalizeText(inline?.text ?? typed?.value ?? line);
    if (!text) continue;

    const nextEntry: ConversationArtifactEntry = {
      text,
      evidence: inline?.evidence ? [...inline.evidence] : [],
      sourceSectionKey,
      claimType: normalizeClaimType(typed?.claimType),
      actionType: normalizeActionType(typed?.actionType),
    };
    if (sourceSectionKey === "summary") nextEntry.basis = undefined;
    current = nextEntry;
    entries.push(nextEntry);
  }

  return dedupeEntries(entries);
}

function parseMarkdownSections(markdown?: string | null) {
  const titleMap = titleMapForSessionType();
  const sections: ConversationArtifactSection[] = [];
  let current: ConversationArtifactSection | null = null;

  for (const rawLine of String(markdown ?? "").replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("■ ") || line.startsWith("## ")) {
      const title = normalizeHeading(line.slice(2));
      const key =
        (Object.entries(titleMap).find(([, aliases]) =>
          aliases.some((alias) => normalizeHeading(alias) === title)
        )?.[0] as ArtifactSectionKey | undefined) ?? "unknown";

      current = {
        key,
        title,
        lines: [],
      };
      sections.push(current);
      continue;
    }

    if (!current) continue;
    current.lines.push(line);
  }

  return sections;
}

function sectionsByKey(sections: ConversationArtifactSection[], key: ArtifactSectionKey) {
  return sections.filter((section) => section.key === key);
}

function collectSectionEntries(sections: ConversationArtifactSection[], key: Exclude<ArtifactSectionKey, "unknown">) {
  return dedupeEntries(sectionsByKey(sections, key).flatMap((section) => parseSectionEntries(section.lines, key)));
}

function collectInterviewNextCheckEntries(sections: ConversationArtifactSection[]) {
  return dedupeEntries(
    sectionsByKey(sections, "unknown").flatMap((section) =>
      parseSectionEntries(section.lines, "actions").map((entry) => ({
        ...entry,
        actionType: "nextCheck" as const,
      }))
    )
  );
}

function collectEntryTexts(entries: ConversationArtifactEntry[], limit = 8) {
  return dedupeLines(entries.map((entry) => entry.text)).slice(0, limit);
}

function entriesFromTextArray(values: unknown, sourceSectionKey: Exclude<ArtifactSectionKey, "unknown">): ConversationArtifactEntry[] {
  if (!Array.isArray(values)) return [];
  const mapped: Array<ConversationArtifactEntry | null> = values.map((item) => {
    if (typeof item === "string") {
      const text = normalizeText(item);
      if (!text) return null;
      return {
        text,
        evidence: [],
        sourceSectionKey,
      };
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const current = item as Record<string, unknown>;
    const text = typeof current.text === "string" ? normalizeText(current.text) : "";
    if (!text) return null;
    const evidence = Array.isArray(current.evidence)
      ? current.evidence.filter((line): line is string => typeof line === "string").map(normalizeText)
      : [];
    const basis = typeof current.basis === "string" ? normalizeText(current.basis) : undefined;
    const humanCheckNeeded = typeof current.humanCheckNeeded === "boolean" ? current.humanCheckNeeded : undefined;
    const claimType = normalizeClaimType(current.claimType);
    const actionType = normalizeActionType(current.actionType);
    const confidence =
      current.confidence === "low" || current.confidence === "medium" || current.confidence === "high"
        ? current.confidence
        : undefined;
    const inferredSourceSectionKey = isSectionKey(current.sourceSectionKey) ? current.sourceSectionKey : sourceSectionKey;
    return {
      text,
      evidence,
      basis,
      humanCheckNeeded,
      claimType,
      actionType,
      confidence,
      sourceSectionKey: inferredSourceSectionKey === "unknown" ? sourceSectionKey : inferredSourceSectionKey,
    };
  });
  return dedupeEntries(mapped.filter((entry): entry is ConversationArtifactEntry => entry !== null)).slice(0, 24);
}

function synthesizeSectionsFromArtifact(artifact: ConversationArtifact): ConversationArtifactSection[] {
  const sections: ConversationArtifactSection[] = [];
  const addSection = (key: ArtifactSectionKey, title: string, lines: string[]) => {
    if (lines.length === 0) return;
    sections.push({ key, title, lines });
  };

  const basicInfoSection = artifact.sections.find((section) => section.key === "basic_info");
  if (basicInfoSection) {
    addSection("basic_info", basicInfoSection.title, basicInfoSection.lines);
  }

  const summaryTitle =
    artifact.sections.find((section) => section.key === "summary")?.title ?? "1. サマリー";
  const detailsTitle =
    artifact.sections.find((section) => section.key === "details")?.title ?? "2. 学習状況と課題分析";
  const actionsTitle =
    artifact.sections.find((section) => section.key === "actions")?.title ?? "3. 今後の対策・指導内容";
  const shareTitle =
    artifact.sections.find((section) => section.key === "share")?.title ?? "4. 志望校に関する検討事項";

  const renderEntries = (entries: ConversationArtifactEntry[]) =>
    entries.flatMap((entry) => {
      const prefix = formatClaimPrefix(entry.claimType) || formatActionPrefix(entry.actionType);
      const lines = [`- ${prefix}${entry.text}`];
      for (const evidence of entry.evidence.slice(0, 3)) {
        lines.push(`  - 根拠: ${evidence}`);
      }
      if (entry.basis) {
        lines.push(`  - basis: ${entry.basis}`);
      }
      if (typeof entry.humanCheckNeeded === "boolean") {
        lines.push(`  - humanCheckNeeded: ${entry.humanCheckNeeded ? "true" : "false"}`);
      }
      if (entry.confidence) {
        lines.push(`  - confidence: ${entry.confidence}`);
      }
      return lines;
    });

  addSection("summary", summaryTitle, renderEntries(artifact.summary));
  addSection("details", detailsTitle, renderEntries(artifact.claims));
  addSection("actions", actionsTitle, renderEntries(artifact.nextActions));
  addSection("share", shareTitle, renderEntries(artifact.sharePoints));
  if (artifact.nextChecks.length > 0) {
    addSection("unknown", "5. 次回のお勧め話題", artifact.nextChecks.map((text) => `- ${text}`));
  }

  return sections;
}

function finalizeConversationArtifact(artifact: ConversationArtifact) {
  const sections = artifact.sections.length > 0 ? artifact.sections : synthesizeSectionsFromArtifact(artifact);
  const summary = artifact.summary.length > 0 ? artifact.summary : collectSectionEntries(sections, "summary");
  const claims = artifact.claims.length > 0 ? artifact.claims : collectSectionEntries(sections, "details");
  const nextActions = artifact.nextActions.length > 0 ? artifact.nextActions : collectSectionEntries(sections, "actions");
  const sharePoints = artifact.sharePoints.length > 0 ? artifact.sharePoints : collectSectionEntries(sections, "share");
  const typedActionSplit = splitActionEntries(nextActions);

  return {
    ...artifact,
    sections,
    summary,
    claims,
    nextActions,
    sharePoints,
    facts: artifact.facts.length > 0 ? artifact.facts : collectEntryTexts(summary, 8),
    changes: artifact.changes.length > 0 ? artifact.changes : collectEntryTexts(claims, 8),
    assessment: artifact.assessment.length > 0 ? artifact.assessment : collectEntryTexts(typedActionSplit.assessment, 8),
    nextChecks: artifact.nextChecks.length > 0 ? artifact.nextChecks : collectEntryTexts(typedActionSplit.nextChecks, 8),
  } satisfies ConversationArtifact;
}

function sanitizeStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return dedupeLines(value.filter((item): item is string => typeof item === "string")).slice(0, limit);
}

function sanitizeArtifactEntries(
  value: unknown,
  limit: number,
  sourceSectionKey: Exclude<ArtifactSectionKey, "unknown">
): ConversationArtifactEntry[] {
  return entriesFromTextArray(value, sourceSectionKey).slice(0, limit);
}

export function buildConversationArtifactFromMarkdown(input: {
  sessionType: ArtifactSessionType;
  summaryMarkdown?: string | null;
  generatedAt?: string | Date | null;
}): ConversationArtifact {
  const generatedAt =
    input.generatedAt instanceof Date
      ? input.generatedAt.toISOString()
      : typeof input.generatedAt === "string" && input.generatedAt
        ? new Date(input.generatedAt).toISOString()
        : new Date().toISOString();
  const sections = parseMarkdownSections(input.summaryMarkdown);

  const summaryEntries = collectSectionEntries(sections, "summary");
  const claimEntries = collectSectionEntries(sections, "details");
  const actionEntries = dedupeEntries([
    ...collectSectionEntries(sections, "actions"),
    ...(input.sessionType === "INTERVIEW" ? collectInterviewNextCheckEntries(sections) : []),
  ]);
  const shareEntries = collectSectionEntries(sections, "share");
  const splitActions = splitActionEntries(actionEntries);

  return finalizeConversationArtifact({
    version: "conversation-artifact/v1",
    sessionType: input.sessionType,
    generatedAt,
    summary: summaryEntries,
    claims: claimEntries,
    nextActions: actionEntries,
    sharePoints: shareEntries,
    facts: collectEntryTexts(summaryEntries, 8),
    changes: collectEntryTexts(claimEntries, 8),
    assessment: collectEntryTexts(splitActions.assessment, 8),
    nextChecks: collectEntryTexts(splitActions.nextChecks, 8),
    sections,
  });
}

export function parseConversationArtifact(value: unknown): ConversationArtifact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const current = value as Record<string, unknown>;
  if (current.version !== "conversation-artifact/v1") return null;
  if (current.sessionType !== "INTERVIEW") return null;

  const sections: ConversationArtifactSection[] = Array.isArray(current.sections)
    ? current.sections
        .map((section) => {
          if (!section || typeof section !== "object" || Array.isArray(section)) return null;
          const currentSection = section as Record<string, unknown>;
          const key = isSectionKey(currentSection.key) ? currentSection.key : "unknown";
          const title = typeof currentSection.title === "string" ? normalizeText(currentSection.title) : "";
          const lines = sanitizeStringArray(currentSection.lines, 24);
          if (!title) return null;
          return { key, title, lines };
        })
        .filter((section): section is ConversationArtifactSection => Boolean(section))
    : [];

  const summary = sanitizeArtifactEntries(current.summary, 12, "summary");
  const claims = sanitizeArtifactEntries(current.claims, 16, "details");
  const nextActions = sanitizeArtifactEntries(current.nextActions, 16, "actions");
  const sharePoints = sanitizeArtifactEntries(current.sharePoints, 16, "share");
  const typedActionSplit = splitActionEntries(nextActions);

  const derivedFromSections = sections.length > 0;
  const assessment = sanitizeStringArray(current.assessment, 12);
  const nextChecks = sanitizeStringArray(current.nextChecks, 12);
  const artifact: ConversationArtifact = {
    version: "conversation-artifact/v1",
    sessionType: current.sessionType,
    generatedAt: typeof current.generatedAt === "string" && current.generatedAt ? current.generatedAt : new Date().toISOString(),
    summary: summary.length > 0 ? summary : derivedFromSections ? collectSectionEntries(sections, "summary") : [],
    claims: claims.length > 0 ? claims : derivedFromSections ? collectSectionEntries(sections, "details") : [],
    nextActions: nextActions.length > 0 ? nextActions : derivedFromSections ? collectSectionEntries(sections, "actions") : [],
    sharePoints: sharePoints.length > 0 ? sharePoints : derivedFromSections ? collectSectionEntries(sections, "share") : [],
    facts: sanitizeStringArray(current.facts, 12),
    changes: sanitizeStringArray(current.changes, 12),
    assessment: assessment.length > 0 ? assessment : collectEntryTexts(typedActionSplit.assessment, 12),
    nextChecks: nextChecks.length > 0 ? nextChecks : collectEntryTexts(typedActionSplit.nextChecks, 12),
    sections,
  };

  if (
    artifact.sections.length === 0 &&
    artifact.summary.length === 0 &&
    artifact.claims.length === 0 &&
    artifact.nextActions.length === 0 &&
    artifact.sharePoints.length === 0
  ) {
    return null;
  }

  return finalizeConversationArtifact(artifact);
}
