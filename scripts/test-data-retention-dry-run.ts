import assert from "node:assert/strict";
import { TeacherRecordingSessionStatus } from "@prisma/client";
import {
  buildDataRetentionDryRunRules,
  collectDataRetentionDryRunCandidatesFromRows,
  type ConversationCandidateRow,
  type DataRetentionDryRunRuleKey,
  type SessionPartCandidateRow,
  type TeacherRecordingCandidateRow,
} from "../lib/data-retention-dry-run.js";

const now = new Date("2026-04-28T00:00:00.000Z");
const oldAudioDate = new Date("2026-03-20T00:00:00.000Z");
const oldTranscriptDate = new Date("2026-03-20T00:00:00.000Z");
const oldUnconfirmedDate = new Date("2026-04-10T00:00:00.000Z");
const recentDate = new Date("2026-04-24T00:00:00.000Z");
const organizationId = "org-a";

function teacherRecording(
  id: string,
  partial: Partial<TeacherRecordingCandidateRow>
): TeacherRecordingCandidateRow {
  return {
    id,
    organizationId,
    status: TeacherRecordingSessionStatus.STUDENT_CONFIRMED,
    audioStorageUrl: null,
    transcriptText: null,
    transcriptSegmentsJson: null,
    transcriptMetaJson: null,
    selectedStudentId: "student-a",
    promotedSessionId: "session-a",
    promotedConversationId: "conversation-a",
    uploadedAt: null,
    recordedAt: null,
    analyzedAt: null,
    confirmedAt: recentDate,
    createdAt: recentDate,
    updatedAt: recentDate,
    ...partial,
  };
}

function sessionPart(id: string, partial: Partial<SessionPartCandidateRow>): SessionPartCandidateRow {
  return {
    id,
    storageUrl: null,
    rawTextOriginal: null,
    rawTextCleaned: null,
    reviewedText: null,
    rawSegments: null,
    transcriptExpiresAt: null,
    createdAt: recentDate,
    session: { organizationId },
    ...partial,
  };
}

function conversation(id: string, partial: Partial<ConversationCandidateRow>): ConversationCandidateRow {
  return {
    id,
    organizationId,
    rawTextOriginal: null,
    rawTextCleaned: null,
    reviewedText: null,
    rawSegments: null,
    rawTextExpiresAt: null,
    ...partial,
  };
}

const result = collectDataRetentionDryRunCandidatesFromRows({
  organizationId,
  now,
  retention: {
    audioDays: 30,
    transcriptDays: 30,
    teacherRecordingUnconfirmedDays: 14,
    teacherRecordingErrorDays: 30,
    teacherRecordingNoStudentDays: 30,
  },
  rows: {
    teacherRecordings: [
      teacherRecording("teacher-audio-old", {
        audioStorageUrl: "blob://old-audio",
        uploadedAt: oldAudioDate,
      }),
      teacherRecording("teacher-audio-new", {
        audioStorageUrl: "blob://new-audio",
        uploadedAt: recentDate,
      }),
      teacherRecording("teacher-audio-other-org", {
        organizationId: "org-b",
        audioStorageUrl: "blob://other-org",
        uploadedAt: oldAudioDate,
      }),
      teacherRecording("teacher-unconfirmed-old", {
        status: TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
        confirmedAt: null,
        updatedAt: oldUnconfirmedDate,
      }),
      teacherRecording("teacher-unconfirmed-new", {
        status: TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION,
        confirmedAt: null,
        updatedAt: recentDate,
      }),
      teacherRecording("teacher-error-old", {
        status: TeacherRecordingSessionStatus.ERROR,
        updatedAt: oldTranscriptDate,
      }),
      teacherRecording("teacher-no-student-old", {
        status: TeacherRecordingSessionStatus.STUDENT_CONFIRMED,
        selectedStudentId: null,
        promotedSessionId: null,
        promotedConversationId: null,
        confirmedAt: oldTranscriptDate,
        updatedAt: oldTranscriptDate,
      }),
      teacherRecording("teacher-selected-student-old", {
        status: TeacherRecordingSessionStatus.STUDENT_CONFIRMED,
        selectedStudentId: "student-a",
        promotedSessionId: "session-a",
        promotedConversationId: "conversation-a",
        confirmedAt: oldTranscriptDate,
        updatedAt: oldTranscriptDate,
      }),
      teacherRecording("teacher-raw-old", {
        transcriptText: "raw transcript",
        analyzedAt: oldTranscriptDate,
      }),
      teacherRecording("teacher-raw-new", {
        transcriptText: "raw transcript",
        analyzedAt: recentDate,
      }),
    ],
    sessionParts: [
      sessionPart("session-part-audio-old", {
        storageUrl: "blob://session-audio",
        createdAt: oldAudioDate,
      }),
      sessionPart("session-part-audio-other-org", {
        storageUrl: "blob://session-audio-other",
        createdAt: oldAudioDate,
        session: { organizationId: "org-b" },
      }),
      sessionPart("session-part-raw-old", {
        rawTextOriginal: "raw transcript",
        transcriptExpiresAt: new Date("2026-04-27T00:00:00.000Z"),
      }),
      sessionPart("session-part-raw-new", {
        rawTextOriginal: "raw transcript",
        transcriptExpiresAt: new Date("2026-04-29T00:00:00.000Z"),
      }),
    ],
    conversations: [
      conversation("conversation-raw-old", {
        rawTextOriginal: "raw transcript",
        rawTextExpiresAt: new Date("2026-04-27T00:00:00.000Z"),
      }),
      conversation("conversation-raw-other-org", {
        organizationId: "org-b",
        rawTextOriginal: "raw transcript",
        rawTextExpiresAt: new Date("2026-04-27T00:00:00.000Z"),
      }),
    ],
  },
});

function groupIds(key: DataRetentionDryRunRuleKey) {
  const group = result.groups.find((item) => item.key === key);
  assert.ok(group, `missing group ${key}`);
  return group.ids;
}

assert.equal(result.mode, "dry-run");
assert.equal(result.willDelete, false);
assert.deepEqual(groupIds("teacher_recording_audio"), ["teacher-audio-old"]);
assert.deepEqual(groupIds("teacher_recording_unconfirmed"), ["teacher-unconfirmed-old"]);
assert.deepEqual(groupIds("teacher_recording_error"), ["teacher-error-old"]);
assert.deepEqual(groupIds("teacher_recording_no_student"), ["teacher-no-student-old"]);
assert.deepEqual(groupIds("teacher_recording_raw_transcript"), ["teacher-raw-old"]);
assert.deepEqual(groupIds("session_part_audio"), ["session-part-audio-old"]);
assert.deepEqual(groupIds("session_part_raw_transcript"), ["session-part-raw-old"]);
assert.deepEqual(groupIds("conversation_raw_transcript"), ["conversation-raw-old"]);

const ruleBundle = buildDataRetentionDryRunRules({ organizationId, now });
for (const rule of ruleBundle.rules) {
  const where = rule.where as Record<string, any>;
  if (rule.targetType === "SessionPart") {
    assert.equal(where.session?.organizationId, organizationId, `${rule.key} must scope through Session.organizationId`);
  } else {
    assert.equal(where.organizationId, organizationId, `${rule.key} must scope by organizationId`);
  }
}

console.log("data retention dry-run candidate checks passed");
