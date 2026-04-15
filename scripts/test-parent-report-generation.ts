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
    "今月は、国語の基礎問での取りこぼしをどう減らすかを軸にしながら、焦って新しいことを増やすのではなく、いま使っている教材を最後までやり切る方針へ気持ちを整えていく時間になったと感じています。できていないことに目が向きやすい時期だからこそ、まず何を積み上げればよいかを落ち着いて定めることが大事だと共有しました。",
  detailParagraphs: [
    "今回の面談では、大問2の基礎問で落とした原因として、語句の意味理解が曖昧なまま解いていた点がはっきり話題になりました。難問で止まったというより、まず取り切りたい問題で失点している状態だからこそ、参考書を次々に変えるより、いま使っている教材の復習精度を上げる方が先だという話をしました。やり方を増やすことより、いまの教材で『分かったつもり』を残さないことの方が、今の段階では大きな意味を持つと見ています。",
    "また、本人の中でも『できていないこと』に意識が寄りやすい一方で、どこでつまずいたかを以前より言葉にできるようになってきています。ただ落ち込むだけで終わらず、自分の弱さを見つけたうえで立て直そうとしている点に、前向きな変化が出てきているように思います。結果だけを見ると不安が先に立ちやすい時期ですが、気持ちを整えながら次の一手を考えられるようになってきたこと自体が、今月の大きな成長だと感じました。",
    "今月大きかったのは、基礎問を落とした事実をそのまま受け止めたうえで、次に何を積み上げればよいかを一緒に整理できたことです。来月は、語句の意味を自分の言葉で説明できるか、間違えた基礎問を解き直して取り切れるかを、特に意識して見ていきたいと考えています。ご家庭でも、問題を解いたかどうかだけでなく、基礎問を解き直して自分の言葉で説明できたかを一言確認していただけると、学習の定着が進みやすくなります。",
  ],
  closingParagraph:
    "引き続き、太郎さんが焦りに振り回されず、自分に合うやり方で基礎を積み上げていけるよう、丁寧に見てまいります。今後ともどうぞよろしくお願いいたします。",
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
assert.equal(result.reportJson.detailParagraphs.length, 3);
assert.match(result.markdown, /^細井様、いつも大変お世話になっております。/);
assert.match(result.markdown, /担当講師をさせていただいております、APS渋谷校の田中です。/);
assert.match(result.markdown, /大問2の基礎問/);
assert.match(result.markdown, /いま使っている教材/);
assert.match(result.markdown, /担当講師 田中$/m);
assert.ok(!result.markdown.includes("##"));
assert.ok(result.generationMeta.tokenUsage.totalTokens >= 3100);

console.log("parent-report generation smoke check passed");
