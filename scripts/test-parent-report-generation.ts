import assert from "node:assert/strict";

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key";

const weakJson = {
  date: "2026-04-08",
  openingParagraph: "現在の状況をまとめてご報告いたします。",
  detailParagraphs: [
    "今回の記録から、学習状況と確認事項を整理しました。",
    "今後も継続して確認します。",
    "次回も様子を見ていきます。",
  ],
  closingParagraph: "引き続きよろしくお願いいたします。",
};

const improvedJson = {
  date: "2026-04-08",
  openingParagraph:
    "今月は、焦って新しいことを増やすのではなく、いま使っている教材を最後までやり切る方針へ気持ちを整えていく時間になったと感じています。",
  detailParagraphs: [
    "国語では、大問2の基礎問での失点をきっかけに、参考書を増やすよりも、いま使っている教材をしっかり理解しながら最後までやり切る方針で落ち着きました。語句の意味理解が曖昧なまま進んでいた点が見えてきたからこそ、やり方を増やすより、いまの教材で『分かったつもり』を残さないことが大切だという話をしました。",
    "受験勉強では、目先の不安から次々にやり方を変えてしまうより、今の自分に合った方法を定めて積み上げていくことの方が、最終的には安定した力につながることが多いです。太郎さんも今、その大事な段階に入ってきていると感じています。",
    "今月特に印象的だったのは、できていないことに意識が向きやすい中でも、どこでつまずいたかを以前より言葉にできるようになってきたことでした。ただ落ち込むだけで終わらず、自分の弱さを見つけたうえで立て直そうとしている点に、前向きな変化が出てきているように思います。",
    "今月の成長として大きかったのは、基礎問を落とした事実をそのまま受け止めたうえで、次に何を積み上げればよいかを一緒に整理できたことです。来月も、できていないことばかりに引っ張られず、今できていることも確認しながら小さな成功体験を重ねていけるよう、特に意識して見ていきたいと考えています。",
  ],
  closingParagraph:
    "引き続き、太郎さんが焦りに振り回されず、自分に合うやり方で基礎を積み上げていけるよう、丁寧に見てまいります。",
};

const realNameStyleJson = {
  date: "2026-04-08",
  openingParagraph:
    "今月は、美莉愛さんの学習内容をただ増やすのではなく、教材の使い方や復習の進め方を落ち着いて整理しながら、自分に合う形を固めていく時間になったと感じています。",
  detailParagraphs: [
    "英語では、教材を変えるべきかという迷いもありましたが、今の段階では新しいものを増やすより、一冊の中で間違えた理由をきちんと理解しながら進める方が大切だという話をしました。どの問題で止まったのかをそのままにせず、自分の言葉で説明できるところまで持っていくことが、今後の土台づくりにつながると見ています。",
    "受験勉強では、目先の不安から次々にやり方を変えてしまうより、今の自分に合った方法を定めて積み上げていくことの方が、最終的には安定した力につながることが多いです。美莉愛さんも今、その大事な段階に入ってきていると感じています。",
    "今月特に印象的だったのは、不安がありながらも、自分がどこに向かいたいのかを以前より言葉にしながら考えられるようになってきていることでした。できていないことだけに引っ張られず、今積み上がっていることも確認しながら前に進もうとしている点に、以前とは違う強さが表れているように思います。",
    "今月の成長として大きかったのは、やり方を増やして不安を広げるのではなく、自分に合う形を決めて続けようとしていることです。来月も、今できていることや積み上がってきていることをきちんと確認しながら、小さな成功体験を重ねていけるよう意識して見ていきたいと考えています。",
  ],
  closingParagraph:
    "引き続き、美莉愛さんが教材や結果に振り回されすぎず、自分に合うやり方で着実に積み上げていけるよう、丁寧に見てまいります。",
};

const responses = [
  {
    choices: [{ message: { content: JSON.stringify(weakJson) } }],
    usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
  },
  {
    choices: [{ message: { content: JSON.stringify(improvedJson) } }],
    usage: { prompt_tokens: 900, completion_tokens: 700, total_tokens: 1600 },
  },
];

let fetchCalls = 0;
globalThis.fetch = async () => {
  const payload = responses[Math.min(fetchCalls, responses.length - 1)];
  fetchCalls += 1;
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const { generateParentReport } = await import("../lib/ai/parentReport");

const result = await generateParentReport({
  studentName: "太郎",
  guardianNames: "細井 花子",
  teacherName: "田中",
  organizationName: "APS渋谷校",
  periodFrom: "2026-04-01",
  periodTo: "2026-04-08",
  logs: [
    {
      id: "log-1",
      sessionId: "session-1",
      date: "2026-04-07",
      mode: "INTERVIEW",
      artifactJson: {
        version: "conversation-artifact/v1",
        sessionType: "INTERVIEW",
        generatedAt: "2026-04-07T10:00:00.000Z",
        summary: [{ text: "大問2の基礎問での失点が話題になった。" }],
        claims: [{ text: "語句の意味理解が曖昧なまま解いていた。" }],
        nextActions: [{ text: "参考書を変えず、いま使っている教材の復習精度を上げる。", actionType: "assessment" }],
        sharePoints: [{ text: "基礎問の取りこぼしを減らすことが優先。" }],
        facts: ["大問2の基礎問での失点が話題になった。"],
        changes: ["できていないことを言葉にできるようになってきた。"],
        assessment: ["難問対策より先に、基礎の取りこぼしを減らす必要がある。"],
        nextChecks: ["語句の意味を自分の言葉で説明できるか確認する。"],
        sections: [],
      },
      summaryMarkdown:
        "大問2の基礎問での失点と、語句理解の曖昧さが確認された。いま使っている教材の復習精度を上げる方針を確認した。",
    },
  ],
});

assert.equal(fetchCalls, 2);
assert.equal(result.generationMeta.apiCalls, 2);
assert.equal(result.generationMeta.retried, true);
assert.equal(result.reportJson.salutation, "細井様、いつも大変お世話になっております。");
assert.equal(result.reportJson.selfIntroduction, "担当講師をさせていただいております、APS渋谷校の田中です。");
assert.match(result.reportJson.reportLead, /^(今月|4月)の太郎さんのご様子について、ご報告いたします。$/);
assert.equal(result.reportJson.openingParagraph, improvedJson.openingParagraph);
assert.equal(result.reportJson.detailParagraphs.length, 4);
assert.match(result.markdown, /^細井様、いつも大変お世話になっております。/);
assert.match(result.markdown, /担当講師をさせていただいております、APS渋谷校の田中です。/);
assert.match(result.markdown, /大問2の基礎問/);
assert.match(result.markdown, /いま使っている教材/);
assert.match(result.markdown, /今後ともどうぞよろしくお願いいたします。/);
assert.match(result.markdown, /担当講師 田中$/m);
assert.ok(!result.markdown.includes("##"));
assert.ok(!result.reportJson.closingParagraph.includes("今後ともどうぞよろしくお願いいたします。"));
assert.ok(result.generationMeta.tokenUsage.totalTokens >= 3100);

fetchCalls = 0;
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(realNameStyleJson) } }],
      usage: { prompt_tokens: 900, completion_tokens: 600, total_tokens: 1500 },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );

const realNameResult = await generateParentReport({
  studentName: "細井 美莉愛",
  guardianNames: null,
  teacherName: null,
  organizationName: "APS渋谷校",
  periodFrom: "2026-04-01",
  periodTo: "2026-04-08",
  logs: [
    {
      id: "log-2",
      sessionId: "session-2",
      date: "2026-04-07",
      mode: "INTERVIEW",
      artifactJson: {
        version: "conversation-artifact/v1",
        sessionType: "INTERVIEW",
        generatedAt: "2026-04-07T10:00:00.000Z",
        summary: [{ text: "教材の使い方と復習の進め方を整理した。" }],
        claims: [{ text: "世界史は続けやすいやり方を軸にした方がよい。" }],
        nextActions: [{ text: "いま使っている教材をやり切る。", actionType: "assessment" }],
        sharePoints: [{ text: "迷いを減らし、続けられる形を固めることが大切。" }],
        facts: ["教材の使い方と復習の進め方を整理した。"],
        changes: ["以前より自分の気持ちを言葉にできるようになってきた。"],
        assessment: ["やり方を増やすより、続けられる形を決めることが大切。"],
        nextChecks: ["いまの教材を最後まで続けられるか確認する。"],
        sections: [],
      },
      summaryMarkdown:
        "教材の使い方と復習の進め方を整理し、世界史は続けやすいやり方を軸にする方針を確認した。",
    },
  ],
});

assert.equal(realNameResult.reportJson.salutation, "細井様、いつも大変お世話になっております。");
assert.equal(realNameResult.reportJson.selfIntroduction, "APS渋谷校よりご報告いたします。");
assert.match(realNameResult.reportJson.reportLead, /^(今月|4月)の美莉愛さんのご様子について、ご報告いたします。$/);
assert.match(realNameResult.markdown, /^細井様、いつも大変お世話になっております。/);
assert.match(realNameResult.markdown, /APS渋谷校よりご報告いたします。/);
assert.match(realNameResult.markdown, /今月の美莉愛さんのご様子について、ご報告いたします。|4月の美莉愛さんのご様子について、ご報告いたします。/);
assert.match(realNameResult.markdown, /今後ともどうぞよろしくお願いいたします。/);
assert.ok(!realNameResult.reportJson.closingParagraph.includes("今後ともどうぞよろしくお願いいたします。"));

console.log("parent-report generation smoke check passed");
