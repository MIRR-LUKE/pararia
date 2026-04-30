import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { generateConversationDraftFast } from "@/lib/ai/conversation/generate";
import { getAudioDurationSeconds } from "@/lib/audio-processing";
import { transcribeAudioForPipeline, stopFasterWhisperWorkers } from "@/lib/ai/stt";
import { getOpenAiCostUsdJpyRate } from "@/lib/ai/openai-pricing";

const DEFAULT_AUDIO_PATH =
  "C:/Users/lukew/Desktop/01-30 面談_ 受験戦略とルール運用（時間配分・見直し・難問後回し.mp3";

const BENCHMARK_META = {
  studentName: "田中 由紀子",
  teacherName: "浅見",
  sessionDate: "2026-02-20",
};

const BENCHMARK_META_VARIANT = {
  studentName: "田中 由紀子（再計測）",
  teacherName: "浅見",
  sessionDate: "2026-02-27",
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

function formatJpy(value: number) {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

async function runDraftBenchmark(
  transcript: string,
  audioDurationSeconds: number,
  options?: {
    promptCacheNamespace?: string | null;
    promptCacheRetention?: "in_memory" | "24h" | null;
    metaOverride?: Partial<typeof BENCHMARK_META>;
  }
) {
  const meta = {
    ...BENCHMARK_META,
    ...(options?.metaOverride ?? {}),
  };
  const llmStartedAt = Date.now();
  const draft = await generateConversationDraftFast({
    transcript,
    studentName: meta.studentName,
    teacherName: meta.teacherName,
    sessionDate: meta.sessionDate,
    durationMinutes: Math.max(1, Math.round(audioDurationSeconds / 60)),
    minSummaryChars: 700,
    sessionType: "INTERVIEW",
    promptCacheNamespace: options?.promptCacheNamespace,
    promptCacheRetention: options?.promptCacheRetention,
  });
  const llmElapsedSeconds = (Date.now() - llmStartedAt) / 1000;
  return { draft, llmElapsedSeconds };
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

  const promptCacheNamespace = `interview-benchmark-${randomUUID()}`;
  const coldRun = await runDraftBenchmark(sttResult.rawTextOriginal, audioDurationSeconds, {
    promptCacheNamespace,
    promptCacheRetention: "24h",
  });
  const warmRun = await runDraftBenchmark(sttResult.rawTextOriginal, audioDurationSeconds, {
    promptCacheNamespace,
    promptCacheRetention: "24h",
  });
  const metadataVariantRun = await runDraftBenchmark(sttResult.rawTextOriginal, audioDurationSeconds, {
    promptCacheNamespace,
    promptCacheRetention: "24h",
    metaOverride: BENCHMARK_META_VARIANT,
  });
  const draft = warmRun.draft;
  const totalElapsedSecondsCold = sttElapsedSeconds + coldRun.llmElapsedSeconds;
  const totalElapsedSecondsWarm = sttElapsedSeconds + warmRun.llmElapsedSeconds;
  const totalElapsedSecondsMetadataVariant = sttElapsedSeconds + metadataVariantRun.llmElapsedSeconds;
  const coldCachedRatio =
    coldRun.draft.tokenUsage.inputTokens > 0
      ? coldRun.draft.tokenUsage.cachedInputTokens / coldRun.draft.tokenUsage.inputTokens
      : 0;
  const warmCachedRatio =
    warmRun.draft.tokenUsage.inputTokens > 0
      ? warmRun.draft.tokenUsage.cachedInputTokens / warmRun.draft.tokenUsage.inputTokens
      : 0;
  const metadataVariantCachedRatio =
    metadataVariantRun.draft.tokenUsage.inputTokens > 0
      ? metadataVariantRun.draft.tokenUsage.cachedInputTokens / metadataVariantRun.draft.tokenUsage.inputTokens
      : 0;
  const stablePrefixChars = draft.promptCacheStablePrefixChars ?? 0;
  const stablePrefixTokensEstimate = draft.promptCacheStablePrefixTokensEstimate ?? 0;
  const usdJpyRate = getOpenAiCostUsdJpyRate();

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
      model: draft.model,
      promptCache: {
        key: draft.promptCacheKey ?? null,
        retention: draft.promptCacheRetention ?? null,
        stablePrefixChars,
        stablePrefixTokensEstimate,
      },
      cold: {
        elapsedSeconds: coldRun.llmElapsedSeconds,
        apiCalls: coldRun.draft.apiCalls,
        usedFallback: coldRun.draft.usedFallback,
        tokenUsage: coldRun.draft.tokenUsage,
        costUsd: coldRun.draft.llmCostUsd,
        costJpy: coldRun.draft.llmCostJpy,
        cachedInputRatio: coldCachedRatio,
      },
      warm: {
        elapsedSeconds: warmRun.llmElapsedSeconds,
        apiCalls: warmRun.draft.apiCalls,
        usedFallback: warmRun.draft.usedFallback,
        tokenUsage: warmRun.draft.tokenUsage,
        costUsd: warmRun.draft.llmCostUsd,
        costJpy: warmRun.draft.llmCostJpy,
        cachedInputRatio: warmCachedRatio,
      },
      metadataVariant: {
        elapsedSeconds: metadataVariantRun.llmElapsedSeconds,
        apiCalls: metadataVariantRun.draft.apiCalls,
        usedFallback: metadataVariantRun.draft.usedFallback,
        tokenUsage: metadataVariantRun.draft.tokenUsage,
        costUsd: metadataVariantRun.draft.llmCostUsd,
        costJpy: metadataVariantRun.draft.llmCostJpy,
        cachedInputRatio: metadataVariantCachedRatio,
        meta: BENCHMARK_META_VARIANT,
      },
      externalApiCostUsdCold: coldRun.draft.llmCostUsd,
      externalApiCostUsdWarm: warmRun.draft.llmCostUsd,
      externalApiCostUsdMetadataVariant: metadataVariantRun.draft.llmCostUsd,
      externalApiCostJpyCold: coldRun.draft.llmCostJpy,
      externalApiCostJpyWarm: warmRun.draft.llmCostJpy,
      externalApiCostJpyMetadataVariant: metadataVariantRun.draft.llmCostJpy,
      localSttApiCostUsd: 0,
      localSttApiCostJpy: 0,
      usdJpyRate,
    },
    totals: {
      coldElapsedSeconds: totalElapsedSecondsCold,
      warmElapsedSeconds: totalElapsedSecondsWarm,
      metadataVariantElapsedSeconds: totalElapsedSecondsMetadataVariant,
      externalApiCostUsdCold: coldRun.draft.llmCostUsd,
      externalApiCostUsdWarm: warmRun.draft.llmCostUsd,
      externalApiCostUsdMetadataVariant: metadataVariantRun.draft.llmCostUsd,
      externalApiCostJpyCold: coldRun.draft.llmCostJpy,
      externalApiCostJpyWarm: warmRun.draft.llmCostJpy,
      externalApiCostJpyMetadataVariant: metadataVariantRun.draft.llmCostJpy,
      sttApiCostUsd: 0,
      sttApiCostJpy: 0,
      usdJpyRate,
    },
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
    `- モデル: ${draft.model}`,
    `- prompt cache key: ${draft.promptCacheKey ?? "なし"}`,
    `- prompt cache retention: ${draft.promptCacheRetention ?? "なし"}`,
    `- cache-stable prefix 推定長: ${stablePrefixTokensEstimate.toLocaleString()} tokens / ${stablePrefixChars.toLocaleString()} chars`,
    "",
    "### 初回（cold）",
    `- 実行時間: ${coldRun.llmElapsedSeconds.toFixed(1)}秒 (${formatSeconds(coldRun.llmElapsedSeconds)})`,
    `- API 呼び出し回数: ${coldRun.draft.apiCalls}`,
    `- fallback 使用: ${coldRun.draft.usedFallback ? "あり" : "なし"}`,
    `- 入力トークン: ${coldRun.draft.tokenUsage.inputTokens.toLocaleString()}`,
    `- うちキャッシュ入力: ${coldRun.draft.tokenUsage.cachedInputTokens.toLocaleString()} (${formatPercent(coldCachedRatio)})`,
    `- 出力トークン: ${coldRun.draft.tokenUsage.outputTokens.toLocaleString()}`,
    `- 合計トークン: ${coldRun.draft.tokenUsage.totalTokens.toLocaleString()}`,
    `- 1回あたりの LLM コスト: ${formatUsd(coldRun.draft.llmCostUsd)}`,
    `- 1回あたりの LLM コスト（JPY）: ${formatJpy(coldRun.draft.llmCostJpy)}（${usdJpyRate}円/USD）`,
    "",
    "### 2回目（warm）",
    `- 実行時間: ${warmRun.llmElapsedSeconds.toFixed(1)}秒 (${formatSeconds(warmRun.llmElapsedSeconds)})`,
    `- API 呼び出し回数: ${warmRun.draft.apiCalls}`,
    `- fallback 使用: ${warmRun.draft.usedFallback ? "あり" : "なし"}`,
    `- 入力トークン: ${warmRun.draft.tokenUsage.inputTokens.toLocaleString()}`,
    `- うちキャッシュ入力: ${warmRun.draft.tokenUsage.cachedInputTokens.toLocaleString()} (${formatPercent(warmCachedRatio)})`,
    `- 出力トークン: ${warmRun.draft.tokenUsage.outputTokens.toLocaleString()}`,
    `- 合計トークン: ${warmRun.draft.tokenUsage.totalTokens.toLocaleString()}`,
    `- 1回あたりの LLM コスト: ${formatUsd(warmRun.draft.llmCostUsd)}`,
    `- 1回あたりの LLM コスト（JPY）: ${formatJpy(warmRun.draft.llmCostJpy)}（${usdJpyRate}円/USD）`,
    `- 価格根拠: OpenAI API Pricing（2026-04-30 時点） GPT-5.5 入力 $5.00 / 1M tokens, Cached input $0.50 / 1M tokens, Output $30.00 / 1M tokens`,
    "",
    "### 3回目（warm, metadata variant）",
    `- 変更したメタデータ: 生徒=${BENCHMARK_META_VARIANT.studentName}, 面談日=${BENCHMARK_META_VARIANT.sessionDate}`,
    `- 実行時間: ${metadataVariantRun.llmElapsedSeconds.toFixed(1)}秒 (${formatSeconds(metadataVariantRun.llmElapsedSeconds)})`,
    `- API 呼び出し回数: ${metadataVariantRun.draft.apiCalls}`,
    `- fallback 使用: ${metadataVariantRun.draft.usedFallback ? "あり" : "なし"}`,
    `- 入力トークン: ${metadataVariantRun.draft.tokenUsage.inputTokens.toLocaleString()}`,
    `- うちキャッシュ入力: ${metadataVariantRun.draft.tokenUsage.cachedInputTokens.toLocaleString()} (${formatPercent(metadataVariantCachedRatio)})`,
    `- 出力トークン: ${metadataVariantRun.draft.tokenUsage.outputTokens.toLocaleString()}`,
    `- 合計トークン: ${metadataVariantRun.draft.tokenUsage.totalTokens.toLocaleString()}`,
    `- 1回あたりの LLM コスト: ${formatUsd(metadataVariantRun.draft.llmCostUsd)}`,
    `- 1回あたりの LLM コスト（JPY）: ${formatJpy(metadataVariantRun.draft.llmCostJpy)}（${usdJpyRate}円/USD）`,
    "",
    "## 合計",
    `- STT の外部 API コスト: ${formatUsd(0)}`,
    `- 初回（cold）の外部 API コスト合計: ${formatUsd(coldRun.draft.llmCostUsd)}`,
    `- 2回目（warm）の外部 API コスト合計: ${formatUsd(warmRun.draft.llmCostUsd)}`,
    `- 3回目（warm, metadata variant）の外部 API コスト合計: ${formatUsd(metadataVariantRun.draft.llmCostUsd)}`,
    `- STT の外部 API コスト（JPY）: ${formatJpy(0)}`,
    `- 初回（cold）の外部 API コスト合計（JPY）: ${formatJpy(coldRun.draft.llmCostJpy)}`,
    `- 2回目（warm）の外部 API コスト合計（JPY）: ${formatJpy(warmRun.draft.llmCostJpy)}`,
    `- 3回目（warm, metadata variant）の外部 API コスト合計（JPY）: ${formatJpy(metadataVariantRun.draft.llmCostJpy)}`,
    `- STT + LLM 合計時間（cold）: ${totalElapsedSecondsCold.toFixed(1)}秒 (${formatSeconds(totalElapsedSecondsCold)})`,
    `- STT + LLM 合計時間（warm）: ${totalElapsedSecondsWarm.toFixed(1)}秒 (${formatSeconds(totalElapsedSecondsWarm)})`,
    `- STT + LLM 合計時間（warm, metadata variant）: ${totalElapsedSecondsMetadataVariant.toFixed(1)}秒 (${formatSeconds(totalElapsedSecondsMetadataVariant)})`,
    "- メモ: STT は faster-whisper の GPU worker 実行なので外部 API 課金は 0。インフラ費用はこのベンチには含めない。",
    "- メモ: cold はその cache namespace で最初の 1 回、warm は直後に同じ条件でもう 1 回、metadata variant は生徒名と面談日だけ変えてもう 1 回流した結果。",
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
    stopFasterWhisperWorkers();
  });
