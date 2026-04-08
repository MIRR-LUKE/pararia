import assert from "node:assert/strict";
import {
  buildNextMeetingMemoSource,
  buildPreferredNextMeetingMemoDraft,
} from "../lib/ai/next-meeting-memo";
import {
  isValidNextMeetingMemoText,
  pickLatestInterviewMemoSession,
  sanitizeNextMeetingMemoText,
} from "../lib/next-meeting-memo";

const summaryMarkdown = `
■ 基本情報
対象生徒 / 田中太郎

■ 1. サマリー
- 数学は毎日過去問を進める方針で固めた。
- 追加教材で過去問の時間を減らさないように気をつけると決めた。

■ 2. 学習状況と課題分析
- 初見問題で何を見るかを先に決められず、点が止まりやすい。
- 復習で答えを見るだけになりやすく、次に何を見るかを残せていない。
- ミスが続く単元を見つけて、追加教材をどこから取るかも決めたい。

■ 3. 今後の対策・指導内容
- 復習では「次に同じ形が出たら何を見るか」を短く残す。
- 共通テスト対策を入れる時期は次回の面談で決める。

■ 4. 志望校に関する検討事項
- 追加教材は最小限にして、過去問を進める時間を確保する。

■ 5. 次回のお勧め話題
- 過去問がどこまで進んだかをまず確認する。
- 振り返りメモを続けられたかを見る。
- ミスが続く単元が見えてきたかも確認する。
- 共通テスト対策をいつから入れるか話す。
`.trim();

const source = buildNextMeetingMemoSource({
  studentName: "田中太郎",
  sessionDate: "2026-04-07",
  summaryMarkdown,
});

assert.ok(source, "source should be built from interview markdown");
assert.equal(source?.artifact.sessionType, "INTERVIEW");
assert.deepEqual(
  source?.sections.map((section) => section.title),
  [
    "5. 次回のお勧め話題",
    "1. サマリー",
    "2. 学習状況と課題分析",
    "3. 今後の対策・指導内容",
    "4. 志望校に関する検討事項",
  ]
);
assert.ok(source?.sections[0]?.lines.some((line) => line.includes("過去問がどこまで進んだか")));

const preferredDraft = buildPreferredNextMeetingMemoDraft({
  studentName: "田中太郎",
  sessionDate: "2026-04-07",
  summaryMarkdown,
});

assert.equal(
  preferredDraft?.previousSummary,
  "数学は、毎日過去問を進める方針で固まりました。教材を増やして過去問の時間を減らさないこと、復習では「次に同じ形が出たら何を見るか」を短く残すことも確認しています。共通テスト対策は、入れる時期を決めて続ける前提です。"
);

assert.equal(
  preferredDraft?.suggestedTopics,
  "過去問がどこまで進んだかをまず確認します。そのうえで、振り返りメモを残せているか、ミスが続く単元が見えてきたかも見ます。あわせて、共通テスト対策をいつから入れるかも整理したいです。追加教材をどこから取るかと、私大対策から共通テスト対策へ切り替える時期についても話してみるといいかもしれません。"
);

const cleaned = sanitizeNextMeetingMemoText(
  "  - 次回は過去問の進み方を確認します。\n\n- 共通テスト対策をいつから入れるかも整理したいです。  ",
  240
);
assert.equal(
  cleaned,
  "次回は過去問の進み方を確認します。 共通テスト対策をいつから入れるかも整理したいです。"
);

assert.equal(
  isValidNextMeetingMemoText(
    "数学は毎日過去問を進める方針で固まりました。教材を増やしすぎず、過去問の時間を減らさないことも決めています。復習では次に何を見るかを短く残すようにします。"
  ),
  true
);

assert.equal(
  isValidNextMeetingMemoText("論点を整理した。観点を増やして切り分ける。"),
  false
);

assert.equal(
  isValidNextMeetingMemoText(
    "数学は、毎日過去問を進める方針で固まりました。教材を増やして過去問の時間を減らさないこと、復習では「次に同じ形が出たら何を見るか」を短く残すことも確認しています。共通テスト対策は、入れる時期を決めて続ける前提です。"
  ),
  true
);

assert.equal(
  isValidNextMeetingMemoText(
    "過去問がどこまで進んだかをまず確認します。そのうえで、振り返りメモを残せているか、ミスが続く単元が見えてきたかも見ます。あわせて、共通テスト対策をいつから入れるかも整理したいです。追加教材をどこから取るかも話したいです。"
  ),
  true
);

assert.equal(
  isValidNextMeetingMemoText(
    "過去問がどこまで進んだかをまず確認します。そのうえで、振り返りメモを残せているかも見ます。あわせて、共通テスト対策をいつから入れるかも整理したいです。追加教材をどこから取るかと、私大対策から共通テスト対策へ切り替える時期についても話してみるといいかもしれません。"
  ),
  true
);

const latestSession = pickLatestInterviewMemoSession([
  {
    id: "lesson",
    type: "LESSON_REPORT" as const,
    sessionDate: "2026-04-08",
    conversation: { id: "c-lesson", status: "DONE" },
  },
  {
    id: "old-interview",
    type: "INTERVIEW" as const,
    sessionDate: "2026-04-01",
    conversation: { id: "c-old", status: "DONE" },
  },
  {
    id: "new-interview",
    type: "INTERVIEW" as const,
    sessionDate: "2026-04-07",
    conversation: { id: "c-new", status: "DONE" },
  },
]);

assert.equal(latestSession?.id, "new-interview");

console.log("next-meeting-memo checks passed");
