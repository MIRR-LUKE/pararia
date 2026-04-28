#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { TeacherRecordingSessionStatus } from "@prisma/client";
import {
  assertTeacherRecordingOperationStatus,
  canOperateTeacherRecordingStatus,
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

assert.equal(canOperateTeacherRecordingStatus(TeacherRecordingSessionStatus.ERROR, "retry"), true);
assert.equal(canOperateTeacherRecordingStatus(TeacherRecordingSessionStatus.TRANSCRIBING, "retry"), true);
assert.equal(canOperateTeacherRecordingStatus(TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION, "retry"), false);
assert.equal(canOperateTeacherRecordingStatus(TeacherRecordingSessionStatus.CANCELLED, "retry"), false);
assert.equal(canOperateTeacherRecordingStatus(TeacherRecordingSessionStatus.STUDENT_CONFIRMED, "retry"), false);
assert.doesNotThrow(() => assertTeacherRecordingOperationStatus(TeacherRecordingSessionStatus.ERROR, "retry"));
assert.throws(
  () => assertTeacherRecordingOperationStatus(TeacherRecordingSessionStatus.STUDENT_CONFIRMED, "retry"),
  OperationJobControlError
);

assert.equal(canOperateTeacherRecordingStatus(TeacherRecordingSessionStatus.RECORDING, "cancel"), true);
assert.equal(canOperateTeacherRecordingStatus(TeacherRecordingSessionStatus.TRANSCRIBING, "cancel"), true);
assert.equal(
  canOperateTeacherRecordingStatus(TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION, "cancel"),
  true
);
assert.equal(canOperateTeacherRecordingStatus(TeacherRecordingSessionStatus.ERROR, "cancel"), true);
assert.equal(canOperateTeacherRecordingStatus(TeacherRecordingSessionStatus.CANCELLED, "cancel"), false);
assert.equal(canOperateTeacherRecordingStatus(TeacherRecordingSessionStatus.STUDENT_CONFIRMED, "cancel"), false);
assert.doesNotThrow(() => assertTeacherRecordingOperationStatus(TeacherRecordingSessionStatus.RECORDING, "cancel"));
assert.throws(
  () => assertTeacherRecordingOperationStatus(TeacherRecordingSessionStatus.CANCELLED, "cancel"),
  OperationJobControlError
);

console.log("operations job control regression checks passed");
