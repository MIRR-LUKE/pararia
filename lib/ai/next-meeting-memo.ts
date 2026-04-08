import { calculateOpenAiTextCostUsd } from "@/lib/ai/openai-pricing";
import {
  buildConversationArtifactFromMarkdown,
  parseConversationArtifact,
  type ConversationArtifact,
  type ConversationArtifactSection,
} from "@/lib/conversation-artifact";
import {
  isValidNextMeetingMemoText,
  sanitizeNextMeetingMemoText,
} from "@/lib/next-meeting-memo";
import { callJsonGeneration } from "@/lib/ai/conversation/transport";

const NEXT_MEETING_MEMO_MODEL =
  process.env.LLM_MODEL_FAST ||
  process.env.LLM_MODEL ||
  "gpt-5.4";
const PROMPT_VERSION = "next-meeting-memo/v1";

type NextMeetingMemoTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
};

export type NextMeetingMemoResult = {
  previousSummary: string;
  suggestedTopics: string;
  model: string;
  apiCalls: number;
  tokenUsage: NextMeetingMemoTokenUsage;
  llmCostUsd: number;
  sourceSections: Array<{ title: string; lines: string[] }>;
};

type NextMeetingMemoInput = {
  studentName?: string | null;
  sessionDate?: string | Date | null;
  artifactJson?: unknown;
  summaryMarkdown?: string | null;
};

function emptyTokenUsage(): NextMeetingMemoTokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
  };
}

function addTokenUsage(
  left: NextMeetingMemoTokenUsage,
  right?: Partial<NextMeetingMemoTokenUsage> | null
) {
  if (!right) return left;
  return {
    inputTokens: left.inputTokens + Math.max(0, Math.floor(Number(right.inputTokens ?? 0))),
    cachedInputTokens: left.cachedInputTokens + Math.max(0, Math.floor(Number(right.cachedInputTokens ?? 0))),
    outputTokens: left.outputTokens + Math.max(0, Math.floor(Number(right.outputTokens ?? 0))),
    totalTokens: left.totalTokens + Math.max(0, Math.floor(Number(right.totalTokens ?? 0))),
    reasoningTokens: left.reasoningTokens + Math.max(0, Math.floor(Number(right.reasoningTokens ?? 0))),
  };
}

function formatSessionDate(value?: string | Date | null) {
  if (!value) return "未記録";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "未記録";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function pickSections(artifact: ConversationArtifact) {
  const titles = [
    "5. 次回のお勧め話題",
    "1. サマリー",
    "2. 学習状況と課題分析",
    "3. 今後の対策・指導内容",
    "4. 志望校に関する検討事項",
  ];
  const byTitle = new Map(
    artifact.sections.map((section) => [section.title.replace(/^■\s*/, "").trim(), section])
  );
  const selected = titles
    .map((title) => byTitle.get(title) ?? null)
    .filter((section): section is ConversationArtifactSection => Boolean(section))
    .map((section) => ({
      title: section.title.replace(/^■\s*/, "").trim(),
      lines: section.lines
        .map((line) =>
          line
            .replace(/^[-*]\s*/, "")
            .replace(/^根拠[:：]\s*/i, "")
            .trim()
        )
        .filter(Boolean)
        .slice(0, 6),
    }))
    .filter((section) => section.lines.length > 0);

  if (selected.length > 0) return selected;

  return [
    {
      title: "1. サマリー",
      lines: artifact.summary.map((entry) => entry.text).filter(Boolean).slice(0, 4),
    },
    {
      title: "2. 学習状況と課題分析",
      lines: artifact.claims.map((entry) => entry.text).filter(Boolean).slice(0, 5),
    },
    {
      title: "3. 今後の対策・指導内容",
      lines: artifact.nextActions
        .filter((entry) => entry.actionType !== "nextCheck")
        .map((entry) => entry.text)
        .filter(Boolean)
        .slice(0, 5),
    },
    {
      title: "5. 次回のお勧め話題",
      lines: artifact.nextChecks.filter(Boolean).slice(0, 5),
    },
  ].filter((section) => section.lines.length > 0);
}

function buildSystemPrompt() {
  return [
    "あなたは学習塾の教務担当です。面談ログをもとに、次回の面談で一瞬で読める短いメモだけを作ります。",
    "出力は JSON object のみです。",
    "必ず日本語だけで書いてください。",
    "previousSummary と suggestedTopics の 2 つだけを返してください。",
    "previousSummary は『前回の面談まとめ』用です。前回決めたこと、気をつけること、まだ残っていることを 2〜3 文で短くまとめてください。",
    "suggestedTopics は『おすすめの話題』用です。次回に何から確認するか、何を話した方がいいかを 2〜3 文で短くまとめてください。",
    "箇条書きは禁止です。",
    "1 文で言いたいことは 1 つだけにしてください。",
    "長い前置き、見出し、番号、補足説明は禁止です。",
    "難しい言葉や固い言葉は避けてください。",
    "『論点』『観点』『整理した』『粒度』『切り分け』『示唆』『進捗確認』は使わないでください。",
    "『決めた』『見る』『話す』『残す』『進める』『確認する』『まだ決まっていない』『気をつける』のような平易な言葉を優先してください。",
    "ログにない事実は足さないでください。",
    "同じ文の始まり方を続けないでください。",
  ].join("\n");
}

function buildUserPrompt(input: {
  studentName: string;
  sessionDate: string;
  sections: Array<{ title: string; lines: string[] }>;
}) {
  return [
    `対象生徒: ${input.studentName}`,
    `面談日: ${input.sessionDate}`,
    "",
    "面談ログから使ってよい材料:",
    ...input.sections.flatMap((section) => [
      `【${section.title}】`,
      ...section.lines.map((line) => `- ${line}`),
      "",
    ]),
    "出力ルール:",
    "- previousSummary は 110〜180 文字くらいを目安にする",
    "- suggestedTopics も 110〜180 文字くらいを目安にする",
    "- どちらも 2〜3 文で止める",
    "- 見出しや箇条書きは入れない",
  ].join("\n");
}

function buildRepairPrompt(previousRaw?: string | null) {
  return [
    "出力を作り直してください。",
    "- 箇条書きは使わない",
    "- 2〜3 文で止める",
    "- 難しい言葉を減らす",
    "- 文字数を詰めすぎず、でも長くしすぎない",
    ...(previousRaw ? ["", "前回の出力:", previousRaw.slice(0, 2000)] : []),
  ].join("\n");
}

function parseOutput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const current = value as Record<string, unknown>;
  const previousSummary = sanitizeNextMeetingMemoText(current.previousSummary, 220);
  const suggestedTopics = sanitizeNextMeetingMemoText(current.suggestedTopics, 220);
  if (!isValidNextMeetingMemoText(previousSummary) || !isValidNextMeetingMemoText(suggestedTopics)) {
    return null;
  }
  return {
    previousSummary,
    suggestedTopics,
  };
}

export function buildNextMeetingMemoSource(input: NextMeetingMemoInput) {
  const effectiveArtifact =
    parseConversationArtifact(input.artifactJson) ??
    (input.summaryMarkdown
      ? buildConversationArtifactFromMarkdown({
          sessionType: "INTERVIEW",
          summaryMarkdown: input.summaryMarkdown,
          generatedAt: new Date(),
        })
      : null);

  if (!effectiveArtifact || effectiveArtifact.sessionType !== "INTERVIEW") {
    return null;
  }

  return {
    artifact: effectiveArtifact,
    sections: pickSections(effectiveArtifact),
  };
}

export async function generateNextMeetingMemo(input: NextMeetingMemoInput): Promise<NextMeetingMemoResult> {
  const source = buildNextMeetingMemoSource(input);
  if (!source || source.sections.length === 0) {
    throw new Error("面談ログの要点が不足しているため、次回の面談メモを作成できません。");
  }

  const studentName = input.studentName?.trim() || "生徒";
  const sessionDate = formatSessionDate(input.sessionDate);
  const model = NEXT_MEETING_MEMO_MODEL;
  let apiCalls = 0;
  let tokenUsage = emptyTokenUsage();
  let previousRaw = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    apiCalls += 1;
    const result = await callJsonGeneration({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt({ studentName, sessionDate, sections: source.sections }) },
        ...(attempt > 0 ? [{ role: "user" as const, content: buildRepairPrompt(previousRaw) }] : []),
      ],
      timeoutMs: Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000),
      max_output_tokens: 500,
      temperature: 0.2,
      json_schema: {
        name: "next_meeting_memo",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            previousSummary: { type: "string" },
            suggestedTopics: { type: "string" },
          },
          required: ["previousSummary", "suggestedTopics"],
        },
      },
    });
    tokenUsage = addTokenUsage(tokenUsage, result.usage);
    previousRaw = result.contentText ?? result.raw ?? "";

    const parsed = parseOutput(result.json);
    if (!parsed) continue;

    return {
      ...parsed,
      model,
      apiCalls,
      tokenUsage,
      llmCostUsd: calculateOpenAiTextCostUsd(model, tokenUsage),
      sourceSections: source.sections,
    };
  }

  throw new Error("次回の面談メモを安定した形式で生成できませんでした。");
}

export function getNextMeetingMemoPromptVersion() {
  return PROMPT_VERSION;
}
