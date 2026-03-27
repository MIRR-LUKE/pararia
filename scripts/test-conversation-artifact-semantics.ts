import assert from "node:assert/strict";

async function main() {
  const [
    { buildConversationArtifactFromMarkdown, parseConversationArtifact, renderConversationArtifactMarkdown },
    { buildBundlePreview, buildBundleQualityEval, buildOperationalLog },
  ] =
    await Promise.all([
      import("../lib/conversation-artifact"),
      import("../lib/operational-log"),
    ]);

  const markdown = [
    "■ 基本情報",
    "対象生徒: 山田 太郎 様",
    "面談日: 2026-03-27",
    "",
    "■ 1. サマリー",
    "- 面談で英語長文の根拠を取る流れが見えた。",
    "  - 根拠: 面談で英語長文の根拠を取る流れが見えた。",
    "",
    "■ 2. ポジティブな話題",
    "- 観察: 英語長文で設問根拠を拾えている。",
    "  - 根拠: 英語長文で設問根拠を拾えている。",
    "- 推測: 先読みはまだ安定していない。",
    "  - 根拠: 先読みはまだ安定していない。",
    "- 不足: 次回確認が必要。",
    "  - 根拠: 次回確認が必要。",
    "",
    "■ 3. 改善・対策が必要な話題",
    "- 判断: 宿題のやり直しを次回までの課題にした。",
    "  - 根拠: 宿題のやり直しを次回までの課題にした。",
    "- 次回確認: やり直し方を確認する。",
    "  - 根拠: やり直し方を確認する。",
    "",
    "■ 4. 保護者への共有ポイント",
    "- 共有: 宿題の定着確認を続ける。",
    "  - 根拠: 宿題の定着確認を続ける。",
  ].join("\n");

  const artifact = buildConversationArtifactFromMarkdown({
    sessionType: "INTERVIEW",
    summaryMarkdown: markdown,
  });
  const plainArtifact = JSON.parse(JSON.stringify(artifact));
  const parsed = parseConversationArtifact(plainArtifact);
  assert.ok(parsed);
  assert.equal(parsed?.claims[0]?.claimType, "observed");
  assert.equal(parsed?.claims[1]?.claimType, "inferred");
  assert.equal(parsed?.claims[2]?.claimType, "missing");
  assert.equal(parsed?.nextActions[0]?.actionType, "assessment");
  assert.equal(parsed?.nextActions[1]?.actionType, "nextCheck");
  assert.ok(parsed?.nextChecks.includes("やり直し方を確認する。"));

  const rendered = renderConversationArtifactMarkdown(parsed);
  assert.match(rendered, /観察: 英語長文で設問根拠を拾えている。/);
  assert.match(rendered, /次回確認: やり直し方を確認する。/);

  const operationalLog = buildOperationalLog({
    sessionType: "INTERVIEW",
    artifactJson: parsed,
    summaryMarkdown: markdown,
  });
  assert.ok(operationalLog.assessment.some((line) => line.includes("宿題のやり直し")));
  assert.ok(operationalLog.nextChecks.some((line) => line.includes("やり直し方を確認する")));
  assert.notDeepEqual(operationalLog.assessment, operationalLog.nextChecks);

  const bundleEval = buildBundleQualityEval([
    {
      id: "log-1",
      date: "2026-03-27",
      mode: "INTERVIEW",
      operationalLog,
    },
  ]);
  assert.ok(bundleEval.weakElements.some((line) => line.includes("宿題のやり直し")));
  assert.ok(bundleEval.followUpChecks.some((line) => line.includes("やり直し方を確認する")));
  assert.ok(!bundleEval.weakElements.some((line) => line.includes("やり直し方を確認する")));

  const preview = buildBundlePreview(bundleEval);
  assert.match(preview, /今回の判断・補足:/);
  assert.match(preview, /次回確認:/);

  console.log("conversation artifact semantics test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
