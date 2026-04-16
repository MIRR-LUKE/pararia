import assert from "node:assert/strict";
import { requiresConversationProcessingLease, shouldRecoverProcessingConversationJobs } from "../lib/jobs/conversationJobs";
import { isConversationProcessingLeaseActive } from "../lib/jobs/conversation-jobs/repository";

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

assert.equal(
  requiresConversationProcessingLease("PROCESSING"),
  true,
  "processing conversations should take the conversation lease"
);

assert.equal(
  requiresConversationProcessingLease("DONE"),
  false,
  "done conversations should process follow-up jobs without the conversation lease"
);

const now = new Date("2026-04-15T00:00:00.000Z");

assert.equal(
  isConversationProcessingLeaseActive({
    status: "PROCESSING",
    processingLeaseExecutionId: "run-1",
    processingLeaseExpiresAt: new Date("2026-04-15T00:05:00.000Z"),
    now,
  }),
  true,
  "fresh processing lease should be active"
);

assert.equal(
  isConversationProcessingLeaseActive({
    status: "PROCESSING",
    processingLeaseExecutionId: "run-1",
    processingLeaseExpiresAt: new Date("2026-04-14T23:59:59.000Z"),
    now,
  }),
  false,
  "expired processing lease should not be active"
);

assert.equal(
  isConversationProcessingLeaseActive({
    status: "DONE",
    processingLeaseExecutionId: "run-1",
    processingLeaseExpiresAt: new Date("2026-04-15T00:05:00.000Z"),
    now,
  }),
  false,
  "completed conversations should never count as active leases"
);

console.log("conversation job recovery regression checks passed");
