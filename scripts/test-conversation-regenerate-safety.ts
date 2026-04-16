#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { buildConversationRegenerationStartPlan } from "../app/api/conversations/[id]/regenerate/route";

const withFormattedTranscript = buildConversationRegenerationStartPlan({
  rawTextOriginal: null,
  rawTextCleaned: null,
  reviewedText: null,
  formattedTranscript: "## 面談\n既存のログ",
});

assert.equal(withFormattedTranscript.keepFormattedTranscriptAsSource, true);
assert.deepEqual(withFormattedTranscript.updateData, {
  status: "PROCESSING",
});

const withRawText = buildConversationRegenerationStartPlan({
  rawTextOriginal: "元の音声起こし",
  rawTextCleaned: "整形済み",
  reviewedText: null,
  formattedTranscript: "## 面談\n既存のログ",
});

assert.equal(withRawText.keepFormattedTranscriptAsSource, false);
assert.deepEqual(withRawText.updateData, {
  status: "PROCESSING",
});

assert.ok(!("artifactJson" in withFormattedTranscript.updateData));
assert.ok(!("summaryMarkdown" in withFormattedTranscript.updateData));
assert.ok(!("formattedTranscript" in withFormattedTranscript.updateData));

console.log("conversation regenerate safety regression checks passed");
