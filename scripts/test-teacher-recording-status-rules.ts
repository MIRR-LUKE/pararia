import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TeacherRecordingSessionStatus } from "@prisma/client";
import {
  assertTeacherRecordingStatusTransition,
  canTransitionTeacherRecordingStatus,
  TeacherRecordingStatusTransitionError,
} from "../lib/teacher-app/server/recording-status";

const allowed: Array<[TeacherRecordingSessionStatus, TeacherRecordingSessionStatus]> = [
  [TeacherRecordingSessionStatus.RECORDING, TeacherRecordingSessionStatus.TRANSCRIBING],
  [TeacherRecordingSessionStatus.RECORDING, TeacherRecordingSessionStatus.CANCELLED],
  [TeacherRecordingSessionStatus.TRANSCRIBING, TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION],
  [TeacherRecordingSessionStatus.TRANSCRIBING, TeacherRecordingSessionStatus.ERROR],
  [
    TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
    TeacherRecordingSessionStatus.STUDENT_CONFIRMED,
  ],
  [TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION, TeacherRecordingSessionStatus.ERROR],
];

for (const [from, to] of allowed) {
  assert.equal(canTransitionTeacherRecordingStatus(from, to), true, `${from} -> ${to} should be allowed`);
  assert.doesNotThrow(() => assertTeacherRecordingStatusTransition(from, to));
}

const blocked: Array<[TeacherRecordingSessionStatus, TeacherRecordingSessionStatus]> = [
  [TeacherRecordingSessionStatus.STUDENT_CONFIRMED, TeacherRecordingSessionStatus.TRANSCRIBING],
  [TeacherRecordingSessionStatus.CANCELLED, TeacherRecordingSessionStatus.TRANSCRIBING],
  [TeacherRecordingSessionStatus.ERROR, TeacherRecordingSessionStatus.TRANSCRIBING],
  [TeacherRecordingSessionStatus.RECORDING, TeacherRecordingSessionStatus.STUDENT_CONFIRMED],
  [TeacherRecordingSessionStatus.TRANSCRIBING, TeacherRecordingSessionStatus.STUDENT_CONFIRMED],
];

for (const [from, to] of blocked) {
  assert.equal(canTransitionTeacherRecordingStatus(from, to), false, `${from} -> ${to} should be blocked`);
  assert.throws(
    () => assertTeacherRecordingStatusTransition(from, to),
    TeacherRecordingStatusTransitionError
  );
}

const uploadSource = readFileSync(
  new URL("../lib/teacher-app/server/recording-upload-service.ts", import.meta.url),
  "utf8"
);
const analysisSource = readFileSync(
  new URL("../lib/teacher-app/server/recording-analysis-service.ts", import.meta.url),
  "utf8"
);
const confirmSource = readFileSync(
  new URL("../lib/teacher-app/server/recording-confirm-service.ts", import.meta.url),
  "utf8"
);
const sessionSource = readFileSync(
  new URL("../lib/teacher-app/server/recording-session-service.ts", import.meta.url),
  "utf8"
);
assert.match(uploadSource, /updateTeacherRecordingStatus\(tx,\s*\{\s*recordingId:[\s\S]*to:\s*TeacherRecordingSessionStatus\.TRANSCRIBING/);
assert.match(analysisSource, /to:\s*TeacherRecordingSessionStatus\.AWAITING_STUDENT_CONFIRMATION/);
assert.match(confirmSource, /to:\s*TeacherRecordingSessionStatus\.STUDENT_CONFIRMED/);
assert.match(sessionSource, /to:\s*TeacherRecordingSessionStatus\.CANCELLED/);

const stateDoc = readFileSync(
  new URL("../docs/teacher-recording-state-machine.md", import.meta.url),
  "utf8"
);
assert.match(stateDoc, /RECORDING -> CANCELLED/);
assert.match(stateDoc, /STUDENT_CONFIRMED.*終端状態/s);

console.log("teacher recording status rule checks passed");
