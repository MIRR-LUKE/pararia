import assert from "node:assert/strict";

async function main() {
  const [
    { buildLessonDraftFallbackMarkdown, buildInterviewDraftFallbackMarkdown },
    { buildDraftInputBlock },
    { isWeakDraftMarkdown },
  ] = await Promise.all([
    import("../lib/ai/conversation/fallback"),
    import("../lib/ai/conversation/shared"),
    import("../lib/ai/conversation/normalize"),
  ]);

  const noisyLessonTranscript = [
    "## 授業前チェックイン",
    "では録音を始 めたけど で 今週出した三角関数 はやりましたか? やりました えっと 今週はまあやったんです けど この証明でこっちまでやって 問題としては本当になんか証明だったから 日本語を合わせて説明した",
    "ねえ 極限っていうのは まず最初に大体の関数のオーダーを調べて それぞれの一番強いやつを見つけて 感覚で分かった後に極限の式を見れば答えが分かるようになっていく ただその説明付けは癖がある",
    "## 授業後チェックアウト",
    "次回はこういう振動する関数って定数で挟みやすいから 挟み打ちの原理を来週はやるね はい OK 質問もありますか 宿題は今回の続きですか",
  ].join("\n");

  const badLessonDraft = [
    "■ 基本情報",
    "対象生徒: 田中太郎 様",
    "指導日: 2026-03-27",
    "",
    "■ 1. 本日の指導サマリー（室長向け要約）",
    "では録音を始 めたけど で 今週出した三角関数 はやりましたか? やりました えっと 今週はまあやったんです けど この証明でこっちまでやって 問題としては本当になんか証明だったから 日本語を合わせて説明した",
    "根拠: では録音を始 めたけど で 今週出した三角関数 はやりましたか? やりました えっと 今週はまあやったんです けど この証明でこっちまでやって 問題としては本当になんか証明だったから 日本語を合わせて説明した",
    "",
    "■ 2. 課題と指導成果（Before → After）",
    "【条件整理】",
    "現状（Before）: では録音を始 めたけど で 今週出した三角関数 はやりましたか? やりました えっと 今週はまあやったんです けど この証明でこっちまでやって 問題としては本当になんか証明だったから 日本語を合わせて説明した",
    "根拠: では録音を始 めたけど で 今週出した三角関数 はやりましたか? やりました えっと 今週はまあやったんです けど この証明でこっちまでやって 問題としては本当になんか証明だったから 日本語を合わせて説明した",
    "成果（After）: 次回はこういう振動する関数って定数で挟みやすいから 挟み打ちの原理を来週はやるね はい OK 質問もありますか 宿題は今回の続きですか",
    "根拠: 次回はこういう振動する関数って定数で挟みやすいから 挟み打ちの原理を来週はやるね はい OK 質問もありますか 宿題は今回の続きですか",
    "※特記事項: 次回はこういう振動する関数って定数で挟みやすいから 挟み打ちの原理を来週はやるね はい OK 質問もありますか 宿題は今回の続きですか",
    "根拠: 次回はこういう振動する関数って定数で挟みやすいから 挟み打ちの原理を来週はやるね はい OK 質問もありますか 宿題は今回の続きですか",
    "",
    "■ 3. 学習方針と次回アクション（自学習の設計）",
    "生徒:",
    "- 判断: では録音を始 めたけど で 今週出した三角関数 はやりましたか? やりました えっと 今週はまあやったんです けど この証明でこっちまでやって 問題としては本当になんか証明だったから 日本語を合わせて説明した",
    "  根拠: では録音を始 めたけど で 今週出した三角関数 はやりましたか? やりました えっと 今週はまあやったんです けど この証明でこっちまでやって 問題としては本当になんか証明だったから 日本語を合わせて説明した",
    "",
    "■ 4. 室長・他講師への共有・連携事項",
    "- 共有: では録音を始 めたけど で 今週出した三角関数 はやりましたか? やりました えっと 今週はまあやったんです けど この証明でこっちまでやって 問題としては本当になんか証明だったから 日本語を合わせて説明した",
    "  根拠: では録音を始 めたけど で 今週出した三角関数 はやりましたか? やりました えっと 今週はまあやったんです けど この証明でこっちまでやって 問題としては本当になんか証明だったから 日本語を合わせて説明した",
  ].join("\n");

  assert.equal(isWeakDraftMarkdown(badLessonDraft, "LESSON_REPORT", 600, noisyLessonTranscript), true);

  const lessonFallback = buildLessonDraftFallbackMarkdown({
    transcript: noisyLessonTranscript,
    studentName: "田中太郎",
    teacherName: "PARARIA Admin",
    sessionDate: "2026-03-27",
  });
  assert.match(lessonFallback, /三角関数|極限|挟み打ち/);
  assert.doesNotMatch(lessonFallback, /では録音を始/);
  assert.doesNotMatch(lessonFallback, /質問もありますか/);

  const interviewTranscript = [
    "講師: 最近の英語の音読はどうですか？",
    "生徒: 前より読みやすいです。でも寝る時間が遅い日は集中が落ちます。",
    "講師: 宿題の入り方は変わりましたか？",
    "生徒: 寝る前にスマホを早めに切った日は、宿題の読み直しが短くなります。",
  ].join("\n");

  const interviewFallback = buildInterviewDraftFallbackMarkdown({
    transcript: interviewTranscript,
    studentName: "山田花子",
    teacherName: "佐藤先生",
    sessionDate: "2026-03-25",
    durationMinutes: 52,
  });
  assert.match(interviewFallback, /睡眠|英語|宿題/);
  assert.doesNotMatch(interviewFallback, /会話をそのまま/);
  assert.doesNotMatch(interviewFallback, /根拠:/);
  assert.match(interviewFallback, /面談時間: 52分/);
  assert.match(interviewFallback, /■ 2\. 学習状況と課題分析/);
  assert.match(interviewFallback, /■ 3\. 今後の対策・指導内容/);
  assert.match(interviewFallback, /■ 4\. 志望校に関する検討事項/);
  assert.match(interviewFallback, /■ 5\. 次回のお勧め話題/);

  const draftInput = buildDraftInputBlock("LESSON_REPORT", noisyLessonTranscript);
  assert.match(draftInput.label, /抽出済み重要発話/);
  assert.match(draftInput.content, /抽出済みの重要発話/);
  assert.match(draftInput.content, /文字起こし全文/);

  const longInterviewTranscript = Array.from({ length: 80 }, (_, index) => `講師: 志望校の話題 ${index + 1} と時間配分の確認をした。`).join("\n");
  const interviewInput = buildDraftInputBlock("INTERVIEW", longInterviewTranscript);
  assert.match(interviewInput.label, /抽出済み重要発話 \+ 文字起こし全文/);
  assert.match(interviewInput.content, /文字起こし全文/);

  console.log("conversation draft quality regression check passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
