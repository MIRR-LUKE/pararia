import assert from "node:assert/strict";
import {
  AUDIO_UPLOAD_ACCEPT_ATTR,
  AUDIO_UPLOAD_EXTENSIONS_LABEL,
  buildUnsupportedAudioUploadErrorMessage,
  guessAudioMimeTypeFromFileName,
  isSupportedAudioUpload,
} from "../lib/audio-upload-support";

assert.equal(AUDIO_UPLOAD_ACCEPT_ATTR, ".mp3,.m4a");
assert.equal(AUDIO_UPLOAD_EXTENSIONS_LABEL, ".mp3, .m4a");

assert.equal(isSupportedAudioUpload({ fileName: "sample.mp3", mimeType: "audio/mpeg" }), true);
assert.equal(isSupportedAudioUpload({ fileName: "sample.m4a", mimeType: "audio/mp4" }), true);
assert.equal(isSupportedAudioUpload({ fileName: "sample.wav", mimeType: "audio/wav" }), false);
assert.equal(isSupportedAudioUpload({ fileName: "sample.wav", mimeType: "audio/mp4" }), false);
assert.equal(isSupportedAudioUpload({ fileName: "sample.webm", mimeType: "audio/webm" }), false);
assert.equal(isSupportedAudioUpload({ fileName: "sample", mimeType: "audio/mp4" }), false);

assert.equal(guessAudioMimeTypeFromFileName("sample.mp3"), "audio/mpeg");
assert.equal(guessAudioMimeTypeFromFileName("sample.m4a"), "audio/mp4");
assert.equal(guessAudioMimeTypeFromFileName("sample.wav", "audio/fallback"), "audio/fallback");

assert.match(buildUnsupportedAudioUploadErrorMessage(), /\.mp3, \.m4a/);

console.log("audio upload support regression check passed");
