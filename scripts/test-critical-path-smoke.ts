import { runNextMeetingMemoRouteTest } from "./test-next-meeting-memo-route";
import { runRecordingLockRouteTest } from "./test-recording-lock-route";
import { runStudentRoomRouteTest } from "./test-student-room-route";

async function main() {
  await Promise.all([
    runRecordingLockRouteTest(),
    runStudentRoomRouteTest(),
    runNextMeetingMemoRouteTest(),
  ]);
  console.log("critical-path smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
