#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRawTranscriptText, normalizeSegments } from "../lib/ai/stt/normalize";
import { materializeInputFile } from "../lib/ai/stt/input";
import {
  shouldChunkTranscription,
  transcribeChunkedAudio,
  transcribeSingleAudio,
} from "../lib/ai/stt/chunking";
import type { FasterWhisperWorkerHandle } from "../lib/ai/stt/types";

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pararia-stt-refactor-"));

  try {
    const bufferInput = await materializeInputFile({
      buffer: Buffer.from("sample-audio"),
      filename: "sample.webm",
    });
    assert.equal(path.extname(bufferInput.audioPath), ".webm");
    assert.equal(await readFile(bufferInput.audioPath, "utf8"), "sample-audio");
    await bufferInput.cleanup();
    await assert.rejects(() => stat(bufferInput.audioPath));

    const resolvedInput = await materializeInputFile({
      filePath: path.join(tempRoot, "clip.m4a"),
    });
    assert.equal(resolvedInput.audioPath, path.resolve(path.join(tempRoot, "clip.m4a")));
    await resolvedInput.cleanup();

    const normalized = normalizeSegments({
      segments: [
        { start: 0, end: 1, text: "重複する文です。" },
        { start: 1.1, end: 2.1, text: "重複する文です。" },
        { start: 3, end: 3.2, text: "続き" },
      ],
    });
    assert.equal(normalized.segments.length, 2);
    assert.deepEqual(normalized.qualityWarnings, ["adjacent_duplicates_removed"]);
    assert.match(buildRawTranscriptText([{ text: "a" }, { text: "b" }], normalized.segments), /a/);

    assert.equal(
      shouldChunkTranscription({
        chunkingEnabled: true,
        durationSeconds: 240,
        hasFilePath: true,
        minDurationSeconds: 180,
      }),
      true
    );
    assert.equal(
      shouldChunkTranscription({
        chunkingEnabled: true,
        durationSeconds: 120,
        hasFilePath: true,
        minDurationSeconds: 180,
      }),
      false
    );
    assert.equal(
      shouldChunkTranscription({
        chunkingEnabled: true,
        durationSeconds: 240,
        hasFilePath: false,
        minDurationSeconds: 180,
      }),
      false
    );

    const singleCalls: string[] = [];
    const single = await transcribeSingleAudio(
      { audioPath: "/tmp/single.m4a", language: "ja" },
      {
        pickWorker: (): FasterWhisperWorkerHandle => ({
          async warm() {
            return { event: "ready", ok: true };
          },
          async transcribe({ audioPath }: { audioPath: string }) {
            singleCalls.push(audioPath);
            return {
              id: "single",
              ok: true,
              text: "単一音声",
              segments: [{ start: 0.1, end: 1.1, text: "単一音声" }],
            };
          },
          getLoad() {
            return 0;
          },
          shutdown() {},
        }),
      }
    );
    assert.deepEqual(singleCalls, ["/tmp/single.m4a"]);
    assert.equal(single.responses.length, 1);
    assert.equal(single.normalized.segments.length, 1);

    const chunkCalls: string[] = [];
    let cleanupTarget = "";
    const chunked = await transcribeChunkedAudio(
      { audioPath: "/tmp/chunked.m4a", language: "ja" },
      {
        chunkSeconds: 60,
        overlapSeconds: 1.5,
        pickWorker: (): FasterWhisperWorkerHandle => ({
          async warm() {
            return { event: "ready", ok: true };
          },
          async transcribe({ audioPath }: { audioPath: string }) {
            chunkCalls.push(audioPath);
            if (audioPath.includes("chunk-0000")) {
              return {
                id: "chunk-0",
                ok: true,
                text: "最初の区間",
                segments: [{ start: 0.2, end: 1.2, text: "最初の区間" }],
              };
            }
            return {
              id: "chunk-1",
              ok: true,
              text: "次の区間",
              segments: [{ start: 0.3, end: 1.0, text: "次の区間" }],
            };
          },
          getLoad() {
            return 0;
          },
          shutdown() {},
        }),
        splitAudioForParallelTranscription: async (_inputPath: string, targetDir: string) => ({
          durationSeconds: 120,
          chunkSeconds: 60,
          overlapSeconds: 1.5,
          strideSeconds: 58.5,
          chunks: [
            { index: 0, startSeconds: 0, durationSeconds: 60, filePath: path.join(targetDir, "chunk-0000.m4a") },
            {
              index: 1,
              startSeconds: 58.5,
              durationSeconds: 60,
              filePath: path.join(targetDir, "chunk-0001.m4a"),
            },
          ],
        }),
        cleanupAudioChunkDirectory: async (targetDir) => {
          cleanupTarget = targetDir;
        },
      }
    );
    assert.equal(chunkCalls.length, 2);
    assert.equal(chunked.responses.length, 2);
    assert.equal(chunked.normalized.segments.length, 2);
    assert.match(chunked.normalized.segments[0]?.text ?? "", /最初の区間/);
    assert.match(chunked.normalized.segments[1]?.text ?? "", /次の区間/);
    assert.match(cleanupTarget, /stt-chunks/);

    console.log("test-stt-runtime-refactor: ok");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
