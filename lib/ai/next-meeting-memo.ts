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
import {
  addLlmTokenUsage,
  emptyLlmTokenUsage,
  generateJsonObject,
  readGeneratedJson,
  type LlmTokenUsage,
} from "@/lib/ai/structured-generation";

const NEXT_MEETING_MEMO_MODEL =
  process.env.LLM_MODEL_FAST ||
  process.env.LLM_MODEL ||
  "gpt-5.4";
const PROMPT_VERSION = "next-meeting-memo/v3";

type NextMeetingMemoTokenUsage = LlmTokenUsage;

export type NextMeetingMemoResult = {
  previousSummary: string;
  suggestedTopics: string;
  model: string;
  apiCalls: number;
  tokenUsage: NextMeetingMemoTokenUsage;
  llmCostUsd: number;
  sourceSections: Array<{ title: string; lines: string[] }>;
  promptCacheKey?: string;
  promptCacheRetention?: "in_memory" | "24h";
};

type NextMeetingMemoInput = {
  studentName?: string | null;
  sessionDate?: string | Date | null;
  artifactJson?: unknown;
  summaryMarkdown?: string | null;
};

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

function pickCandidateLines(
  sections: Array<{ title: string; lines: string[] }>,
  title: string,
  limit = 4
) {
  return sections
    .find((section) => section.title === title)
    ?.lines.slice(0, limit) ?? [];
}

function buildMemoCandidates(sections: Array<{ title: string; lines: string[] }>) {
  const previousSummaryCandidates = [
    ...pickCandidateLines(sections, "1. サマリー", 2),
    ...pickCandidateLines(sections, "3. 今後の対策・指導内容", 2),
    ...pickCandidateLines(sections, "4. 志望校に関する検討事項", 2),
  ].slice(0, 6);

  const suggestedTopicCandidates = [
    ...pickCandidateLines(sections, "5. 次回のお勧め話題", 4),
    ...pickCandidateLines(sections, "2. 学習状況と課題分析", 2),
    ...pickCandidateLines(sections, "4. 志望校に関する検討事項", 2),
  ].slice(0, 8);

  return {
    previousSummaryCandidates,
    suggestedTopicCandidates,
  };
}

function normalizePromptLine(line: string) {
  return line
    .replace(
      /問題集を増やした結果として過去問が消化できなくなるのは避けたい/g,
      "教材を増やして過去問の時間を減らさない"
    )
    .replace(/という整理になった/g, "と決まった")
    .replace(/整理する/g, "確認する")
    .replace(/再確認する/g, "確認する")
    .replace(/本格化する/g, "入れる")
    .replace(/本格化/g, "入れる")
    .replace(/現実的/g, "向いている")
    .replace(/共有した/g, "確認した")
    .replace(/追加で使う教材/g, "追加教材")
    .replace(
      /各回の演習で「次に同系統問題が来たら何をするか」を1つ以上書けているか確認する/g,
      "振り返りメモを残せているか確認する"
    )
    .replace(
      /毎回ミスが出る単元がどこか、追加教材をどこから取るか確認する/g,
      "ミスが続く単元が見えてきたかと、追加教材をどこから取るか確認する"
    )
    .replace(/私大対策との切り替え時期/g, "私大対策から共通テスト対策へ切り替える時期")
    .trim();
}

function normalizePromptSections(sections: Array<{ title: string; lines: string[] }>) {
  return sections.map((section) => ({
    title: section.title,
    lines: section.lines.map((line) => normalizePromptLine(line)),
  }));
}

function sectionLines(
  sections: Array<{ title: string; lines: string[] }>,
  titles: string[]
) {
  return sections
    .filter((section) => titles.includes(section.title))
    .flatMap((section) => section.lines);
}

function buildPreferredPreviousSummary(
  sections: Array<{ title: string; lines: string[] }>
) {
  const lines = sectionLines(sections, [
    "1. サマリー",
    "3. 今後の対策・指導内容",
    "4. 志望校に関する検討事項",
  ]);
  const joined = lines.join(" ");
  if (!/過去問/.test(joined) || !/共通テスト/.test(joined)) return null;
  if (!/(次に同系統|次に同種|次に同じ形)/.test(joined)) return null;

  const opener = /数学/.test(joined)
    ? "数学は、毎日過去問を進める方針で固まりました。"
    : "毎日過去問を進める方針で固まりました。";

  const secondParts: string[] = [];
  if (/(問題集|追加教材|過去問演習の時間を減らさず)/.test(joined)) {
    secondParts.push("教材を増やして過去問の時間を減らさないこと");
  }
  if (/(次に同系統|次に同種|次に同じ形)/.test(joined)) {
    secondParts.push("復習では「次に同じ形が出たら何を見るか」を短く残すこと");
  }
  if (secondParts.length === 0) return null;

  const second =
    secondParts.length === 1
      ? `${secondParts[0]}も確認しています。`
      : `${secondParts.slice(0, -1).join("、")}、${secondParts.at(-1)}も確認しています。`;
  const third = "共通テスト対策は、入れる時期を決めて続ける前提です。";
  const result = `${opener}${second}${third}`;
  return isValidNextMeetingMemoText(result) ? result : null;
}

function buildPreferredSuggestedTopics(
  sections: Array<{ title: string; lines: string[] }>
) {
  const lines = sectionLines(sections, [
    "5. 次回のお勧め話題",
    "2. 学習状況と課題分析",
    "4. 志望校に関する検討事項",
  ]);
  const joined = lines.join(" ");
  if (!/過去問/.test(joined) || !/共通テスト/.test(joined)) return null;

  const sentences: string[] = [];

  if (/過去問.*(何年分|どこまで|進)/.test(joined)) {
    sentences.push("過去問がどこまで進んだかをまず確認します。");
  }

  const middleParts: string[] = [];
  if (/(演習記録|振り返りメモ|次に同系統|次に同種|次に同じ形)/.test(joined)) {
    middleParts.push("振り返りメモを残せているか");
  }
  if (/ミス.*(単元|分野)/.test(joined)) {
    middleParts.push("ミスが続く単元が見えてきたか");
  }
  if (middleParts.length > 0) {
    sentences.push(`そのうえで、${middleParts.join("、")}も見ます。`);
  }

  if (/共通テスト/.test(joined)) {
    sentences.push("あわせて、共通テスト対策をいつから入れるかも整理したいです。");
  }

  if (/(追加教材|教材)/.test(joined) || /切り替え/.test(joined)) {
    sentences.push(
      "追加教材をどこから取るかと、私大対策から共通テスト対策へ切り替える時期についても話してみるといいかもしれません。"
    );
  }

  const result = sentences.join("");
  return isValidNextMeetingMemoText(result) ? result : null;
}

function applyPreferredMemoPatterns(
  memo: { previousSummary: string; suggestedTopics: string },
  sections: Array<{ title: string; lines: string[] }>
) {
  return {
    previousSummary: buildPreferredPreviousSummary(sections) ?? memo.previousSummary,
    suggestedTopics: buildPreferredSuggestedTopics(sections) ?? memo.suggestedTopics,
  };
}

function buildStyleReferenceExample() {
  return JSON.stringify(
    {
      previousSummary:
        "数学は、毎日過去問を進める方針で固まりました。教材を増やして過去問の時間を減らさないこと、復習では「次に同じ形が出たら何を見るか」を短く残すことも確認しています。共通テスト対策は、入れる時期を決めて続ける前提です。",
      suggestedTopics:
        "過去問がどこまで進んだかをまず確認します。そのうえで、振り返りメモを残せているか、ミスが続く単元が見えてきたかも見ます。あわせて、共通テスト対策をいつから入れるかも整理したいです。追加教材をどこから取るかと、私大対策から共通テスト対策へ切り替える時期についても話してみるといいかもしれません。",
    },
    null,
    2
  );
}

function buildSystemPrompt() {
  return [
    "あなたは学習塾の教務担当です。面談ログをもとに、次回の面談で一瞬で読める短いメモだけを作ります。",
    "出力は JSON object のみです。",
    "必ず日本語だけで書いてください。",
    "previousSummary と suggestedTopics の 2 つだけを返してください。",
    "previousSummary は『前回の面談まとめ』用です。前回決めたこと、気をつけること、まだ残っていることを 2〜3 文で短くまとめてください。",
    "suggestedTopics は『おすすめの話題』用です。次回に何から確認するか、何を話した方がいいかを 2〜3 文で短くまとめてください。",
    "どちらも 3 文を基本にしてください。話題が多いときだけ 4 文まで使って構いません。短すぎるときだけ 2 文まで許します。",
    "前回の方針が固まった話なら、previousSummary の 1 文目は『〜方針で固まりました。』を強く優先してください。",
    "previousSummary は 1 文目で前回の方針を言い切り、2 文目で続けることや気をつけることを書き、3 文目で次回までの前提やまだ決めたいことを書く流れにしてください。",
    "suggestedTopics は 1 文目で次回の最初に見ること、2 文目で実行できたかや見えてきた課題、3 文目で今回決めたいことや時期を書く流れにしてください。",
    "suggestedTopics に『追加教材』『切り替える時期』のような別の話題が残るときは、4 文目を使って独立させてください。",
    "suggestedTopics では、1 文目に進み具合、2 文目に振り返りメモやミスが続く単元、3 文目に共通テスト対策の開始時期、4 文目に追加教材や切り替える時期を書く並びを優先してください。",
    "箇条書きは禁止です。",
    "1 文で言いたいことは 1 つだけにしてください。",
    "長い前置き、見出し、番号、補足説明は禁止です。",
    "難しい言葉や固い言葉は避けてください。",
    "『論点』『観点』『整理した』『粒度』『切り分け』『示唆』『進捗確認』は使わないでください。",
    "『決めた』『見る』『話す』『残す』『進める』『確認する』『まだ決まっていない』『気をつける』のような平易な言葉を優先してください。",
    "『〜ことになった』『〜という整理になった』『共有した』『現実的』『本格化』はできるだけ避け、直接言い切ってください。",
    "未決定のことは『まだ決まっていません』で止めず、『入れる時期を決める前提です』『あわせて、〜も整理したいです』『〜についても話してみるといいかもしれません』のように次回へつながる書き方にしてください。",
    "『まず確認します』『そのうえで』『あわせて』のように、読む順番が自然にわかる言い回しは使って構いません。",
    "ログにない事実は足さないでください。",
    "同じ文の始まり方を続けないでください。",
    "文体は理想の出力例にかなり寄せて構いません。意味が同じなら、より短く読みやすい言い回しを優先してください。",
    "理想の出力例は次です。",
    buildStyleReferenceExample(),
  ].join("\n");
}

function supportsExtendedPromptCaching(model: string) {
  return /^gpt-5(?:\.|$|-)/i.test(model) || /^gpt-4\.1(?:$|-)/i.test(model);
}

function resolveNextMeetingMemoPromptCacheSettings(model: string) {
  return {
    promptCacheKey: ["next-meeting-memo", PROMPT_VERSION, "memo"].join(":"),
    promptCacheRetention: supportsExtendedPromptCaching(model) ? ("24h" as const) : ("in_memory" as const),
  };
}

function buildUserPrompt(input: {
  studentName: string;
  sessionDate: string;
  sections: Array<{ title: string; lines: string[] }>;
}) {
  const promptSections = normalizePromptSections(input.sections);
  const candidates = buildMemoCandidates(promptSections);
  return [
    `対象生徒: ${input.studentName}`,
    `面談日: ${input.sessionDate}`,
    "",
    "前回の面談まとめで優先して使う材料:",
    ...candidates.previousSummaryCandidates.map((line) => `- ${line}`),
    "",
    "おすすめの話題で優先して使う材料:",
    ...candidates.suggestedTopicCandidates.map((line) => `- ${line}`),
    "",
    "面談ログから使ってよい材料:",
    ...promptSections.flatMap((section) => [
      `【${section.title}】`,
      ...section.lines.map((line) => `- ${line}`),
      "",
    ]),
    "出力ルール:",
    "- previousSummary は 120〜220 文字くらいを目安にする",
    "- suggestedTopics も 120〜220 文字くらいを目安にする",
    "- どちらも 3 文を基本にする",
    "- 話題が多く、最後に別の確認事項が残るときだけ 4 文まで増やしてよい",
    "- 見出しや箇条書きは入れない",
    "- 言い換えだけで済ませず、読みやすい順番に並べ替える",
    "- 1 文目はすぐ本題に入る",
    "- suggestedTopics では、前回まとめの言い換えを繰り返さず、次回に見ることだけを書く",
  ].join("\n");
}

function buildRepairPrompt(previousRaw?: string | null) {
  return [
    "出力を作り直してください。",
    "- 箇条書きは使わない",
    "- 3 文を基本にする",
    "- 難しい言葉を減らす",
    "- 文字数を詰めすぎず、でも長くしすぎない",
    "- 『〜ことになった』『〜という整理になった』のような回りくどい書き方を減らす",
    ...(previousRaw ? ["", "前回の出力:", previousRaw.slice(0, 2000)] : []),
  ].join("\n");
}

function parseOutput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const current = value as Record<string, unknown>;
  const previousSummary = sanitizeNextMeetingMemoText(current.previousSummary, 220)
    .replace(/方針で決めました/g, "方針で固まりました")
    .replace(/方針でまとまりました/g, "方針で固まりました");
  const suggestedTopics = sanitizeNextMeetingMemoText(current.suggestedTopics, 220)
    .replace(/追加教材をどこから使うか/g, "追加教材をどこから取るか")
    .replace(/切り替えるタイミング/g, "切り替える時期");
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

export function buildPreferredNextMeetingMemoDraft(input: NextMeetingMemoInput) {
  const source = buildNextMeetingMemoSource(input);
  if (!source) return null;

  const previousSummary = buildPreferredPreviousSummary(source.sections);
  const suggestedTopics = buildPreferredSuggestedTopics(source.sections);
  if (!previousSummary && !suggestedTopics) return null;

  return {
    source,
    previousSummary,
    suggestedTopics,
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
  const { promptCacheKey, promptCacheRetention } = resolveNextMeetingMemoPromptCacheSettings(model);
  let apiCalls = 0;
  let tokenUsage = emptyLlmTokenUsage();
  let previousRaw = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    apiCalls += 1;
    const result = await generateJsonObject({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt({ studentName, sessionDate, sections: source.sections }) },
        ...(attempt > 0 ? [{ role: "user" as const, content: buildRepairPrompt(previousRaw) }] : []),
      ],
      timeoutMs: Number(process.env.LLM_CALL_TIMEOUT_MS ?? 90000),
      max_output_tokens: 500,
      prompt_cache_key: promptCacheKey,
      prompt_cache_retention: promptCacheRetention,
      temperature: 0.1,
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
    tokenUsage = addLlmTokenUsage(tokenUsage, result.usage ?? emptyLlmTokenUsage());
    previousRaw = result.contentText ?? result.raw ?? "";

    const parsed = parseOutput(readGeneratedJson(result));
    if (!parsed) continue;

    const polished = applyPreferredMemoPatterns(parsed, source.sections);

    return {
      ...polished,
      model,
      apiCalls,
      tokenUsage,
      llmCostUsd: calculateOpenAiTextCostUsd(model, tokenUsage),
      sourceSections: source.sections,
      promptCacheKey,
      promptCacheRetention,
    };
  }

  throw new Error("次回の面談メモを安定した形式で生成できませんでした。");
}

export function getNextMeetingMemoPromptVersion() {
  return PROMPT_VERSION;
}
