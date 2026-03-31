import type { SessionMode } from "./types";

function buildEvidenceFirstRules() {
  return [
    "transcript にない事実は足さず、指定した JSON オブジェクトだけを返してください。",
    "- transcript にない事実は足さない。",
    "- reviewedTranscript があればそれを優先し、なければ raw transcript を使う。",
    "- 推測は推測、観察は観察、不足は不足として分ける。",
    "- 重要な項目には必ず根拠を付ける。",
    "- きれいな言い換えより、根拠のある教務ログを優先する。",
    "- 固有名詞が怪しいときは断定しない。",
    "- fallback でも意味を盛らない。",
    "- 指示は先に、入力や背景はあとにまとめる。",
    "- 本文に長い逐語転写を貼らない。会話の往復をそのまま並べない。",
    "- 各本文行は短く要点化し、同じ内容を別セクションで繰り返さない。",
    "- `根拠:` は短い引用や要点の抜き出しにし、長い transcript の丸貼りにしない。",
    "- `では録音を始め...` のような導入、相づち、言い淀み、質問文の連打は本文に残さない。",
  ];
}

function buildPromptContextLines(sessionType: SessionMode) {
  if (sessionType === "LESSON_REPORT") {
    return [
      "文脈:",
      "あなたは学習塾の教務責任者です。口語の授業 transcript から、管理者が使う指導報告の元データを抽出してください。",
      "完成した文章を書くのではなく、根拠付きの構造化データを返してください。",
    ];
  }

  return [
    "文脈:",
    "あなたは学習塾の教務責任者です。口語の面談 transcript から、管理者がそのまま読める面談ログの元データを抽出してください。",
    "完成した本文そのものではなく、あとで面談ログに整えやすい根拠付きの構造化データを返してください。",
  ];
}

export function buildStructuredArtifactSpec(isLesson: boolean) {
  if (isLesson) {
    return [
      "出力 JSON の shape:",
      '{ "basicInfo": { "student": string, "teacher": string, "date": string, "subjectUnit": string }, "summary": [{ "text": string, "evidence": string[] }], "claims": [{ "label": string, "claimType": "observed" | "inferred" | "missing", "text": string, "evidence": string[] }], "nextActions": [{ "label": string, "actionType": "assessment" | "nextCheck", "text": string, "evidence": string[] }], "sharePoints": [{ "text": string, "evidence": string[] }] }',
      "summary は 2-3 件。各 text は 1-2 文の短い要点だけにする。",
      "claims は 2-4 件。`label` は `条件整理` や `再現確認` のような短い論点名にする。",
      "nextActions は最低 3 件。`生徒` `次回までの宿題` `次回の確認（テスト）事項` が読み取れるように `label` を付ける。",
      "sharePoints は 2-4 件。",
      "各 evidence は短い根拠断片 1-2 本に絞る。長い transcript の丸貼りは禁止。",
      "授業前チェックイン / 授業後チェックアウト の逐語転写は禁止。",
      "ノイズ音声、言い淀み、壊れた固有名詞をそのまま出さない。",
      "抽象語だけで済ませず、確認できた事実・残課題・次回確認事項を具体化する。",
      "意味を盛らず、根拠のない背景説明や感想は足さない。",
    ];
  }
  return [
    "出力 JSON の shape:",
    '{ "basicInfo": { "student": string, "teacher": string, "date": string, "purpose": string }, "summary": [{ "text": string, "evidence": string[] }], "claims": [{ "claimType": "observed" | "inferred" | "missing", "text": string, "evidence": string[] }], "nextActions": [{ "label": string, "actionType": "assessment" | "nextCheck", "text": string, "evidence": string[] }], "sharePoints": [{ "text": string, "evidence": string[] }] }',
    "basicInfo.purpose は 8-32 文字程度で、今回の面談の目的を簡潔に入れる。明確でなければ `学習状況の確認と次回方針の整理` に寄せる。",
    "summary は 2-3 件。各 text は 2-5 文のまとまった段落にし、学習状況・課題・生活面・進路・次回方針の流れが読めるようにする。",
    "summary は transcript の要約であり、逐語引用や発話の丸貼りではない。管理者がそのまま読める自然な教務文にする。",
    "claims は 3-5 件で、主に `2. ポジティブな話題` に相当する前向きな事実や本人の強みを入れる。各 text は 1 文で簡潔にする。",
    "nextActions は 4-6 件で、主に `3. 改善・対策が必要な話題` に相当する内容を入れる。課題だけでなく、必要な対策や今後の見方まで含めて 1 文で書く。",
    "nextActions.label は `英語` `数学` `生活習慣` `進路` のような短い論点名にする。",
    "nextActions.actionType は、今回の判断や対策なら `assessment`、次回に確認したい事項なら `nextCheck` にする。",
    "sharePoints は 2-4 件。これは内部利用の共有ポイントで、summary や claims と丸かぶりさせない。",
    "各 evidence は短い根拠断片 1-2 本に絞る。長い transcript の丸貼りは禁止。",
    "ノイズ音声、言い淀み、壊れた引用の貼り付けは禁止。",
    "抽象語だけで済ませず、教材名・志望校レベル・生活習慣・学習行動など確認できた具体語を残す。",
    "claims / nextActions / sharePoints は、`良かったです` `頑張りましょう` のような抽象的な励ましで埋めない。",
    "意味を盛らず、根拠のない断定や感想を足さない。",
  ];
}

function buildEntryArraySchema(itemSchema: Record<string, unknown>) {
  return {
    type: "array",
    items: itemSchema,
  };
}

function buildSummaryItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
      evidence: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["text", "evidence"],
  };
}

function buildClaimItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
      evidence: {
        type: "array",
        items: { type: "string" },
      },
      claimType: {
        type: "string",
        enum: ["observed", "inferred", "missing"],
      },
    },
    required: ["text", "evidence", "claimType"],
  };
}

function buildNextActionItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { type: "string" },
      text: { type: "string" },
      evidence: {
        type: "array",
        items: { type: "string" },
      },
      actionType: {
        type: "string",
        enum: ["assessment", "nextCheck"],
      },
    },
    required: ["label", "text", "evidence", "actionType"],
  };
}

function buildSharePointSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
      evidence: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["text", "evidence"],
  };
}

export function buildStructuredArtifactJsonSchema(sessionType: SessionMode) {
  const interview = sessionType !== "LESSON_REPORT";
  return {
    name: interview ? "interview_log_artifact" : "lesson_report_artifact",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        basicInfo: {
          type: "object",
          additionalProperties: false,
          properties: interview
            ? {
                student: { type: "string" },
                teacher: { type: "string" },
                date: { type: "string" },
                purpose: { type: "string" },
              }
            : {
                student: { type: "string" },
                teacher: { type: "string" },
                date: { type: "string" },
                subjectUnit: { type: "string" },
              },
          required: interview
            ? ["student", "teacher", "date", "purpose"]
            : ["student", "teacher", "date", "subjectUnit"],
        },
        summary: buildEntryArraySchema(buildSummaryItemSchema()),
        claims: buildEntryArraySchema(buildClaimItemSchema()),
        nextActions: buildEntryArraySchema(buildNextActionItemSchema()),
        sharePoints: buildEntryArraySchema(buildSharePointSchema()),
      },
      required: ["basicInfo", "summary", "claims", "nextActions", "sharePoints"],
    },
  };
}

function buildPromptBody(sessionType: SessionMode) {
  return [
    ...buildEvidenceFirstRules(),
    ...buildPromptContextLines(sessionType),
    ...buildStructuredArtifactSpec(sessionType === "LESSON_REPORT"),
  ];
}

function buildRetrySupplementLines() {
  return [
    "再生成の補足:",
    "- 直前の出力は要件を満たしていない。",
    "- 根拠が弱い内容は削り、根拠がある項目だけを残す。",
    "- 観察 / 推測 / 不足 と 判断 / 次回確認 の分離を崩さない。",
    "- 文章をきれいに見せるための言い換えより、元 transcript に沿った構造化データを優先する。",
  ];
}

export function buildDraftSystemPrompt(sessionType: SessionMode) {
  return buildPromptBody(sessionType).join("\n");
}

export function buildDraftRetrySystemPrompt(sessionType: SessionMode) {
  return [
    ...buildPromptBody(sessionType),
    ...buildRetrySupplementLines(),
  ].join("\n");
}
