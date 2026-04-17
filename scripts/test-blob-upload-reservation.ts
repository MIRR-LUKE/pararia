import assert from "node:assert/strict";
import { SessionPartType } from "@prisma/client";
import { consumeCompletedBlobUploadReservation } from "../lib/blob-upload-reservations";

async function main() {
  const completedReservation = {
    id: "reservation-completed",
    organizationId: "org-1",
    studentId: "student-1",
    sessionId: "session-1",
    partType: SessionPartType.FULL,
    uploadedByUserId: "user-1",
    uploadSource: "direct_recording",
    pathname: "session-audio/uploads/session-1/full/test.webm",
    expectedFileName: "test.webm",
    expectedMimeType: "audio/webm",
    expectedByteSize: 123,
    blobUrl: "https://blob.example/test.webm",
    blobDownloadUrl: "https://blob.example/download/test.webm",
    blobContentType: "audio/webm",
    blobByteSize: 123,
    status: "COMPLETED",
    completedAt: new Date("2026-04-17T00:00:00.000Z"),
    consumedAt: null,
    expiresAt: new Date("2026-04-17T01:00:00.000Z"),
    createdAt: new Date("2026-04-17T00:00:00.000Z"),
    updatedAt: new Date("2026-04-17T00:00:00.000Z"),
  };

  {
    let attempts = 0;
    let consumedReservationId: string | null = null;
    const sleepCalls: number[] = [];
    let currentTime = 0;

    const reservation = await consumeCompletedBlobUploadReservation(
      {
        organizationId: "org-1",
        sessionId: "session-1",
        partType: SessionPartType.FULL,
        pathname: "session-audio/uploads/session-1/full/test.webm",
      },
      {
        findReservation: async () => {
          attempts += 1;
          if (attempts < 3) return null;
          return completedReservation;
        },
        markConsumed: async ({ reservationId }) => {
          consumedReservationId = reservationId;
          return 1;
        },
        sleep: async (ms) => {
          sleepCalls.push(ms);
          currentTime += ms;
        },
        now: () => currentTime,
      }
    );

    assert.equal(reservation.id, completedReservation.id);
    assert.equal(attempts, 3, "reservation should be polled until completion arrives");
    assert.deepEqual(sleepCalls, [250, 250], "reservation polling should wait between attempts");
    assert.equal(consumedReservationId, completedReservation.id, "completed reservation should be consumed");
  }

  {
    let attempts = 0;
    let currentTime = 0;

    await assert.rejects(
      () =>
        consumeCompletedBlobUploadReservation(
          {
            organizationId: "org-1",
            sessionId: "session-1",
            partType: SessionPartType.FULL,
            pathname: "session-audio/uploads/session-1/full/test.webm",
          },
          {
            findReservation: async () => {
              attempts += 1;
              return null;
            },
            markConsumed: async () => 0,
            sleep: async (ms) => {
              currentTime += ms;
            },
            now: () => currentTime,
          }
        ),
      /アップロード予約が見つからないか、まだ完了していません。/
    );

    assert.ok(attempts > 1, "timeout path should retry before failing");
  }

  console.log("blob upload reservation regression checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
