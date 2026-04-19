-- CreateEnum
CREATE TYPE "TeacherRecordingJobType" AS ENUM ('TRANSCRIBE_AND_SUGGEST');

-- CreateEnum
CREATE TYPE "TeacherRecordingSessionStatus" AS ENUM (
    'RECORDING',
    'TRANSCRIBING',
    'AWAITING_STUDENT_CONFIRMATION',
    'STUDENT_CONFIRMED',
    'CANCELLED',
    'ERROR'
);

-- CreateTable
CREATE TABLE "TeacherRecordingSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "selectedStudentId" TEXT,
    "deviceLabel" TEXT NOT NULL,
    "status" "TeacherRecordingSessionStatus" NOT NULL DEFAULT 'RECORDING',
    "audioFileName" TEXT,
    "audioMimeType" TEXT,
    "audioByteSize" INTEGER,
    "audioStorageUrl" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "transcriptText" TEXT,
    "transcriptSegmentsJson" JSONB,
    "transcriptMetaJson" JSONB,
    "suggestedStudentsJson" JSONB,
    "errorMessage" TEXT,
    "recordedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "analyzedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "processingLeaseExecutionId" TEXT,
    "processingLeaseExpiresAt" TIMESTAMP(3),
    "processingLeaseStartedAt" TIMESTAMP(3),
    "processingLeaseHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherRecordingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherRecordingJob" (
    "id" TEXT NOT NULL,
    "recordingSessionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "TeacherRecordingJobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "executionId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "outputJson" JSONB,
    "costMetaJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherRecordingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeacherRecordingSession_organizationId_deviceLabel_status_createdAt_idx"
ON "TeacherRecordingSession"("organizationId", "deviceLabel", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TeacherRecordingSession_createdByUserId_status_createdAt_idx"
ON "TeacherRecordingSession"("createdByUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TeacherRecordingSession_selectedStudentId_createdAt_idx"
ON "TeacherRecordingSession"("selectedStudentId", "createdAt");

-- CreateIndex
CREATE INDEX "TeacherRecordingSession_processingLeaseExpiresAt_idx"
ON "TeacherRecordingSession"("processingLeaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherRecordingJob_recordingSessionId_type_key"
ON "TeacherRecordingJob"("recordingSessionId", "type");

-- CreateIndex
CREATE INDEX "TeacherRecordingJob_status_type_idx"
ON "TeacherRecordingJob"("status", "type");

-- CreateIndex
CREATE INDEX "TeacherRecordingJob_recordingSessionId_type_status_idx"
ON "TeacherRecordingJob"("recordingSessionId", "type", "status");

-- AddForeignKey
ALTER TABLE "TeacherRecordingSession"
ADD CONSTRAINT "TeacherRecordingSession_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherRecordingSession"
ADD CONSTRAINT "TeacherRecordingSession_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherRecordingSession"
ADD CONSTRAINT "TeacherRecordingSession_selectedStudentId_fkey"
FOREIGN KEY ("selectedStudentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherRecordingJob"
ADD CONSTRAINT "TeacherRecordingJob_recordingSessionId_fkey"
FOREIGN KEY ("recordingSessionId") REFERENCES "TeacherRecordingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherRecordingJob"
ADD CONSTRAINT "TeacherRecordingJob_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
