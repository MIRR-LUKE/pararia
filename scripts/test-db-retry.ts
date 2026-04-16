import assert from "node:assert/strict";
import { isRetryableDatabaseError } from "../lib/db-retry";

assert.equal(
  isRetryableDatabaseError(new Error("Transaction API error: Unable to start a transaction in the given time.")),
  true,
  "P2028 style transaction wait should be retryable"
);

assert.equal(
  isRetryableDatabaseError(new Error("PrismaClientKnownRequestError: P2028 Transaction API error")),
  true,
  "P2028 code should be retryable"
);

assert.equal(
  isRetryableDatabaseError(new Error("Unique constraint failed on the fields")),
  false,
  "non saturation database errors should stay non-retryable"
);

console.log("db retry regression checks passed");
