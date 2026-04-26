#!/usr/bin/env tsx

import assert from "node:assert/strict";
import {
  normalizeOperationJobAction,
  normalizeOperationJobKind,
  OperationJobControlError,
} from "../lib/operations/job-control";

assert.equal(normalizeOperationJobKind("conversation"), "conversation");
assert.equal(normalizeOperationJobKind("session_part"), "session_part");
assert.equal(normalizeOperationJobKind("teacher_recording"), "teacher_recording");
assert.equal(normalizeOperationJobKind("report"), null);
assert.equal(normalizeOperationJobKind(""), null);

assert.equal(normalizeOperationJobAction("retry"), "retry");
assert.equal(normalizeOperationJobAction("cancel"), "cancel");
assert.equal(normalizeOperationJobAction("delete"), null);
assert.equal(normalizeOperationJobAction(""), null);

const notFound = new OperationJobControlError("missing", 404);
assert.equal(notFound.name, "OperationJobControlError");
assert.equal(notFound.status, 404);

console.log("operations job control regression checks passed");
