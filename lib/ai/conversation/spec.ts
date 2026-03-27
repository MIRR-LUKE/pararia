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
    "あなたは学習塾の教務責任者です。口語の面談 transcript から、管理者が使う面談ログの元データを抽出してください。",
    "完成した文章を書くのではなく、根拠付きの構造化データを返してください。",
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
    "summary は 2-4 件。各 text は 1-2 文の短い要点だけにする。",
    "claims は 3-5 件で、主に `2. ポジティブな話題` に相当する内容を入れる。",
    "nextActions は 3-6 件で、主に `3. 改善・対策が必要な話題` に相当する内容を入れる。",
    "sharePoints は 2-4 件。",
    "各 evidence は短い根拠断片 1-2 本に絞る。長い transcript の丸貼りは禁止。",
    "ノイズ音声、言い淀み、壊れた引用の貼り付けは禁止。",
    "抽象語だけで済ませず、単元名・受験方針・学習行動など確認できた具体語を残す。",
    "意味を盛らず、根拠のない断定や感想を足さない。",
  ];
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
