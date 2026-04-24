import assert from "node:assert/strict";
import {
  buildConversationGenerationProgress,
  buildParentReportGenerationProgress,
} from "../lib/generation-progress";

const interviewUpload = buildConversationGenerationProgress({
  mode: "INTERVIEW",
  stage: "uploading",
});

assert.match(interviewUpload.title, /音声を保存中/);
assert.equal(interviewUpload.steps[0]?.status, "active");
assert.ok(interviewUpload.value > 0 && interviewUpload.value < 100);

const interviewProcessing = buildConversationGenerationProgress({
  mode: "INTERVIEW",
  stage: "processing",
  jobs: [{ type: "FINALIZE", status: "RUNNING" }],
});

assert.match(interviewProcessing.title, /面談ログを生成中/);
assert.equal(interviewProcessing.steps[2]?.status, "active");
assert.equal(interviewProcessing.steps[3]?.status, "pending");

const conversationDone = buildConversationGenerationProgress({
  mode: "INTERVIEW",
  stage: "done",
});

assert.equal(conversationDone.value, 100);
assert.ok(conversationDone.steps.every((step) => step.status === "complete"));

const parentDrafting = buildParentReportGenerationProgress({
  stage: "drafting",
  selectedCount: 3,
});

assert.match(parentDrafting.title, /保護者レポートを作成中/);
assert.equal(parentDrafting.steps[2]?.status, "active");
assert.equal(parentDrafting.steps[0]?.label, "選択確認");
assert.match(parentDrafting.description, /gpt-5\.4/);

const parentError = buildParentReportGenerationProgress({
  stage: "error",
  selectedCount: 2,
  lastError: "timeout",
});

assert.equal(parentError.steps[2]?.status, "error");
assert.match(parentError.description, /timeout/);

console.log("generation-progress smoke check passed");
