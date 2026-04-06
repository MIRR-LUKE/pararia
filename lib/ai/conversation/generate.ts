import {
  renderConversationArtifactMarkdown,
  splitActionEntries,
  type ConversationArtifact,
  type ConversationArtifactEntry,
  type ConversationArtifactSection,
  buildConversationArtifactFromMarkdown,
} from "@/lib/conversation-artifact";
import { calculateOpenAiTextCostUsd } from "@/lib/ai/openai-pricing";
import { buildInterviewDraftFallbackMarkdown, buildLessonDraftFallbackMarkdown } from "./fallback";
import { buildDraftSystemPrompt, buildStructuredArtifactJsonSchema } from "./spec";
import { buildDraftInputBlock, estimateTokens, formatSessionDateLabel, formatStudentLabel, formatTeacherLabel } from "./shared";
import { callJsonGeneration } from "./transport";
import type { DraftGenerationInput, DraftGenerationResult, LlmTokenUsage, SessionMode } from "./types";

const PROMPT_VERSION = "v5.1";

type StructuredDraftEntry = {
  label?: unknown;
  text?: unknown;
  evidence?: unknown;
  claimType?: unknown;
  actionType?: unknown;
  confidence?: unknown;
  humanCheckNeeded?: unknown;
  basis?: unknown;
};

type StructuredDraftPayload = {
  basicInfo?: Record<string, unknown> | null;
  summary?: unknown;
  claims?: unknown;
  nextActions?: unknown;
  sharePoints?: unknown;
};

function forceGpt5Family(model: string) {
  const normalized = String(model ?? "").trim();
  if (!normalized) return "gpt-5.4";
  return normalized.includes("gpt-5") ? normalized : "gpt-5.4";
}

function getFastModel() {
  const requested = forceGpt5Family(process.env.LLM_MODEL_FAST || process.env.LLM_MODEL || "gpt-5.4");
  if (/gpt-5(?:\.4)?-(mini|nano)/i.test(requested)) {
    return "gpt-5.4";
  }
  return requested;
}

function supportsExtendedPromptCaching(model: string) {
  return /^gpt-5(?:\.|$|-)/i.test(model) || /^gpt-4\.1(?:$|-)/i.test(model);
}

function buildPromptCacheKey(namespace: string, sessionType?: SessionMode) {
  return ["conversation-pipeline", PROMPT_VERSION, namespace, sessionType ?? "COMMON"].join(":");
}

function resolvePromptCacheSettings(model: string, input: DraftGenerationInput, sessionType: SessionMode) {
  if (input.promptCacheRetention === null) {
    return {
      promptCacheKey: undefined,
      promptCacheRetention: undefined,
    };
  }

  const namespace = normalizeText(input.promptCacheNamespace, 48) || "artifact";
  const retention =
    input.promptCacheRetention ??
    (supportsExtendedPromptCaching(model) ? "24h" : "in_memory");

  return {
    promptCacheKey: buildPromptCacheKey(namespace, sessionType),
    promptCacheRetention: retention,
  };
}

function normalizeText(value: unknown, maxChars = 180) {
  const text = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}…` : text;
}

function emptyTokenUsage(): LlmTokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
  };
}

function mergeTokenUsage(current: LlmTokenUsage, next?: Partial<LlmTokenUsage> | null) {
  if (!next) return current;
  return {
    inputTokens: current.inputTokens + Math.max(0, Math.floor(Number(next.inputTokens ?? 0))),
    cachedInputTokens: current.cachedInputTokens + Math.max(0, Math.floor(Number(next.cachedInputTokens ?? 0))),
    outputTokens: current.outputTokens + Math.max(0, Math.floor(Number(next.outputTokens ?? 0))),
    totalTokens: current.totalTokens + Math.max(0, Math.floor(Number(next.totalTokens ?? 0))),
    reasoningTokens: current.reasoningTokens + Math.max(0, Math.floor(Number(next.reasoningTokens ?? 0))),
  };
}

function normalizeSectionText(value: unknown, maxChars = 120) {
  const text = normalizeText(value, maxChars);
  return text
    .replace(/^(では録音を始|録音を始|質問もありますか|お疲れさま|以上です)/, "")
    .replace(/^(はい|えっと|えーと|ええと|うん|まあ|なんか|あの|その)\s*/g, "")
    .trim();
}

function formatInterviewDateLabel(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDurationLabel(minutes?: number | null) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return "未記録";
  return `${Math.max(1, Math.round(minutes))}分`;
}

function stripEntryLabelPrefix(text: string) {
  return text.replace(/^【[^】]+】\s*/, "").trim();
}

function ensureSentenceEnding(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (/[。！？]$/.test(trimmed)) return trimmed;
  return `${trimmed}。`;
}

function wrapJapaneseParagraph(text: string, maxChars = 120) {
  const cleaned = ensureSentenceEnding(text);
  if (!cleaned) return [];
  const sentences = cleaned.split(/(?<=。|！|？)/).map((part) => part.trim()).filter(Boolean);
  if (sentences.length === 0) return [cleaned];

  const lines: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current}${sentence}` : sentence;
    if (current && next.length > maxChars) {
      lines.push(current);
      current = sentence;
      continue;
    }
    current = next;
  }
  if (current) lines.push(current);
  return lines;
}

function normalizeEvidenceList(value: unknown, maxItems = 2) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = normalizeSectionText(item, 100);
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeClaimType(value: unknown): ConversationArtifactEntry["claimType"] | undefined {
  if (value === "observed" || value === "inferred" || value === "missing") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "観察") return "observed";
  if (text === "推測") return "inferred";
  if (text === "不足") return "missing";
  return undefined;
}

function normalizeActionType(value: unknown): ConversationArtifactEntry["actionType"] | undefined {
  if (value === "assessment" || value === "nextCheck") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "判断") return "assessment";
  if (text === "次回確認") return "nextCheck";
  return undefined;
}

function normalizeConfidence(value: unknown): ConversationArtifactEntry["confidence"] | undefined {
  if (value === "low" || value === "medium" || value === "high") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "低") return "low";
  if (text === "中") return "medium";
  if (text === "高") return "high";
  return undefined;
}

function buildEntry(
  input: StructuredDraftEntry,
  defaults: {
    defaultLabel?: string;
    defaultClaimType?: ConversationArtifactEntry["claimType"];
    defaultActionType?: ConversationArtifactEntry["actionType"];
    maxTextChars?: number;
    includeLabelInText?: boolean;
  }
) {
  const label = normalizeText(input.label ?? defaults.defaultLabel ?? "", 32);
  const textBody = normalizeSectionText(input.text, defaults.maxTextChars ?? 120);
  if (!textBody) return null;
  const includeLabelInText = defaults.includeLabelInText !== false;
  const text = includeLabelInText && label && !textBody.startsWith("【") ? `【${label}】 ${textBody}` : textBody;
  const evidence = normalizeEvidenceList(input.evidence);
  const claimType = normalizeClaimType(input.claimType) ?? defaults.defaultClaimType;
  const actionType = normalizeActionType(input.actionType) ?? defaults.defaultActionType;
  return {
    text,
    evidence,
    claimType,
    actionType,
    confidence: normalizeConfidence(input.confidence),
    humanCheckNeeded: input.humanCheckNeeded === true,
    basis: normalizeText(input.basis, 100) || undefined,
  } satisfies ConversationArtifactEntry;
}

function normalizeEntryList(
  value: unknown,
  defaults: {
    defaultClaimType?: ConversationArtifactEntry["claimType"];
    defaultActionType?: ConversationArtifactEntry["actionType"];
    maxTextChars?: number;
    includeLabelInText?: boolean;
  },
  limit: number
) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: ConversationArtifactEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = buildEntry(item as StructuredDraftEntry, defaults);
    if (!entry) continue;
    const key = `${entry.text}::${entry.evidence.join("|")}::${entry.claimType ?? ""}::${entry.actionType ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (entries.length >= limit) break;
  }
  return entries;
}

function renderEntryLines(entries: ConversationArtifactEntry[], options?: { forceLabel?: string }) {
  const lines: string[] = [];
  for (const entry of entries) {
    const prefix =
      options?.forceLabel
        ? `${options.forceLabel}: `
        : entry.claimType === "observed"
          ? "観察: "
          : entry.claimType === "inferred"
            ? "推測: "
            : entry.claimType === "missing"
              ? "不足: "
              : entry.actionType === "nextCheck"
                ? "次回確認: "
                : entry.actionType === "assessment"
                  ? "判断: "
                  : "";
    lines.push(`- ${prefix}${entry.text}`);
    for (const evidence of entry.evidence.slice(0, 2)) {
      lines.push(`根拠: ${evidence}`);
    }
  }
  return lines;
}

function renderInterviewSummaryLines(entries: ConversationArtifactEntry[]) {
  const lines: string[] = [];
  for (const entry of entries) {
    const paragraph = ensureSentenceEnding(stripEntryLabelPrefix(entry.text));
    if (!paragraph) continue;
    lines.push(...wrapJapaneseParagraph(paragraph));
    lines.push("");
  }
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function renderInterviewBulletLines(entries: ConversationArtifactEntry[]) {
  return entries
    .map((entry) => ensureSentenceEnding(stripEntryLabelPrefix(entry.text)))
    .filter(Boolean)
    .map((text) => `- ${text}`);
}

function renderInterviewOptionalSectionLines(
  entries: ConversationArtifactEntry[],
  emptyMessage: string
) {
  const lines = renderInterviewBulletLines(entries);
  return lines.length > 0 ? lines : [emptyMessage];
}

function buildBasicInfoLines(sessionType: SessionMode, input: DraftGenerationInput, basicInfo?: Record<string, unknown> | null) {
  if (sessionType === "LESSON_REPORT") {
    return [
      `対象生徒: ${normalizeText(basicInfo?.student, 40) || formatStudentLabel(input.studentName)} 様`,
      `指導日: ${normalizeText(basicInfo?.date, 32) || formatSessionDateLabel(input.sessionDate) || "未記録"}`,
      `教科・単元: ${normalizeText(basicInfo?.subjectUnit, 64) || "文字起こしから確認した内容を整理"}`,
      `担当チューター: ${normalizeText(basicInfo?.teacher, 40) || formatTeacherLabel(input.teacherName)}`,
    ];
  }

  return [
    `対象生徒: ${normalizeText(basicInfo?.student, 40) || formatStudentLabel(input.studentName)} 様`,
    `面談日: ${formatInterviewDateLabel(typeof basicInfo?.date === "string" ? basicInfo.date : null) || normalizeText(basicInfo?.date, 32) || formatInterviewDateLabel(input.sessionDate) || "未記録"}`,
    `面談時間: ${formatDurationLabel(input.durationMinutes)}`,
    `担当チューター: ${normalizeText(basicInfo?.teacher, 40) || formatTeacherLabel(input.teacherName)}`,
    `テーマ: ${normalizeText(basicInfo?.purpose, 64) || "学習状況の確認と次回方針の整理"}`,
  ];
}

function ensureMinimum<T>(list: T[], fallback: T[], minCount: number) {
  if (list.length >= minCount) return list;
  return [...list, ...fallback.slice(0, Math.max(0, minCount - list.length))];
}

function buildSectionsFromEntries(
  sessionType: SessionMode,
  basicInfoLines: string[],
  summary: ConversationArtifactEntry[],
  claims: ConversationArtifactEntry[],
  nextActions: ConversationArtifactEntry[],
  sharePoints: ConversationArtifactEntry[]
) {
  if (sessionType === "LESSON_REPORT") {
    const groupedClaims = new Map<string, ConversationArtifactEntry[]>();
    for (const entry of claims) {
      const match = entry.text.match(/^【([^】]+)】\s*(.+)$/);
      const label = match?.[1] ?? "論点整理";
      const text = match?.[2] ?? entry.text;
      const current = groupedClaims.get(label) ?? [];
      current.push({ ...entry, text });
      groupedClaims.set(label, current);
    }

    const detailLines: string[] = [];
    for (const [label, entries] of groupedClaims) {
      const before = entries.find((entry) => entry.claimType === "missing") ?? entries[0];
      const after = entries.find((entry) => entry.claimType === "observed") ?? entries[0];
      const note = entries.find((entry) => entry.claimType === "inferred") ?? entries[1] ?? entries[0];
      detailLines.push(`【${label}】`);
      detailLines.push(`現状（Before）: ${before.text}`);
      for (const evidence of before.evidence.slice(0, 1)) detailLines.push(`根拠: ${evidence}`);
      detailLines.push(`成果（After）: ${after.text}`);
      for (const evidence of after.evidence.slice(0, 1)) detailLines.push(`根拠: ${evidence}`);
      detailLines.push(`※特記事項: ${note.text}`);
      for (const evidence of note.evidence.slice(0, 1)) detailLines.push(`根拠: ${evidence}`);
      detailLines.push("");
    }
    if (detailLines.at(-1) === "") detailLines.pop();

    const byLabel = new Map<string, ConversationArtifactEntry[]>();
    for (const entry of nextActions) {
      const match = entry.text.match(/^【([^】]+)】\s*(.+)$/);
      const label = normalizeText(match?.[1], 32) || "確認事項";
      const text = match?.[2] ?? entry.text;
      const current = byLabel.get(label) ?? [];
      current.push({ ...entry, text });
      byLabel.set(label, current);
    }
    const actionLines: string[] = [];
    const orderedLabels = ["生徒", "次回までの宿題", "次回の確認（テスト）事項"];
    for (const label of orderedLabels) {
      const entries = byLabel.get(label) ?? [];
      if (entries.length === 0) continue;
      actionLines.push(`${label}:`);
      actionLines.push(
        ...renderEntryLines(
          entries.map((entry) => {
            const match = entry.text.match(/^【[^】]+】\s*(.+)$/);
            return { ...entry, text: match?.[1] ?? entry.text };
          }),
          { forceLabel: label === "次回の確認（テスト）事項" ? "次回確認" : "判断" }
        )
      );
    }

    return [
      { key: "basic_info", title: "基本情報", lines: basicInfoLines },
      { key: "summary", title: "1. 本日の指導サマリー（室長向け要約）", lines: summary.flatMap((entry) => [entry.text, ...entry.evidence.slice(0, 2).map((evidence) => `根拠: ${evidence}`), ""]).filter(Boolean) },
      { key: "details", title: "2. 課題と指導成果（Before → After）", lines: detailLines },
      { key: "actions", title: "3. 学習方針と次回アクション（自学習の設計）", lines: actionLines },
      { key: "share", title: "4. 室長・他講師への共有・連携事項", lines: renderEntryLines(sharePoints, { forceLabel: "共有" }) },
    ] satisfies ConversationArtifactSection[];
  }

  const actionSplit = splitActionEntries(nextActions);
  const strategyEntries = actionSplit.assessment;
  const nextTopicEntries = actionSplit.nextChecks;
  return [
    { key: "basic_info", title: "基本情報", lines: basicInfoLines },
    { key: "summary", title: "1. サマリー", lines: renderInterviewSummaryLines(summary) },
    {
      key: "details",
      title: "2. 学習状況と課題分析",
      lines: renderInterviewOptionalSectionLines(claims, "今回の面談では、学習状況や課題として追加で整理できる話はしていませんでした。"),
    },
    {
      key: "actions",
      title: "3. 今後の対策・指導内容",
      lines: renderInterviewOptionalSectionLines(strategyEntries, "今回の面談では、具体的な対策や指導方針までは話していませんでした。"),
    },
    {
      key: "share",
      title: "4. 志望校に関する検討事項",
      lines: renderInterviewOptionalSectionLines(sharePoints, "今回の面談では、志望校や進路の具体的な話はしていませんでした。"),
    },
    {
      key: "unknown",
      title: "5. 次回のお勧め話題",
      lines: renderInterviewOptionalSectionLines(nextTopicEntries, "今回の面談では、次回に向けた具体的な確認項目までは話していませんでした。"),
    },
  ] satisfies ConversationArtifactSection[];
}

function buildArtifactFromStructuredPayload(
  sessionType: SessionMode,
  input: DraftGenerationInput,
  payload: StructuredDraftPayload
) {
  const basicInfo = payload.basicInfo ?? null;
  const summary = ensureMinimum(
    normalizeEntryList(
      payload.summary,
      {
        maxTextChars: sessionType === "LESSON_REPORT" ? 180 : 360,
        includeLabelInText: sessionType === "LESSON_REPORT",
      },
      sessionType === "LESSON_REPORT" ? 3 : 4
    ),
    [],
    sessionType === "LESSON_REPORT" ? 2 : 2
  );

  const claims =
    sessionType === "LESSON_REPORT"
      ? ensureMinimum(
          normalizeEntryList(payload.claims, { defaultClaimType: "observed", maxTextChars: 120 }, 8),
          [],
          2
        )
      : ensureMinimum(
          normalizeEntryList(payload.claims, { defaultClaimType: "observed", maxTextChars: 220, includeLabelInText: false }, 8),
          [],
          3
        );

  const nextActions =
    sessionType === "LESSON_REPORT"
      ? ensureMinimum(
          normalizeEntryList(payload.nextActions, { defaultActionType: "assessment", maxTextChars: 110 }, 8),
          [],
          3
        )
      : ensureMinimum(
          normalizeEntryList(
            payload.nextActions,
            {
              defaultClaimType: "missing",
              defaultActionType: "assessment",
              maxTextChars: 220,
              includeLabelInText: false,
            },
            8
          ),
          [],
          3
        );

  const sharePoints = ensureMinimum(
    normalizeEntryList(
      payload.sharePoints,
      { maxTextChars: sessionType === "LESSON_REPORT" ? 110 : 220, includeLabelInText: false },
      6
    ),
    [],
    sessionType === "LESSON_REPORT" ? 2 : 1
  );

  if (sessionType === "LESSON_REPORT") {
    if (summary.length < 2 || claims.length < 2 || nextActions.length < 2 || sharePoints.length < 2) {
      return null;
    }
  } else {
    const interviewSignalCount = claims.length + nextActions.length + sharePoints.length;
    if (summary.length < 1 || interviewSignalCount < 2) {
      return null;
    }
  }

  const sections = buildSectionsFromEntries(
    sessionType,
    buildBasicInfoLines(sessionType, input, basicInfo),
    summary,
    claims,
    nextActions,
    sharePoints
  );
  const actionSplit = splitActionEntries(nextActions);

  return {
    version: "conversation-artifact/v1",
    sessionType,
    generatedAt: new Date().toISOString(),
    summary,
    claims,
    nextActions,
    sharePoints,
    facts: summary.map((entry) => entry.text).slice(0, 8),
    changes: claims.map((entry) => entry.text).slice(0, 8),
    assessment: actionSplit.assessment.map((entry) => entry.text).slice(0, 8),
    nextChecks: actionSplit.nextChecks.map((entry) => entry.text).slice(0, 8),
    sections,
  } satisfies ConversationArtifact;
}

function buildStructuredUserPrompt(input: DraftGenerationInput, draftInput: { label: string; content: string }) {
  return [
    "入力メタデータ:",
    `- 生徒: ${formatStudentLabel(input.studentName)}`,
    `- 講師: ${formatTeacherLabel(input.teacherName)}`,
    `- 日付: ${formatSessionDateLabel(input.sessionDate) || "不明"}`,
    ...(input.sessionType === "INTERVIEW" ? [`- 面談時間目安: ${formatDurationLabel(input.durationMinutes)}`] : []),
    `- 最低文字数目安: ${input.minSummaryChars}`,
    "",
    "入力:",
    `${draftInput.label}:`,
    draftInput.content,
  ].join("\n");
}

function buildRepairUserPrompt(
  errors: string[],
  previousRaw?: string | null
) {
  return [
    "再生成で直すこと:",
    ...errors.map((error) => `- ${error}`),
    ...(previousRaw ? ["", "前回の出力:", previousRaw.slice(0, 4000)] : []),
  ].join("\n");
}

function buildDeterministicRecovery(input: DraftGenerationInput) {
  const markdown =
    input.sessionType === "LESSON_REPORT"
      ? buildLessonDraftFallbackMarkdown(input)
      : buildInterviewDraftFallbackMarkdown(input);
  const artifact = buildConversationArtifactFromMarkdown({
    sessionType: input.sessionType ?? "INTERVIEW",
    summaryMarkdown: markdown,
    generatedAt: new Date(),
  });
  return {
    artifact,
    summaryMarkdown: renderConversationArtifactMarkdown(artifact),
  };
}

function isUnsafeStructuredSummary(markdown: string) {
  const trimmed = String(markdown ?? "").trim();
  if (!trimmed) return true;
  if (!trimmed.includes("■ 基本情報")) return true;
  if (/録音始めた|何喋ろうか忘れ|質問もありますか|以上です。お疲れ/.test(trimmed)) return true;
  const longLines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^根拠[:：]/.test(line))
    .filter((line) => line.length >= 150);
  return longLines.length >= 2;
}

export async function generateConversationDraftFast(input: DraftGenerationInput): Promise<DraftGenerationResult> {
  const sessionType = input.sessionType ?? "INTERVIEW";
  const draftInput = buildDraftInputBlock(sessionType, input.transcript);
  const model = getFastModel();
  const system = buildDraftSystemPrompt(sessionType);
  const user = buildStructuredUserPrompt(input, draftInput);
  const jsonSchema = buildStructuredArtifactJsonSchema(sessionType);
  const promptInputTokensEstimate = estimateTokens(system) + estimateTokens(user);
  const { promptCacheKey, promptCacheRetention } = resolvePromptCacheSettings(model, input, sessionType);

  let apiCalls = 0;
  let tokenUsage = emptyTokenUsage();
  const validationErrors: string[] = [];

  try {
    apiCalls += 1;
    const { json, raw, contentText, usage } = await callJsonGeneration({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      timeoutMs: Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000),
      max_output_tokens: sessionType === "LESSON_REPORT" ? 2200 : 3600,
      prompt_cache_key: promptCacheKey,
      prompt_cache_retention: promptCacheRetention ?? undefined,
      json_schema: jsonSchema,
    });
    tokenUsage = mergeTokenUsage(tokenUsage, usage);
    const artifact = buildArtifactFromStructuredPayload(sessionType, input, (json ?? {}) as StructuredDraftPayload);
    if (artifact) {
      const rendered = renderConversationArtifactMarkdown(artifact);
      if (!isUnsafeStructuredSummary(rendered)) {
        return {
          summaryMarkdown: rendered,
          artifact,
          model,
          apiCalls,
          evidenceChars: draftInput.content.length,
          usedFallback: false,
          inputTokensEstimate: promptInputTokensEstimate,
          tokenUsage,
          llmCostUsd: calculateOpenAiTextCostUsd(model, tokenUsage),
        };
      }
      validationErrors.push("構造化出力は得られたが、render 後に長すぎる行や unsafe な断片が残った。");
    } else {
      validationErrors.push("JSON は返ったが、必要な配列や text/evidence が足りない。");
    }
    if ((contentText ?? raw).trim()) {
      validationErrors.push("前回の出力は短い要点ではなく、情報の粒度や section 用データが不足していた。");
    }
  } catch (error) {
    validationErrors.push(error instanceof Error ? error.message : "structured generation failed");
  }

  try {
    apiCalls += 1;
    const { json, raw, contentText, usage } = await callJsonGeneration({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        { role: "user", content: buildRepairUserPrompt(validationErrors, undefined) },
      ],
      timeoutMs: Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000),
      max_output_tokens: sessionType === "LESSON_REPORT" ? 2400 : 4200,
      prompt_cache_key: promptCacheKey,
      prompt_cache_retention: promptCacheRetention ?? undefined,
      json_schema: jsonSchema,
    });
    tokenUsage = mergeTokenUsage(tokenUsage, usage);
    const artifact = buildArtifactFromStructuredPayload(sessionType, input, (json ?? {}) as StructuredDraftPayload);
    if (artifact) {
      const rendered = renderConversationArtifactMarkdown(artifact);
      if (!isUnsafeStructuredSummary(rendered)) {
        return {
          summaryMarkdown: rendered,
          artifact,
          model,
          apiCalls,
          evidenceChars: draftInput.content.length,
          usedFallback: false,
          inputTokensEstimate: promptInputTokensEstimate,
          tokenUsage,
          llmCostUsd: calculateOpenAiTextCostUsd(model, tokenUsage),
        };
      }
      validationErrors.push("repair 後も長すぎる行や unsafe な断片が残った。");
    } else {
      validationErrors.push("repair 後も JSON の shape が不足している。");
    }
    if ((contentText ?? raw).trim()) {
      validationErrors.push("repair 後も要点化と section 用データが足りない。");
    }
  } catch (error) {
    validationErrors.push(error instanceof Error ? error.message : "structured repair failed");
  }

  const recovered = buildDeterministicRecovery(input);
  return {
    summaryMarkdown: recovered.summaryMarkdown,
    artifact: recovered.artifact,
    model,
    apiCalls: Math.max(apiCalls, 1),
    evidenceChars: draftInput.content.length,
    usedFallback: true,
    inputTokensEstimate: promptInputTokensEstimate,
    tokenUsage,
    llmCostUsd: calculateOpenAiTextCostUsd(model, tokenUsage),
  };
}

export function getPromptVersion() {
  return PROMPT_VERSION;
}
