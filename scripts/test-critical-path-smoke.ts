#!/usr/bin/env tsx

import { pathToFileURL } from "node:url";
import { loadCriticalPathSmokeEnv } from "./lib/critical-path-smoke";
import { runNextMeetingMemoRouteSmoke } from "./test-next-meeting-memo-route";
import { runRecordingLockRouteSmoke } from "./test-recording-lock-route";
import { runSessionProgressRouteSmoke } from "./test-session-progress-route";
import { runStudentRoomRouteSmoke } from "./test-student-room-route";

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function runCriticalPathStep<T>(name: string, run: () => Promise<T>) {
  console.log(`[critical-path-smoke] ${name}: start`);
  try {
    const result = await run();
    console.log(`[critical-path-smoke] ${name}: ok`);
    return result;
  } catch (error) {
    console.error(`[critical-path-smoke] ${name}: failed`, error);
    throw error;
  }
}

export async function runCriticalPathSmoke(baseUrl: string) {
  await loadCriticalPathSmokeEnv();
  const startedAt = Date.now();
  const recordingLock = await runCriticalPathStep("recording-lock", () => runRecordingLockRouteSmoke(baseUrl));
  const studentRoom = await runCriticalPathStep("student-room", () => runStudentRoomRouteSmoke(baseUrl));
  const sessionProgress = await runCriticalPathStep("session-progress", () => runSessionProgressRouteSmoke(baseUrl));
  const nextMeetingMemo = await runCriticalPathStep("next-meeting-memo", () => runNextMeetingMemoRouteSmoke(baseUrl));

  return {
    baseUrl,
    elapsedMs: Date.now() - startedAt,
    recordingLock,
    studentRoom,
    sessionProgress,
    nextMeetingMemo,
  };
}

async function main() {
  const baseUrl = argValue("--base-url") || process.env.CRITICAL_PATH_BASE_URL || "http://127.0.0.1:3000";
  const result = await runCriticalPathSmoke(baseUrl);
  console.log(JSON.stringify({ label: "critical-path-smoke", ...result }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
