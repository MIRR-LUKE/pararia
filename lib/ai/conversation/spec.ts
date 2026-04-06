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
    "特に、学習状況の整理、受験戦略、志望校の検討、次回の声かけ材料が自然に並ぶようにしてください。",
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
    "basicInfo.purpose は 12-40 文字程度で、今回の面談テーマを簡潔に入れる。例: `受験戦略と志望校の最終検討`。明確でなければ `学習状況の確認と次回方針の整理` に寄せる。",
    "summary は 2 件前後。各 text は 3-6 文のまとまった段落にし、管理者がそのまま読める自然な面談要約にする。",
    "summary では、学習状況、失点要因や課題、今回決めた方針、進路の話があればその流れまで入れる。",
    "summary は transcript の要約であり、逐語引用や発話の丸貼りではない。口語をそのまま残さない。",
    "claims は 3-6 件で、主に `2. 学習状況と課題分析` に相当する内容を入れる。前向きな話だけでなく、今の状態・弱点・失点要因を具体的に書く。",
    "claims.text は 1-3 文で、`国語は...` `時間配分は...` のように論点がすぐ分かる書き方にする。",
    "nextActions は 4-7 件。`actionType=assessment` は `3. 今後の対策・指導内容`、`actionType=nextCheck` は `5. 次回のお勧め話題` に使う。",
    "nextActions.label は `国語` `数学` `時間配分` `ルール運用` `進路` のような短い論点名にする。",
    "assessment の text は、今後どう指導するか・何を徹底するかまで含めて書く。",
    "nextCheck の text は、次回面談でそのまま使える声かけや確認質問にする。",
    "sharePoints は 1-4 件。主に `4. 志望校に関する検討事項` に相当する内容を入れる。学校名、受験方式、三者面談、進学ルートなどがあれば優先して書く。",
    "進路や志望校の話があるときは sharePoints に必ず反映する。",
    "その section に当たる話がなければ、無理に作らず空配列にする。こちらで `今回の面談では話していませんでした。` と表示する。",
    "各 evidence は短い根拠断片 1-2 本に絞る。長い transcript の丸貼りは禁止。",
    "ノイズ音声、言い淀み、壊れた引用の貼り付けは禁止。",
    "抽象語だけで済ませず、教材名・志望校名・受験方式・生活習慣・学習行動など確認できた具体語を残す。",
    "claims / nextActions / sharePoints は、`良かったです` `頑張りましょう` のような抽象的な励ましで埋めない。",
    "足りない話題を想像で補わない。該当しない見出しは空で返す。",
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
