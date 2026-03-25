#!/usr/bin/env tsx

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConversationSourceType, SessionPartStatus, SessionPartType, SessionType } from "@prisma/client";
import { transcribeAudioForPipeline } from "../lib/ai/stt";
import { preprocessTranscript, preprocessTranscriptWithSegments } from "../lib/transcript/preprocess";
import { buildSessionTranscript } from "../lib/session-service";
import { generateConversationArtifactsSinglePass, getPromptVersion } from "../lib/ai/conversationPipeline";

const desktopDir = "C:\\Users\\lukew\\Desktop";
const checkInPath = path.join(desktopDir, "3-22________________.m4a");
const checkOutPath = path.join(desktopDir, "3-22________________-1.m4a");
const outputDir = path.join(process.cwd(), ".tmp", "lesson-report-tuning");

async function transcribeOne(filePath: string) {
  const buffer = await readFile(filePath);
  const fileName = path.basename(filePath);
  const stt = await transcribeAudioForPipeline({
    buffer,
    filename: fileName,
    mimeType: "audio/mp4",
    language: "ja",
  });
  const pre =
    stt.segments.length > 0
      ? preprocessTranscriptWithSegments(stt.rawTextOriginal, stt.segments ?? [])
      : preprocessTranscript(stt.rawTextOriginal);
  return {
    filePath,
    fileName,
    stt,
    pre,
  };
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  console.log("Transcribing check-in...");
  const checkIn = await transcribeOne(checkInPath);
  console.log("Transcribing check-out...");
  const checkOut = await transcribeOne(checkOutPath);

  const transcript = buildSessionTranscript(SessionType.LESSON_REPORT, [
    {
      id: "check-in",
      partType: SessionPartType.CHECK_IN,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.AUDIO,
      rawTextOriginal: checkIn.pre.rawTextOriginal,
      rawTextCleaned: checkIn.pre.rawTextCleaned,
      rawSegments: checkIn.stt.segments,
    },
    {
      id: "check-out",
      partType: SessionPartType.CHECK_OUT,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.AUDIO,
      rawTextOriginal: checkOut.pre.rawTextOriginal,
      rawTextCleaned: checkOut.pre.rawTextCleaned,
      rawSegments: checkOut.stt.segments,
    },
  ]);

  console.log("Generating lesson report...");
  const { result, model, apiCalls, repaired } = await generateConversationArtifactsSinglePass({
    transcript,
    studentName: "堂林 徹生",
    teacherName: "PARARIA Admin",
    sessionDate: "2026-03-22",
    minSummaryChars: 900,
    minTimelineSections: 3,
    sessionType: "LESSON_REPORT",
  });

  const payload = {
    promptVersion: getPromptVersion(),
    model,
    apiCalls,
    repaired,
    checkIn: {
      fileName: checkIn.fileName,
      sttMeta: checkIn.stt.meta,
      rawTextOriginal: checkIn.pre.rawTextOriginal,
      rawTextCleaned: checkIn.pre.rawTextCleaned,
    },
    checkOut: {
      fileName: checkOut.fileName,
      sttMeta: checkOut.stt.meta,
      rawTextOriginal: checkOut.pre.rawTextOriginal,
      rawTextCleaned: checkOut.pre.rawTextCleaned,
    },
    combinedTranscript: transcript,
    result,
  };

  const jsonPath = path.join(outputDir, "latest.json");
  const mdPath = path.join(outputDir, "latest-summary.md");
  const transcriptPath = path.join(outputDir, "latest-transcript.txt");

  await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(mdPath, result.summaryMarkdown ?? "", "utf8");
  await writeFile(transcriptPath, transcript, "utf8");

  console.log(`Saved transcript: ${transcriptPath}`);
  console.log(`Saved summary: ${mdPath}`);
  console.log(`Saved debug json: ${jsonPath}`);
  console.log("\n===== SUMMARY =====\n");
  console.log(result.summaryMarkdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
