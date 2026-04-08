import assert from "node:assert/strict";
import { renderConversationArtifactMarkdown } from "../lib/conversation-artifact";
import {
  buildConversationSummaryEditPayload,
  hasEditableConversationSummaryChanges,
  normalizeEditableConversationSummary,
  UNSAVED_CONVERSATION_SUMMARY_MESSAGE,
} from "../lib/conversation-editing";

const interviewMarkdown = `
■ 基本情報
対象生徒 / 田中太郎
面談日 / 2026-04-08

■ 1. サマリー
数学は過去問中心で進めるが、追加教材を増やしすぎない方針で整理した。

■ 2. 学習状況と課題分析
・観察: 基礎問の取りこぼしが残っている。
・観察: 「叱責」の意味で迷いがあった。

■ 3. 今後の対策・指導内容
・判断: 大問2の基礎問を解き直す。

■ 4. 志望校に関する検討事項
今回は志望校の詳細な話題は出ていない。

■ 5. 次回のお勧め話題
・次回確認: 基礎問の解き直し状況を確認する。
`.trim();

assert.equal(normalizeEditableConversationSummary(`\n${interviewMarkdown}\n`), interviewMarkdown);
assert.equal(hasEditableConversationSummaryChanges(interviewMarkdown, `\n${interviewMarkdown}\n`), false);
assert.equal(hasEditableConversationSummaryChanges(interviewMarkdown, `${interviewMarkdown}\n追記あり。`), true);
assert.match(UNSAVED_CONVERSATION_SUMMARY_MESSAGE, /未保存/);

const payload = buildConversationSummaryEditPayload({
  sessionType: "INTERVIEW",
  summaryMarkdown: interviewMarkdown,
});

assert.equal(payload.summaryMarkdown, interviewMarkdown);
assert.ok(payload.artifactJson);

const rendered = renderConversationArtifactMarkdown(payload.artifactJson);
assert.match(rendered, /■ 1\. サマリー/);
assert.match(rendered, /過去問中心/);
assert.match(rendered, /次回確認: 基礎問の解き直し状況を確認する。/);

const freeformPayload = buildConversationSummaryEditPayload({
  sessionType: "INTERVIEW",
  summaryMarkdown: "見出しを外した自由文だけの本文です。",
});

assert.equal(freeformPayload.summaryMarkdown, "見出しを外した自由文だけの本文です。");
assert.equal(freeformPayload.artifactJson, null);

console.log("log-editing smoke check passed");
