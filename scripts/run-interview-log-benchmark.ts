import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { generateConversationDraftFast } from "@/lib/ai/conversation/generate";
import { getAudioDurationSeconds } from "@/lib/audio-processing";
import { transcribeAudioForPipeline, stopLocalSttWorker } from "@/lib/ai/stt";

const DEFAULT_AUDIO_PATH =
  "C:/Users/lukew/Desktop/01-30 面談_ 受験戦略とルール運用（時間配分・見直し・難問後回し.mp3";

const BENCHMARK_META = {
  studentName: "田中 由紀子",
  teacherName: "浅見",
  sessionDate: "2026-02-20",
};

function resolveInputPath() {
  const argPath = process.argv[2]?.trim();
  return path.resolve(argPath || DEFAULT_AUDIO_PATH);
}

function safeFileBaseName(value: string) {
  return path.basename(value, path.extname(value)).replace(/[\\/:*?"<>|]/g, "_");
}

async function loadLocalEnvFiles() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), fileName);
    try {
      const raw = await readFile(filePath, "utf8");
      for (const line of raw.replace(/\r/g, "").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const key = match[1];
        if (process.env[key]) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    } catch {
      // local benchmark only; skip missing env files quietly.
    }
  }
}

function formatSeconds(value: number) {
  const sec = Number.isFinite(value) ? value : 0;
  const min = Math.floor(sec / 60);
  const remain = sec - min * 60;
  return `${min}分${remain.toFixed(1)}秒`;
}

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

async function main() {
  await loadLocalEnvFiles();
  const inputPath = resolveInputPath();
  const baseName = safeFileBaseName(inputPath);
  const outputDir = path.join(process.cwd(), "docs", "interview-benchmarks");
  await mkdir(outputDir, { recursive: true });

  const transcriptPath = path.join(outputDir, `${baseName}_生文字起こし.md`);
  const reportPath = path.join(outputDir, `${baseName}_面談ログ生成ベンチ.md`);
  const metricsPath = path.join(outputDir, `${baseName}_面談ログ生成ベンチ.json`);

  const audioDurationSeconds = await getAudioDurationSeconds(inputPath);

  const sttStartedAt = Date.now();
  const sttResult = await transcribeAudioForPipeline({
    filePath: inputPath,
    filename: path.basename(inputPath),
    mimeType: "audio/mpeg",
    language: "ja",
  });
  const sttElapsedSeconds = (Date.now() - sttStartedAt) / 1000;

  const llmStartedAt = Date.now();
  const draft = await generateConversationDraftFast({
    transcript: sttResult.rawTextOriginal,
    studentName: BENCHMARK_META.studentName,
    teacherName: BENCHMARK_META.teacherName,
    sessionDate: BENCHMARK_META.sessionDate,
    durationMinutes: Math.max(1, Math.round(audioDurationSeconds / 60)),
    minSummaryChars: 700,
    sessionType: "INTERVIEW",
  });
  const llmElapsedSeconds = (Date.now() - llmStartedAt) / 1000;
  const totalElapsedSeconds = sttElapsedSeconds + llmElapsedSeconds;

  const transcriptMd = [
    `# ${baseName} 生文字起こし`,
    "",
    `- 入力ファイル: ${inputPath}`,
    `- 音声長: ${audioDurationSeconds.toFixed(1)}秒 (${formatSeconds(audioDurationSeconds)})`,
    `- 生成時刻: ${new Date().toISOString()}`,
    "",
    "## Transcript",
    "",
    sttResult.rawTextOriginal.trim(),
    "",
  ].join("\n");

  const metrics = {
    inputPath,
    audioDurationSeconds,
    stt: {
      elapsedSeconds: sttElapsedSeconds,
      realtimeFactor: audioDurationSeconds / Math.max(sttElapsedSeconds, 0.001),
      model: sttResult.meta.model,
      responseFormat: sttResult.meta.responseFormat,
      attemptCount: sttResult.meta.attemptCount,
      segmentCount: sttResult.meta.segmentCount,
      qualityWarnings: sttResult.meta.qualityWarnings,
    },
    llm: {
      elapsedSeconds: llmElapsedSeconds,
      model: draft.model,
      apiCalls: draft.apiCalls,
      usedFallback: draft.usedFallback,
      tokenUsage: draft.tokenUsage,
      costUsd: draft.llmCostUsd,
    },
    totalElapsedSeconds,
    generatedAt: new Date().toISOString(),
  };

  const reportMd = [
    `# ${baseName} 面談ログ 生成ベンチ`,
    "",
    "## 入力",
    `- 音声ファイル: ${inputPath}`,
    `- 対象生徒: ${BENCHMARK_META.studentName} 様`,
    `- 面談日: ${BENCHMARK_META.sessionDate}`,
    `- 担当チューター: ${BENCHMARK_META.teacherName}`,
    `- 音声長: ${audioDurationSeconds.toFixed(1)}秒 (${formatSeconds(audioDurationSeconds)})`,
    "",
    "## STT 計測",
    `- 実行時間: ${sttElapsedSeconds.toFixed(1)}秒 (${formatSeconds(sttElapsedSeconds)})`,
    `- 実効速度: ${(audioDurationSeconds / Math.max(sttElapsedSeconds, 0.001)).toFixed(2)}x realtime`,
    `- モデル: ${sttResult.meta.model}`,
    `- 返却形式: ${sttResult.meta.responseFormat}`,
    `- セグメント数: ${sttResult.meta.segmentCount}`,
    `- 試行回数: ${sttResult.meta.attemptCount}`,
    `- 品質警告: ${sttResult.meta.qualityWarnings.join(", ") || "なし"}`,
    "",
    "## LLM 計測",
    `- 実行時間: ${llmElapsedSeconds.toFixed(1)}秒 (${formatSeconds(llmElapsedSeconds)})`,
    `- モデル: ${draft.model}`,
    `- API 呼び出し回数: ${draft.apiCalls}`,
    `- fallback 使用: ${draft.usedFallback ? "あり" : "なし"}`,
    `- 入力トークン: ${draft.tokenUsage.inputTokens.toLocaleString()}`,
    `- うちキャッシュ入力: ${draft.tokenUsage.cachedInputTokens.toLocaleString()}`,
    `- 出力トークン: ${draft.tokenUsage.outputTokens.toLocaleString()}`,
    `- 合計トークン: ${draft.tokenUsage.totalTokens.toLocaleString()}`,
    `- 1回あたりの LLM コスト: ${formatUsd(draft.llmCostUsd)}`,
    `- 価格根拠: OpenAI API Pricing（2026-04-05 時点） GPT-5.4 入力 $2.50 / 1M tokens, Cached input $0.25 / 1M tokens, Output $15.00 / 1M tokens`,
    "",
    "## 合計",
    `- STT + LLM 合計時間: ${totalElapsedSeconds.toFixed(1)}秒 (${formatSeconds(totalElapsedSeconds)})`,
    "",
    "## 生成された面談ログ",
    "",
    draft.summaryMarkdown.trim(),
    "",
    "## 保存先",
    `- 生文字起こし: ${transcriptPath}`,
    `- 計測 JSON: ${metricsPath}`,
    "",
  ].join("\n");

  await writeFile(transcriptPath, transcriptMd, "utf8");
  await writeFile(reportPath, reportMd, "utf8");
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2), "utf8");

  console.log(`transcript md: ${transcriptPath}`);
  console.log(`report md: ${reportPath}`);
  console.log(`metrics json: ${metricsPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    stopLocalSttWorker();
  });
