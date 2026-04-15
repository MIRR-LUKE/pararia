#!/usr/bin/env tsx

import path from "node:path";
import {
  argValue,
  ensureFakeAudioFile,
  fileExists,
  hasFlag,
  runRecordingUiSmoke,
} from "./lib/recording-ui-runner";
import { loadEnvFile } from "./lib/load-env-file";
import { runScriptStep } from "./lib/script-step";

async function main() {
  const label = argValue(process.argv, "--label") || process.env.RECORDING_UI_LABEL || "local";
  const baseUrl = argValue(process.argv, "--base-url") || process.env.RECORDING_UI_BASE_URL || "http://localhost:3000";
  const envFile = path.resolve(process.cwd(), argValue(process.argv, "--env-file") || process.env.RECORDING_UI_ENV_FILE || ".env.local");
  const keepArtifacts = hasFlag(process.argv, "--keep-artifacts") || process.env.RECORDING_UI_KEEP_ARTIFACTS === "1";
  const skipNavigationDialog = hasFlag(process.argv, "--skip-navigation-dialog");
  const leaveSafetyOnly = hasFlag(process.argv, "--leave-safety-only");
  const expectRejection = hasFlag(process.argv, "--expect-rejection");
  const uploadFilePathArg = argValue(process.argv, "--upload-file-path") || process.env.RECORDING_UI_UPLOAD_FILE_PATH;
  const outputPath = path.resolve(
    process.cwd(),
    argValue(process.argv, "--output") || process.env.RECORDING_UI_OUTPUT || `.tmp/recording-ui-${label}.json`
  );
  const fakeMp3Path = path.resolve(process.cwd(), ".tmp/prod-e2e-65s.mp3");
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

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
