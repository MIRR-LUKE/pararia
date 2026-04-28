import assert from "node:assert/strict";
import {
  buildConversationLogQualityMeta,
  buildConversationLogQualityMetaPatch,
  calculateThinConversationLogRate,
  readConversationLogQualityMeta,
} from "../lib/conversation-log-quality";

const evaluatedAt = "2026-04-28T00:00:00.000Z";

const concreteLog = [
  "■ 基本情報",
  "対象生徒: 山田太郎 様",
  "面談日: 2026-04-20",
  "面談時間: 45分",
  "担当チューター: 佐藤先生",
  "",
  "■ 1. サマリー",
  "- 生徒は英語長文の第3問で根拠線を引けるようになり、前回より解き直しの説明が具体的になった。",
  "  - 根拠: 講師: 第3問の根拠はどこですか？ 生徒: 2段落目のhowever以降です。",
  "",
  "■ 2. 学習状況と課題分析",
  "- 観察: 生徒は23時を過ぎて寝た日は集中が落ちると話し、睡眠と宿題の質の関係を自分で説明できていた。",
  "  - 根拠: 生徒: スマホを早めに切った日は英語の音読が楽です。",
  "- 推測: 英語長文は設問根拠を探す手順が定着し始めており、時間配分の確認が次の伸びしろになっている。",
  "",
  "■ 3. 今後の対策・指導内容",
  "- 判断: 次回までに英語長文を1日1題、根拠線と解き直しメモをノートに残す。",
  "- 次回確認: 次回は第3問を8分で解く練習結果と、睡眠が集中に出た日の違いを確認する。",
  "",
  "■ 4. 保護者への共有ポイント",
  "- 保護者共有: 英語長文で根拠を持って説明する姿勢が出ており、家庭ではスマホを切る時間の声かけが有効です。",
  "",
  "■ 5. 次回のお勧め話題",
  "- 次回は英語長文第3問の時間配分、解き直しノート、睡眠リズムを話題にする。",
].join("\n");

const thinLog = [
  "■ 基本情報",
  "対象生徒: 山田太郎 様",
  "",
  "■ 1. サマリー",
  "- 頑張っていました。",
  "",
  "■ 2. 学習状況と課題分析",
  "- 課題があります。",
  "",
  "■ 3. 今後の対策・指導内容",
  "- 次回も頑張ります。",
  "",
  "■ 4. 保護者への共有ポイント",
  "- 特になし。",
].join("\n");

const partialLog = [
  "■ 基本情報",
  "対象生徒: 山田太郎 様",
  "面談日: 2026-04-21",
  "",
  "■ 1. サマリー",
  "- 生徒は数学の計算ミスを減らすため、宿題の丸つけ後に見直しをしていた。",
  "",
  "■ 2. 学習状況と課題分析",
  "- 観察: 数学の小テストで符号ミスを2問減らせた。",
  "",
  "■ 3. 今後の対策・指導内容",
  "- 次回確認: 次回は小テストの符号ミス数と見直し時間を確認する。",
].join("\n");

const concreteMeta = buildConversationLogQualityMeta({
  summaryMarkdown: concreteLog,
  evaluatedAt,
});
assert.equal(concreteMeta.isThinLog, false);
assert.equal(concreteMeta.parentReportUsability, "ready");
assert.equal(concreteMeta.signals.studentState.passed, true);
assert.equal(concreteMeta.signals.teacherInteraction.passed, true);
assert.equal(concreteMeta.signals.parentReportReady.passed, true);

const thinMeta = buildConversationLogQualityMeta({ summaryMarkdown: thinLog, evaluatedAt });
assert.equal(thinMeta.isThinLog, true);
assert.equal(thinMeta.parentReportUsability, "weak");
assert.equal(thinMeta.signals.sufficientLength.level, "missing");
assert.equal(thinMeta.signals.parentReportReady.level, "missing");

const partialMeta = buildConversationLogQualityMeta({ summaryMarkdown: partialLog, evaluatedAt });
assert.equal(partialMeta.signals.nextConversation.passed, true);
assert.equal(partialMeta.signals.parentReportReady.level, "missing");
assert.ok(partialMeta.reasons.some((reason) => reason.includes("保護者レポート")));

assert.equal(readConversationLogQualityMeta(null), null);
assert.equal(readConversationLogQualityMeta({ seeded: true }), null);
assert.equal(readConversationLogQualityMeta({ logQuality: concreteMeta })?.score, concreteMeta.score);

const rate = calculateThinConversationLogRate([
  { qualityMetaJson: null },
  { qualityMetaJson: { seeded: true } },
  { qualityMetaJson: { logQuality: concreteMeta } },
  { qualityMetaJson: { logQuality: thinMeta } },
]);
assert.deepEqual(rate, {
  totalCount: 4,
  evaluatedCount: 2,
  missingMetaCount: 2,
  thinCount: 1,
  thinRate: 0.5,
});

const failedPatch = buildConversationLogQualityMetaPatch(
  { summaryMarkdown: concreteLog, evaluatedAt },
  {
    build: () => {
      throw new Error("quality helper failed");
    },
  }
);
assert.equal(failedPatch.logQuality, null);
assert.match(failedPatch.logQualityError?.message ?? "", /quality helper failed/);

console.log("conversation log quality checks passed");
