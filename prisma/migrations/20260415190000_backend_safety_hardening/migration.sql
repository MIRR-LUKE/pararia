-- CreateTable
CREATE TABLE "BlobUploadReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "partType" "SessionPartType" NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "uploadSource" TEXT NOT NULL DEFAULT 'file_upload',
    "pathname" TEXT NOT NULL,
    "expectedFileName" TEXT,
    "expectedMimeType" TEXT,
    "expectedByteSize" INTEGER,
    "blobUrl" TEXT,
    "blobDownloadUrl" TEXT,
    "blobContentType" TEXT,
    "blobByteSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlobUploadReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageDeletionRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "storageUrl" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiThrottleBucket" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "byteCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiThrottleBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRequest" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlobUploadReservation_pathname_key" ON "BlobUploadReservation"("pathname");

-- CreateIndex
CREATE INDEX "BlobUploadReservation_organizationId_status_expiresAt_idx" ON "BlobUploadReservation"("organizationId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "BlobUploadReservation_sessionId_partType_status_idx" ON "BlobUploadReservation"("sessionId", "partType", "status");

-- CreateIndex
CREATE INDEX "BlobUploadReservation_uploadedByUserId_status_idx" ON "BlobUploadReservation"("uploadedByUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StorageDeletionRequest_storageUrl_key" ON "StorageDeletionRequest"("storageUrl");

-- CreateIndex
CREATE INDEX "StorageDeletionRequest_status_nextAttemptAt_idx" ON "StorageDeletionRequest"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "StorageDeletionRequest_organizationId_createdAt_idx" ON "StorageDeletionRequest"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiThrottleBucket_scope_keyHash_key" ON "ApiThrottleBucket"("scope", "keyHash");

-- CreateIndex
CREATE INDEX "ApiThrottleBucket_scope_blockedUntil_idx" ON "ApiThrottleBucket"("scope", "blockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRequest_scope_keyHash_key" ON "IdempotencyRequest"("scope", "keyHash");

-- CreateIndex
CREATE INDEX "IdempotencyRequest_status_expiresAt_idx" ON "IdempotencyRequest"("status", "expiresAt");
