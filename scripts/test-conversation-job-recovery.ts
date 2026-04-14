import assert from "node:assert/strict";
import { shouldRecoverProcessingConversationJobs } from "../lib/jobs/conversationJobs";

assert.equal(
  shouldRecoverProcessingConversationJobs({
    status: "PROCESSING",
    jobs: [],
  }),
  true,
  "processing conversations with no jobs should be recovered"
);

assert.equal(
  shouldRecoverProcessingConversationJobs({
    status: "PROCESSING",
    jobs: [{ status: "ERROR" }],
  }),
  true,
  "processing conversations with only errored jobs should be recovered"
);

assert.equal(
  shouldRecoverProcessingConversationJobs({
    status: "PROCESSING",
    jobs: [{ status: "QUEUED" }],
  }),
  false,
  "queued finalize jobs should not be re-enqueued"
);

assert.equal(
  shouldRecoverProcessingConversationJobs({
    status: "DONE",
    jobs: [],
  }),
  false,
  "completed conversations should not be recovered"
);

console.log("conversation job recovery regression checks passed");
