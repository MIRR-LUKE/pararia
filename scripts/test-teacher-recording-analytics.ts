import assert from "node:assert/strict";
import { ConversationStatus, JobStatus, TeacherRecordingJobType, TeacherRecordingSessionStatus } from "@prisma/client";
import {
  buildTeacherRecordingAnalytics,
  normalizeTeacherRecordingAnalyticsPeriod,
  TEACHER_RECORDING_ANALYTICS_DEFAULT_WINDOW_DAYS,
  TEACHER_RECORDING_ANALYTICS_MAX_WINDOW_DAYS,
  type TeacherRecordingAnalyticsRecordingRow,
} from "../lib/teacher-app/server/recording-analytics.js";

const base = new Date("2026-04-01T00:00:00.000Z");

function minutes(value: number) {
  return new Date(base.getTime() + value * 60 * 1000);
}

function daysBefore(value: Date, days: number) {
  return new Date(value.getTime() - days * 24 * 60 * 60 * 1000);
}

function recording(
  id: string,
  status: TeacherRecordingSessionStatus,
  overrides: Partial<TeacherRecordingAnalyticsRecordingRow> = {}
): TeacherRecordingAnalyticsRecordingRow {
  return {
    id,
    organizationId: "org-a",
    status,
    selectedStudentId: null,
    audioStorageUrl: null,
    suggestedStudentsJson: null,
    recordedAt: minutes(0),
    uploadedAt: null,
    analyzedAt: null,
    confirmedAt: null,
    promotionTriggeredAt: null,
    promotedConversationId: null,
    createdAt: minutes(0),
    jobs: [],
    ...overrides,
  };
}

const analytics = buildTeacherRecordingAnalytics({
  organization: { id: "org-a", name: "Org A" },
  generatedAt: minutes(60),
  period: { from: minutes(0), to: minutes(60) },
  recordings: [
    recording("r-top1", TeacherRecordingSessionStatus.STUDENT_CONFIRMED, {
      selectedStudentId: "student-1",
      audioStorageUrl: "blob://r-top1",
      suggestedStudentsJson: [{ id: "student-1" }, { id: "student-2" }, { id: "student-3" }],
      uploadedAt: minutes(2),
      analyzedAt: minutes(5),
      confirmedAt: minutes(8),
      promotionTriggeredAt: minutes(9),
      promotedConversationId: "log-1",
      jobs: [{ type: TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST, status: JobStatus.DONE }],
    }),
    recording("r-top3", TeacherRecordingSessionStatus.STUDENT_CONFIRMED, {
      selectedStudentId: "student-2",
      audioStorageUrl: "blob://r-top3",
      suggestedStudentsJson: [{ id: "student-9" }, { id: "student-2" }, { id: "student-3" }],
      uploadedAt: minutes(4),
      analyzedAt: minutes(7),
      confirmedAt: minutes(11),
      promotionTriggeredAt: minutes(12),
      promotedConversationId: "log-2",
      jobs: [{ type: TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST, status: JobStatus.DONE }],
    }),
    recording("r-none", TeacherRecordingSessionStatus.STUDENT_CONFIRMED, {
      selectedStudentId: null,
      audioStorageUrl: "blob://r-none",
      suggestedStudentsJson: [{ id: "student-3" }],
      uploadedAt: minutes(6),
      analyzedAt: minutes(9),
      confirmedAt: minutes(13),
      promotionTriggeredAt: null,
      jobs: [{ type: TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST, status: JobStatus.DONE }],
    }),
    recording("r-outside", TeacherRecordingSessionStatus.STUDENT_CONFIRMED, {
      selectedStudentId: "student-4",
      audioStorageUrl: "blob://r-outside",
      suggestedStudentsJson: [{ id: "student-1" }, { id: "student-2" }, { id: "student-3" }],
      uploadedAt: minutes(8),
      analyzedAt: minutes(10),
      confirmedAt: minutes(14),
      promotionTriggeredAt: minutes(15),
      promotedConversationId: "log-3",
      jobs: [{ type: TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST, status: JobStatus.DONE }],
    }),
    recording("r-unconfirmed", TeacherRecordingSessionStatus.AWAITING_STUDENT_CONFIRMATION, {
      audioStorageUrl: "blob://r-unconfirmed",
      suggestedStudentsJson: [{ id: "student-5" }],
      uploadedAt: minutes(10),
      analyzedAt: minutes(13),
      jobs: [{ type: TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST, status: JobStatus.DONE }],
    }),
    recording("r-stt-error", TeacherRecordingSessionStatus.ERROR, {
      audioStorageUrl: "blob://r-stt-error",
      uploadedAt: minutes(12),
      jobs: [{ type: TeacherRecordingJobType.TRANSCRIBE_AND_SUGGEST, status: JobStatus.ERROR }],
    }),
    recording("r-cancelled", TeacherRecordingSessionStatus.CANCELLED),
  ],
  conversations: [
    {
      id: "log-1",
      organizationId: "org-a",
      studentId: "student-1",
      status: ConversationStatus.DONE,
      createdAt: minutes(20),
      student: { id: "student-1", name: "Student 1" },
    },
    {
      id: "log-2",
      organizationId: "org-a",
      studentId: "student-2",
      status: ConversationStatus.PROCESSING,
      createdAt: minutes(21),
      student: { id: "student-2", name: "Student 2" },
    },
    {
      id: "log-3",
      organizationId: "org-a",
      studentId: "student-4",
      status: ConversationStatus.DONE,
      createdAt: minutes(22),
      student: { id: "student-4", name: "Student 4" },
    },
  ],
  reports: [
    {
      id: "report-1",
      organizationId: "org-a",
      studentId: "student-1",
      sourceLogIds: ["log-1", "log-2", "foreign-log"],
      createdAt: minutes(30),
    },
    {
      id: "report-duplicate",
      organizationId: "org-a",
      studentId: "student-1",
      sourceLogIds: ["log-1"],
      createdAt: minutes(31),
    },
    {
      id: "report-cross-tenant",
      organizationId: "org-b",
      studentId: "student-x",
      sourceLogIds: ["log-3"],
      createdAt: minutes(32),
    },
  ],
});

assert.equal(analytics.recordings.totalCount, 7);
assert.equal(analytics.recordings.recordingSuccess.denominator, 7);
assert.equal(analytics.recordings.recordingSuccess.count, 6);
assert.equal(analytics.recordings.recordingSuccess.cancelledCount, 1);

assert.equal(analytics.recordings.sttSuccess.denominator, 6);
assert.equal(analytics.recordings.sttSuccess.count, 5);
assert.equal(analytics.recordings.sttSuccess.failedCount, 1);

assert.equal(analytics.recordings.studentConfirmation.denominator, 5);
assert.equal(analytics.recordings.studentConfirmation.confirmedCount, 4);
assert.equal(analytics.recordings.studentConfirmation.unconfirmedCount, 1);
assert.equal(analytics.recordings.studentConfirmation.noStudentCount, 1);
assert.equal(analytics.recordings.studentConfirmation.confirmationRate, 4 / 5);

assert.equal(analytics.studentSuggestion.denominator, 4);
assert.equal(analytics.studentSuggestion.unconfirmedCount, 1);
assert.equal(analytics.studentSuggestion.top1Count, 1);
assert.equal(analytics.studentSuggestion.top3Count, 2);
assert.equal(analytics.studentSuggestion.noStudentCount, 1);
assert.equal(analytics.studentSuggestion.candidateOutsideCount, 1);
assert.equal(analytics.studentSuggestion.top1Rate, 1 / 4);
assert.equal(analytics.studentSuggestion.top3Rate, 2 / 4);
assert.equal(analytics.studentSuggestion.noStudentRate, 1 / 4);
assert.equal(analytics.studentSuggestion.candidateOutsideRate, 1 / 4);

assert.equal(analytics.recordings.logGeneration.denominator, 3);
assert.equal(analytics.recordings.logGeneration.generatedCount, 3);
assert.equal(analytics.recordings.logGeneration.generatedDoneCount, 2);
assert.equal(analytics.recordings.logGeneration.generationRate, 1);
assert.equal(analytics.recordings.logGeneration.generatedDoneRate, 2 / 3);

assert.equal(analytics.logAdoption.logCount, 3);
assert.equal(analytics.logAdoption.adoptedLogCount, 2);
assert.equal(analytics.logAdoption.unadoptedLogCount, 1);
assert.equal(analytics.logAdoption.adoptionRate, 2 / 3);
assert.equal(analytics.recordings.parentReportAdoption.adoptionRate, 2 / 3);
assert.deepEqual(
  analytics.logAdoption.byOrganization.map((row) => ({
    organizationId: row.organizationId,
    logCount: row.logCount,
    adoptedLogCount: row.adoptedLogCount,
  })),
  [{ organizationId: "org-a", logCount: 3, adoptedLogCount: 2 }]
);
assert.equal(analytics.logAdoption.byStudent.find((row) => row.studentId === "student-4")?.adoptedLogCount, 0);

assert.equal(analytics.recordings.intervals.recordingToUpload.count, 6);
assert.equal(analytics.recordings.intervals.uploadToStt.count, 5);
assert.equal(analytics.recordings.intervals.sttToConfirmation.count, 4);
assert.equal(analytics.recordings.intervals.recordingToConfirmation.count, 4);

const now = new Date("2026-04-28T12:00:00.000Z");
const defaultPeriod = normalizeTeacherRecordingAnalyticsPeriod(undefined, now);
assert.equal(defaultPeriod.to.toISOString(), now.toISOString());
assert.equal(defaultPeriod.from.toISOString(), daysBefore(now, TEACHER_RECORDING_ANALYTICS_DEFAULT_WINDOW_DAYS).toISOString());

const toOnly = new Date("2026-04-20T00:00:00.000Z");
const toOnlyPeriod = normalizeTeacherRecordingAnalyticsPeriod({ to: toOnly }, now);
assert.equal(toOnlyPeriod.to.toISOString(), toOnly.toISOString());
assert.equal(
  toOnlyPeriod.from.toISOString(),
  daysBefore(toOnly, TEACHER_RECORDING_ANALYTICS_DEFAULT_WINDOW_DAYS).toISOString()
);

assert.throws(
  () =>
    normalizeTeacherRecordingAnalyticsPeriod(
      {
        from: daysBefore(now, TEACHER_RECORDING_ANALYTICS_MAX_WINDOW_DAYS + 1),
        to: now,
      },
      now
    ),
  /最大180日/
);

console.log("teacher recording analytics checks passed");
