type ArtifactSessionType = "INTERVIEW" | "LESSON_REPORT";
type ArtifactSectionKey = "basic_info" | "summary" | "details" | "actions" | "share" | "unknown";

export type ConversationArtifactSection = {
  key: ArtifactSectionKey;
  title: string;
  lines: string[];
};

export type ConversationArtifactEntry = {
  text: string;
  evidence: string[];
  sourceSectionKey?: Exclude<ArtifactSectionKey, "unknown">;
  basis?: string;
  humanCheckNeeded?: boolean;
  confidence?: "low" | "medium" | "high";
  slice: (start?: number, end?: number) => string;
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
  sections: ConversationArtifactSection[];
};

const INTERVIEW_TITLES: Record<Exclude<ArtifactSectionKey, "unknown">, string[]> = {
  basic_info: ["基本情報"],
  summary: ["1. サマリー"],
  details: ["2. ポジティブな話題"],
  actions: ["3. 改善・対策が必要な話題"],
  share: ["4. 保護者への共有ポイント"],
};

const LESSON_TITLES: Record<Exclude<ArtifactSectionKey, "unknown">, string[]> = {
  basic_info: ["基本情報"],
  summary: ["1. 本日の指導サマリー", "1. 本日の指導サマリー（室長向け要約）"],
  details: ["2. 課題と指導成果", "2. 課題と指導成果（Before → After）"],
  actions: ["3. 学習方針と次回アクション", "3. 学習方針と次回アクション（自学習の設計）"],
  share: ["4. 室長・他講師への共有・連携事項"],
};

function normalizeText(text: string) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeading(text: string) {
  return normalizeText(text).replace(/[：:]/g, "");
}

function dedupeLines(lines: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const cleaned = normalizeText(line);
    if (!cleaned) continue;
    const key = cleaned.replace(/[。．！？\s]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function stripBulletPrefix(line: string) {
  return line.replace(/^[-*・•]\s+/, "").trim();
}

function parseBooleanish(value: string) {
  return /^(true|1|yes|y|はい|必要|要)$/i.test(normalizeText(value));
}

function parseInlineEvidence(line: string) {
  const match = line.match(
    /^(.*?)(?:\s*[（(](?:根拠|evidence|basis|source)[:：]\s*(.+?)[)）])$/
  );
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

function inferEntryKind(sectionKey: Exclude<ArtifactSectionKey, "unknown">, text: string) {
  if (sectionKey === "summary") return "summary";
  if (sectionKey === "share") return "share";
  if (sectionKey === "actions") {
    if (/^(生徒|次回までの宿題|次回の確認（テスト）事項|次回の確認|宿題|確認事項)[:：]/.test(text)) {
      return "nextAction";
    }
    return "assessment";
  }
  if (sectionKey === "details") {
    if (/^(現状（Before）|現状|Before)[:：]/.test(text)) return "change";
    if (/^(成果（After）|成果|After)[:：]/.test(text)) return "change";
    return "claim";
  }
  return "claim";
}

function normalizeEntryEntry(entry: ConversationArtifactEntry) {
  return {
    ...entry,
    text: normalizeText(entry.text),
    evidence: dedupeLines(entry.evidence),
    basis: typeof entry.basis === "string" ? normalizeText(entry.basis) : undefined,
    humanCheckNeeded: entry.humanCheckNeeded === true,
    confidence:
      entry.confidence === "low" || entry.confidence === "medium" || entry.confidence === "high"
        ? entry.confidence
        : undefined,
    slice(start?: number, end?: number) {
      return normalizeText(entry.text).slice(start, end);
    },
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
      normalized.confidence ?? "",
    ].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function parseSectionEntries(
  lines: string[],
  sourceSectionKey: Exclude<ArtifactSectionKey, "unknown">
) {
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

    const inline = parseInlineEvidence(line);
    const text = normalizeText(inline?.text ?? line);
    if (!text) continue;

    const nextEntry: ConversationArtifactEntry = {
      text,
      evidence: inline?.evidence ? [...inline.evidence] : [],
      sourceSectionKey,
      slice(start?: number, end?: number) {
        return text.slice(start, end);
      },
    };
    if (sourceSectionKey === "summary") nextEntry.basis = undefined;
    current = nextEntry;
    entries.push(nextEntry);
  }

  return dedupeEntries(entries);
}

function parseMarkdownSections(markdown?: string | null, sessionType: ArtifactSessionType = "INTERVIEW") {
  const titleMap = sessionType === "LESSON_REPORT" ? LESSON_TITLES : INTERVIEW_TITLES;
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

function collectSectionEntries(
  sections: ConversationArtifactSection[],
  key: Exclude<ArtifactSectionKey, "unknown">
) {
  return dedupeEntries(sectionsByKey(sections, key).flatMap((section) => parseSectionEntries(section.lines, key)));
}

function collectEntryTexts(entries: ConversationArtifactEntry[], limit = 8) {
  return dedupeLines(entries.map((entry) => entry.text)).slice(0, limit);
}

function collectSummaryTexts(sections: ConversationArtifactSection[]) {
  const lines = collectEntryTexts(collectSectionEntries(sections, "summary"), 6);
  return lines.length > 0 ? lines : [];
}

function collectClaimTexts(sections: ConversationArtifactSection[]) {
  return collectEntryTexts(collectSectionEntries(sections, "details"), 8);
}

function collectActionTexts(sections: ConversationArtifactSection[]) {
  return collectEntryTexts(collectSectionEntries(sections, "actions"), 8);
}

function collectShareTexts(sections: ConversationArtifactSection[]) {
  return collectEntryTexts(collectSectionEntries(sections, "share"), 6);
}

function entriesFromTextArray(
  values: unknown,
  sourceSectionKey: Exclude<ArtifactSectionKey, "unknown">
): ConversationArtifactEntry[] {
  if (!Array.isArray(values)) return [];
  const mapped: Array<ConversationArtifactEntry | null> = values.map((item) => {
    if (typeof item === "string") {
      const text = normalizeText(item);
      if (!text) return null;
      return {
        text,
        evidence: [],
        sourceSectionKey,
        slice(start?: number, end?: number) {
          return text.slice(start, end);
        },
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
    const confidence =
      current.confidence === "low" || current.confidence === "medium" || current.confidence === "high"
        ? current.confidence
        : undefined;
    const inferredSourceSectionKey = isSectionKey(current.sourceSectionKey)
      ? current.sourceSectionKey
      : sourceSectionKey;
    return {
      text,
      evidence,
      basis,
      humanCheckNeeded,
      confidence,
      sourceSectionKey: inferredSourceSectionKey === "unknown" ? sourceSectionKey : inferredSourceSectionKey,
      slice(start?: number, end?: number) {
        return text.slice(start, end);
      },
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
    artifact.sections.find((section) => section.key === "summary")?.title ??
    (artifact.sessionType === "LESSON_REPORT" ? "1. 本日の指導サマリー（室長向け要約）" : "1. サマリー");
  const detailsTitle =
    artifact.sections.find((section) => section.key === "details")?.title ??
    (artifact.sessionType === "LESSON_REPORT" ? "2. 課題と指導成果（Before → After）" : "2. ポジティブな話題");
  const actionsTitle =
    artifact.sections.find((section) => section.key === "actions")?.title ??
    (artifact.sessionType === "LESSON_REPORT"
      ? "3. 学習方針と次回アクション（自学習の設計）"
      : "3. 改善・対策が必要な話題");
  const shareTitle =
    artifact.sections.find((section) => section.key === "share")?.title ??
    (artifact.sessionType === "LESSON_REPORT"
      ? "4. 室長・他講師への共有・連携事項"
      : "4. 保護者への共有ポイント");

  const renderEntries = (entries: ConversationArtifactEntry[]) =>
    entries.flatMap((entry) => {
      const lines = [`- ${entry.text}`];
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

  return sections;
}

function isSectionKey(value: unknown): value is ArtifactSectionKey {
  return (
    value === "basic_info" ||
    value === "summary" ||
    value === "details" ||
    value === "actions" ||
    value === "share" ||
    value === "unknown"
  );
}

function sanitizeEntryList(value: unknown, limit: number, sourceSectionKey: Exclude<ArtifactSectionKey, "unknown">) {
  const fromValue = entriesFromTextArray(value, sourceSectionKey).slice(0, limit);
  return fromValue;
}

function sanitizeStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return dedupeLines(value.filter((item): item is string => typeof item === "string")).slice(0, limit);
}

function sectionTitleAliases(sessionType: ArtifactSessionType, key: Exclude<ArtifactSectionKey, "unknown">) {
  return (sessionType === "LESSON_REPORT" ? LESSON_TITLES : INTERVIEW_TITLES)[key];
}

function fallbackSectionTitle(sessionType: ArtifactSessionType, key: Exclude<ArtifactSectionKey, "unknown">) {
  return sectionTitleAliases(sessionType, key)[0];
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
  const sections = parseMarkdownSections(input.summaryMarkdown, input.sessionType);

  const summaryEntries = collectSectionEntries(sections, "summary");
  const claimEntries = collectSectionEntries(sections, "details");
  const actionEntries = collectSectionEntries(sections, "actions");
  const shareEntries = collectSectionEntries(sections, "share");

  return {
    version: "conversation-artifact/v1",
    sessionType: input.sessionType,
    generatedAt,
    summary: summaryEntries,
    claims: claimEntries,
    nextActions: actionEntries,
    sharePoints: shareEntries,
    facts: collectEntryTexts(summaryEntries, 8),
    changes: collectEntryTexts(claimEntries, 8),
    assessment: collectEntryTexts(actionEntries, 8),
    sections,
  };
}

function sanitizeArtifactEntries(
  value: unknown,
  limit: number,
  sourceSectionKey: Exclude<ArtifactSectionKey, "unknown">
): ConversationArtifactEntry[] {
  return entriesFromTextArray(value, sourceSectionKey).slice(0, limit);
}

function ensureStructuredSections(artifact: ConversationArtifact) {
  if (artifact.sections.length > 0) return artifact.sections;
  return synthesizeSectionsFromArtifact(artifact);
}

export function parseConversationArtifact(value: unknown): ConversationArtifact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const current = value as Record<string, unknown>;
  if (current.version !== "conversation-artifact/v1") return null;
  if (current.sessionType !== "INTERVIEW" && current.sessionType !== "LESSON_REPORT") return null;

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

  const derivedFromSections = sections.length > 0;
  const artifact: ConversationArtifact = {
    version: "conversation-artifact/v1",
    sessionType: current.sessionType,
    generatedAt:
      typeof current.generatedAt === "string" && current.generatedAt
        ? current.generatedAt
        : new Date().toISOString(),
    summary: summary.length > 0 ? summary : derivedFromSections ? collectSectionEntries(sections, "summary") : [],
    claims: claims.length > 0 ? claims : derivedFromSections ? collectSectionEntries(sections, "details") : [],
    nextActions:
      nextActions.length > 0 ? nextActions : derivedFromSections ? collectSectionEntries(sections, "actions") : [],
    sharePoints:
      sharePoints.length > 0 ? sharePoints : derivedFromSections ? collectSectionEntries(sections, "share") : [],
    facts: sanitizeStringArray(current.facts, 12),
    changes: sanitizeStringArray(current.changes, 12),
    assessment: sanitizeStringArray(current.assessment, 12),
    sections,
  };

  if (artifact.summary.length === 0) {
    artifact.summary = artifact.sections.length > 0 ? collectSectionEntries(artifact.sections, "summary") : [];
  }
  if (artifact.claims.length === 0) {
    artifact.claims = artifact.sections.length > 0 ? collectSectionEntries(artifact.sections, "details") : [];
  }
  if (artifact.nextActions.length === 0) {
    artifact.nextActions = artifact.sections.length > 0 ? collectSectionEntries(artifact.sections, "actions") : [];
  }
  if (artifact.sharePoints.length === 0) {
    artifact.sharePoints = artifact.sections.length > 0 ? collectSectionEntries(artifact.sections, "share") : [];
  }

  if (artifact.facts.length === 0) {
    artifact.facts = collectEntryTexts(artifact.summary, 8);
  }
  if (artifact.changes.length === 0) {
    artifact.changes = collectEntryTexts(artifact.claims, 8);
  }
  if (artifact.assessment.length === 0) {
    artifact.assessment = collectEntryTexts(artifact.nextActions, 8);
  }

  if (
    artifact.sections.length === 0 &&
    artifact.summary.length === 0 &&
    artifact.claims.length === 0 &&
    artifact.nextActions.length === 0 &&
    artifact.sharePoints.length === 0
  ) {
    return null;
  }

  if (artifact.sections.length === 0) {
    artifact.sections = synthesizeSectionsFromArtifact(artifact);
  }

  return artifact;
}

export function renderConversationArtifactMarkdown(artifactInput: ConversationArtifact | unknown) {
  const artifact = parseConversationArtifact(artifactInput);
  if (!artifact) return "";

  const sections = ensureStructuredSections(artifact);
  const lines: string[] = [];
  for (const section of sections) {
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
