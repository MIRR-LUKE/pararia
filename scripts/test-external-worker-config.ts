import assert from "node:assert/strict";
import { getExternalWorkerAudioStorageError } from "../lib/jobs/execution-mode";

const originalEnv = {
  PARARIA_BACKGROUND_MODE: process.env.PARARIA_BACKGROUND_MODE,
  PARARIA_AUDIO_STORAGE_MODE: process.env.PARARIA_AUDIO_STORAGE_MODE,
  BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

try {
  process.env.PARARIA_BACKGROUND_MODE = "external";
  process.env.PARARIA_AUDIO_STORAGE_MODE = "local";
  delete process.env.BLOB_READ_WRITE_TOKEN;
  assert.match(String(getExternalWorkerAudioStorageError()), /PARARIA_AUDIO_STORAGE_MODE=blob/);

  process.env.PARARIA_AUDIO_STORAGE_MODE = "blob";
  assert.equal(getExternalWorkerAudioStorageError(), null);

  process.env.PARARIA_BACKGROUND_MODE = "inline";
  process.env.PARARIA_AUDIO_STORAGE_MODE = "local";
  assert.equal(getExternalWorkerAudioStorageError(), null);

  console.log("external worker config regression check passed");
} finally {
  restoreEnv();
}
