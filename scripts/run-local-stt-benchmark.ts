import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { transcribeAudioForPipeline, stopFasterWhisperWorkers } from "../lib/ai/stt";
import { getAudioDurationSeconds } from "../lib/audio-processing";

function resolveInputPath() {
  const argPath = process.argv[2]?.trim();
  if (argPath) return path.resolve(argPath);
  return path.resolve("C:/Users/lukew/Desktop/01-30 面談_ 受験戦略とルール運用（時間配分・見直し・難問後回し.mp3");
}

function formatSeconds(sec: number) {
  const value = Number.isFinite(sec) ? sec : 0;
  const min = Math.floor(value / 60);
  const remain = value - min * 60;
  return `${min}分${remain.toFixed(1)}秒`;
}

async function main() {
  const inputPath = resolveInputPath();
  const startedAt = Date.now();
  const audioDurationSeconds = await getAudioDurationSeconds(inputPath);
  const result = await transcribeAudioForPipeline({
    filePath: inputPath,
    filename: path.basename(inputPath),
    mimeType: "audio/mpeg",
    language: "ja",
  });
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const realtimeX = audioDurationSeconds > 0 ? audioDurationSeconds / Math.max(elapsedSeconds, 0.001) : 0;

  const docsDir = path.join(process.cwd(), "docs", "stt-benchmarks");
  await mkdir(docsDir, { recursive: true });
  const baseName = path.basename(inputPath, path.extname(inputPath)).replace(/[\\\\/:*?\"<>|]/g, "_");
  const transcriptMdPath = path.join(docsDir, `${baseName}_STT生文字起こし.md`);
  const metricsMdPath = path.join(docsDir, `${baseName}_STT計測.md`);
  const metricsJsonPath = path.join(docsDir, `${baseName}_STT計測.json`);

  const metrics = {
    inputPath,
    audioDurationSeconds,
    elapsedSeconds,
    realtimeX,
    segmentCount: result.segments.length,
    model: result.meta.model,
    responseFormat: result.meta.responseFormat,
    attemptCount: result.meta.attemptCount,
    qualityWarnings: result.meta.qualityWarnings,
    generatedAt: new Date().toISOString(),
  };

  const metricsMd = [
    "# 01-30面談 STT 計測（爆速化後）",
    "",
    `- 入力ファイル: ${inputPath}`,
    `- 音声長: ${audioDurationSeconds.toFixed(1)}秒 (${formatSeconds(audioDurationSeconds)})`,
    `- STT実行時間: ${elapsedSeconds.toFixed(1)}秒 (${formatSeconds(elapsedSeconds)})`,
    `- 実効速度: ${realtimeX.toFixed(2)}x realtime`,
    `- セグメント数: ${result.segments.length}`,
    `- モデル: ${result.meta.model}`,
    `- レスポンス形式: ${result.meta.responseFormat}`,
    `- STT試行回数: ${result.meta.attemptCount}`,
    `- 品質警告: ${(result.meta.qualityWarnings ?? []).join(", ") || "なし"}`,
    "",
  ].join("\n");

  const transcriptMd = [
    "# 01-30面談 STT生文字起こし（爆速化後）",
    "",
    `- 入力ファイル: ${inputPath}`,
    `- 生成時刻: ${new Date().toISOString()}`,
    "",
    "## Transcript",
    "",
    result.rawTextOriginal.trim(),
    "",
  ].join("\n");

  await writeFile(metricsMdPath, metricsMd, "utf8");
  await writeFile(metricsJsonPath, JSON.stringify(metrics, null, 2), "utf8");
  await writeFile(transcriptMdPath, transcriptMd, "utf8");

  console.log(`metrics md: ${metricsMdPath}`);
  console.log(`metrics json: ${metricsJsonPath}`);
  console.log(`transcript md: ${transcriptMdPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    stopFasterWhisperWorkers();
  });
