/**
 * Keep direct recording on the simplest, most stable path by default:
 * record locally -> upload one finalized file -> Runpod STT.
 *
 * Chunked live upload can be re-enabled explicitly for experiments, but we
 * keep it off unless the public env is set so the browser and server agree.
 */
export function isLiveChunkUploadEnabled() {
  return process.env.NEXT_PUBLIC_PARARIA_LIVE_CHUNK_UPLOAD === "1";
}
