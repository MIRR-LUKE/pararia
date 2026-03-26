type ArtifactSessionType = "INTERVIEW" | "LESSON_REPORT";
type ArtifactSectionKey = "basic_info" | "summary" | "details" | "actions" | "share" | "unknown";

export type ConversationArtifactSection = {
  key: ArtifactSectionKey;
  title: string;
  lines: string[];
};

export type ConversationArtifact = {
  version: "conversation-artifact/v1";
  sessionType: ArtifactSessionType;
  generatedAt: string;
  summary: string[];
  facts: string[];
  changes: string[];
  assessment: string[];
  nextActions: string[];
  sharePoints: string[];
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

function collectLines(sections: ConversationArtifactSection[], key: ArtifactSectionKey, limit = 8) {
  return dedupeLines(
    sectionsByKey(sections, key).flatMap((section) => section.lines.map(stripBulletPrefix))
  ).slice(0, limit);
}

function collectSummaryLines(sections: ConversationArtifactSection[]) {
  const lines = collectLines(sections, "summary", 6);
  return lines.length > 0 ? lines : ["今回のログ要点を整理した。"];
}

function collectShareLines(sections: ConversationArtifactSection[]) {
  const lines = collectLines(sections, "share", 6);
  return lines.length > 0 ? lines : ["共有に必要なポイントをログ本文から整理する。"];
}

function collectActionLines(sections: ConversationArtifactSection[]) {
  const actionSections = sectionsByKey(sections, "actions");
  const directHits = dedupeLines(
    actionSections.flatMap((section) =>
      section.lines
        .filter((line) => /^(生徒:|次回までの宿題:|次回の確認（テスト）事項:|現状（Before）:|成果（After）:)/.test(line))
        .map(stripBulletPrefix)
    )
  );

  if (directHits.length > 0) return directHits.slice(0, 8);
  return collectLines(sections, "actions", 8);
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

  return {
    version: "conversation-artifact/v1",
    sessionType: input.sessionType,
    generatedAt,
    summary: collectSummaryLines(sections),
    facts: collectLines(sections, "summary", 8),
    changes: collectLines(sections, "details", 8),
    assessment: collectLines(sections, "actions", 8),
    nextActions: collectActionLines(sections),
    sharePoints: collectShareLines(sections),
    sections,
  };
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

function sanitizeStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return dedupeLines(value.filter((item): item is string => typeof item === "string")).slice(0, limit);
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

  const artifact: ConversationArtifact = {
    version: "conversation-artifact/v1",
    sessionType: current.sessionType,
    generatedAt:
      typeof current.generatedAt === "string" && current.generatedAt
        ? current.generatedAt
        : new Date().toISOString(),
    summary: sanitizeStringArray(current.summary, 8),
    facts: sanitizeStringArray(current.facts, 12),
    changes: sanitizeStringArray(current.changes, 12),
    assessment: sanitizeStringArray(current.assessment, 12),
    nextActions: sanitizeStringArray(current.nextActions, 12),
    sharePoints: sanitizeStringArray(current.sharePoints, 12),
    sections,
  };

  if (artifact.sections.length === 0) return null;
  if (artifact.summary.length === 0) {
    artifact.summary = collectSummaryLines(artifact.sections);
  }
  if (artifact.facts.length === 0) {
    artifact.facts = collectLines(artifact.sections, "summary", 8);
  }
  if (artifact.changes.length === 0) {
    artifact.changes = collectLines(artifact.sections, "details", 8);
  }
  if (artifact.assessment.length === 0) {
    artifact.assessment = collectLines(artifact.sections, "actions", 8);
  }
  if (artifact.nextActions.length === 0) {
    artifact.nextActions = collectActionLines(artifact.sections);
  }
  if (artifact.sharePoints.length === 0) {
    artifact.sharePoints = collectShareLines(artifact.sections);
  }

  return artifact;
}

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
