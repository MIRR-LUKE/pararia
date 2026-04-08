import assert from "node:assert/strict";

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key";

const weakJson = {
  date: "2026-04-08",
  greeting: "お世話になっております。",
  introduction: "直近の面談・授業記録をもとに、現在の状況と今後の進め方をご報告いたします。",
  summary: "現在の状況と次回までの方針を、会話ログの内容に基づいて整理しました。",
  sections: [
    { title: "今回の様子", body: "今回の記録から、現在の学習状況と次回に向けた確認事項を整理しています。" },
    { title: "学習状況の変化", body: "直近のやり取りの中で見えた変化は、次回面談・授業で継続して確認します。" },
    { title: "講師としての見立て", body: "事実ベースの記録を踏まえ、次回も方針の妥当性を確認していきます。" },
    { title: "科目別またはテーマ別の具体策", body: "教材・教科・優先順位を具体化し、次回までに何を回すかを明確にします。" },
    { title: "リスクとその意味", body: "止まりやすいポイントや見落としやすい点を、必要以上に煽らず整理します。" },
    { title: "次回までの方針", body: "今回整理した確認事項と次の行動をもとに、学習の進め方を具体化していきます。" },
    { title: "ご家庭で見てほしいこと", body: "課題を終えたかどうかだけでなく、やり直しや定着確認まで進められたかを一言確認いただけると効果的です。" },
  ],
  closing: "引き続きよろしくお願いいたします。",
};

const improvedJson = {
  date: "2026-04-08",
  greeting: "お世話になっております。",
  introduction: "今回は4月の面談ログをもとに、国語の語句理解と基礎問の取りこぼしに絞ってご報告します。",
  summary:
    "今回の面談では、大問2の基礎問で落とした原因として、語句の意味理解が曖昧なまま解いていた点が見えました。難問で止まったというより、取り切りたい基礎問題の精度を上げることが優先です。",
  sections: [
    { title: "今回の様子", body: "面談では、解けないと厳しい問題を複数落としたという本人の認識が共有されました。特に大問2の基礎問に関する発話が中心で、短時間ながら失点箇所の振り返りに話題が集まりました。" },
    { title: "学習状況の変化", body: "難問そのものより、基礎問で止まったことを本人が自覚し始めている点は前進です。一方で、語句の意味確認を後回しにしたまま解いている様子も残っていました。" },
    { title: "講師としての見立て", body: "今回の失点は応用不足より、基礎知識の即時想起と確認不足の影響が大きいと見ています。まずは基礎問で落とさない状態を作る方が、得点の安定に直結します。" },
    { title: "科目別またはテーマ別の具体策", body: "国語では、語句の意味と読みをその場で確認しながら復習する形を優先します。大問2の基礎問で落とした内容を問題番号ベースで洗い出し、類題で取り直せるかまで確認します。" },
    { title: "リスクとその意味", body: "基礎問の取りこぼしが続くと、難問に時間をかける前に点数が伸びにくくなります。特に意味確認で止まる状態が残ると、模試や本番でも同じ型の失点につながりやすいです。" },
    { title: "次回までの方針", body: "次回は、大問2の基礎問で落とした箇所を優先して確認し、語句理解の曖昧さが残っていないかを見ます。そのうえで、解く順番と見直し方も合わせて整えます。" },
    { title: "ご家庭で見てほしいこと", body: "ご家庭では、課題を終えたかだけでなく『間違えた基礎問を解き直したか』『語句の意味を自分の言葉で説明できるか』を一言確認していただけると効果的です。" },
  ],
  closing: "引き続き、お子さまが基礎で取りこぼさない状態を作れるよう伴走してまいります。",
};

const responses = [
  {
    choices: [{ message: { content: JSON.stringify(weakJson) } }],
    usage: { prompt_tokens: 1200, completion_tokens: 500, total_tokens: 1700 },
  },
  {
    choices: [{ message: { content: JSON.stringify(improvedJson) } }],
    usage: { prompt_tokens: 900, completion_tokens: 650, total_tokens: 1550 },
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
  studentName: "田中太郎",
  periodFrom: "2026-04-01",
  periodTo: "2026-04-08",
  logs: [
    {
      id: "log-1",
      sessionId: "session-1",
      date: "2026-04-07",
      mode: "INTERVIEW",
      artifactJson: {
        summary: [{ text: "大問2の基礎問での失点が話題になった。" }],
        claims: [{ text: "語句の意味理解が曖昧なまま解いていた。" }],
        nextActions: [{ text: "基礎問の解き直しを優先する。" }],
        nextChecks: [{ text: "語句の意味を説明できるか確認する。" }],
        sharePoints: [{ text: "基礎問の取りこぼしを減らすことが優先。" }],
        assessment: [{ text: "応用以前に基礎知識の即時想起に課題がある。" }],
        sections: [],
      },
      summaryMarkdown: "大問2の基礎問での失点と、語句理解の曖昧さが確認された。",
    },
  ],
});

assert.equal(fetchCalls, 2);
assert.equal(result.generationMeta.apiCalls, 2);
assert.equal(result.generationMeta.retried, true);
assert.equal(result.reportJson.summary, improvedJson.summary);
assert.match(result.markdown, /大問2の基礎問/);
assert.match(result.markdown, /ご家庭では/);
assert.ok(result.generationMeta.tokenUsage.totalTokens >= 3250);

console.log("parent-report generation smoke check passed");
