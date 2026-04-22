#!/usr/bin/env tsx

import path from "node:path";
import {
  argValue,
  ensureFakeAudioFile,
  fileExists,
  hasFlag,
  type RecordingUiResult,
  runRecordingUiSmoke,
} from "./lib/recording-ui-runner";
import { loadEnvFile } from "./lib/load-env-file";
import { runScriptStep } from "./lib/script-step";

function assertRecordingUiExpectations(
  result: RecordingUiResult,
  options: {
    requireRunpodStop: boolean;
    expectedCompletionState: string | null;
    expectedNextMeetingMemoStatus: string | null;
    expectedObservedStates: string[];
  }
) {
  if (options.expectedCompletionState && result.completionState !== options.expectedCompletionState) {
    throw new Error(
      `録音 UI smoke の completionState が期待と違います: actual=${result.completionState} expected=${options.expectedCompletionState}`
    );
  }

  if (options.requireRunpodStop && !result.runpodStoppedAfterRun) {
    throw new Error("録音 UI smoke 後に Runpod が stopped になりませんでした。");
  }

  if (
    options.expectedNextMeetingMemoStatus &&
    result.nextMeetingMemoStatus !== options.expectedNextMeetingMemoStatus
  ) {
    throw new Error(
      `録音 UI smoke の nextMeetingMemoStatus が期待と違います: actual=${result.nextMeetingMemoStatus ?? "null"} expected=${options.expectedNextMeetingMemoStatus}`
    );
  }

  if (options.expectedObservedStates.length > 0) {
    const missingStates = options.expectedObservedStates.filter((state) => !result.observedStates.includes(state));
    if (missingStates.length > 0) {
      throw new Error(
        `録音 UI smoke の observedStates に必須状態が足りません: missing=${missingStates.join(", ")} actual=${result.observedStates.join(", ")}`
      );
    }
  }
}

async function main() {
  const label = argValue(process.argv, "--label") || process.env.RECORDING_UI_LABEL || "local";
  const baseUrl = argValue(process.argv, "--base-url") || process.env.RECORDING_UI_BASE_URL || "http://localhost:3000";
  const envFile = path.resolve(process.cwd(), argValue(process.argv, "--env-file") || process.env.RECORDING_UI_ENV_FILE || ".env.local");
  const keepArtifacts = hasFlag(process.argv, "--keep-artifacts") || process.env.RECORDING_UI_KEEP_ARTIFACTS === "1";
  const skipNavigationDialog = hasFlag(process.argv, "--skip-navigation-dialog");
  const leaveSafetyOnly = hasFlag(process.argv, "--leave-safety-only");
  const expectRejection = hasFlag(process.argv, "--expect-rejection");
  const requireRunpodStop =
    hasFlag(process.argv, "--require-runpod-stop") || process.env.RECORDING_UI_REQUIRE_RUNPOD_STOP === "1";
  const expectedCompletionState =
    argValue(process.argv, "--expect-completion-state") || process.env.RECORDING_UI_EXPECT_COMPLETION_STATE || null;
  const expectedNextMeetingMemoStatus =
    argValue(process.argv, "--expect-next-meeting-memo-status") ||
    process.env.RECORDING_UI_EXPECT_NEXT_MEETING_MEMO_STATUS ||
    null;
  const expectedObservedStates = (
    argValue(process.argv, "--expect-observed-states") || process.env.RECORDING_UI_EXPECT_OBSERVED_STATES || ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const uploadFilePathArg = argValue(process.argv, "--upload-file-path") || process.env.RECORDING_UI_UPLOAD_FILE_PATH;
  const outputPath = path.resolve(
    process.cwd(),
    argValue(process.argv, "--output") || process.env.RECORDING_UI_OUTPUT || `.tmp/recording-ui-${label}.json`
  );
  const fakeMp3Path = path.resolve(process.cwd(), "scripts/fixtures/audio/prod-e2e-65s.mp3");
  const fakeAudioPathArg = argValue(process.argv, "--fake-audio-path") || process.env.RECORDING_UI_FAKE_AUDIO_PATH;
  const fakeAudioPath = fakeAudioPathArg
    ? path.resolve(process.cwd(), fakeAudioPathArg)
    : path.resolve(process.cwd(), ".tmp/recording-ui-125s.wav");
  const uploadFilePath = uploadFilePathArg ? path.resolve(process.cwd(), uploadFilePathArg) : null;

  await loadEnvFile(envFile, { overrideExisting: true, optional: true });

  if (!fakeAudioPathArg) {
    await ensureFakeAudioFile(fakeAudioPath, fakeMp3Path);
  } else if (!(await fileExists(fakeAudioPath))) {
    throw new Error(`指定された fake audio が見つかりません: ${fakeAudioPath}`);
  }
  if (uploadFilePath && !(await fileExists(uploadFilePath))) {
    throw new Error(`指定された upload file が見つかりません: ${uploadFilePath}`);
  }

  const result = await runScriptStep("recording-ui", "run", () =>
    runRecordingUiSmoke({
      label,
      baseUrl,
      envFile,
      keepArtifacts,
      skipNavigationDialog,
      leaveSafetyOnly,
      expectRejection,
      uploadFilePath,
      outputPath,
      fakeAudioPath,
    })
  );

  assertRecordingUiExpectations(result, {
    requireRunpodStop,
    expectedCompletionState,
    expectedNextMeetingMemoStatus,
    expectedObservedStates,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
