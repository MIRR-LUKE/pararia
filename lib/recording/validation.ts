/**
 * 録音・文字起こしのゲート（設計: docs/recording-validation-multiuser-org-design.md）
 * - ゲート A: 音声の実長が閾値未満なら STT 前に拒否
 * - ゲート B: STT / 手入力後のテキストが薄すぎるなら LLM 前に拒否
 */

import { parseBuffer } from "music-metadata";

/** 両モード共通: これ未満の録音は STT に回さない（秒） */
export const DEFAULT_MIN_RECORDING_DURATION_SEC = 60;
export const DEFAULT_MAX_INTERVIEW_DURATION_SEC = 60 * 60;
export const DEFAULT_MAX_LESSON_PART_DURATION_SEC = 10 * 60;

/** 意味のある文字数の下限（日本語想定・空白除外後） */
export const DEFAULT_MIN_SIGNIFICANT_CHARS = 35;

export type DurationGateResult =
  | { ok: true; durationSeconds: number | null; skippedReason?: "duration_parse_failed" }
  | {
      ok: false;
      code: "recording_too_short";
      durationSeconds: number | null;
      minRequiredSeconds: number;
      messageJa: string;
    }
  | {
      ok: false;
      code: "recording_too_long";
      durationSeconds: number;
      maxAllowedSeconds: number;
      messageJa: string;
    }
  | {
      ok: false;
      code: "duration_unknown";
      durationSeconds: null;
      messageJa: string;
    };

export type TranscriptSubstanceResult =
  | { ok: true }
  | {
      ok: false;
      code: "thin_transcript";
      messageJa: string;
      metrics: {
        significantChars: number;
        minRequired: number;
        uniqueRatio: number;
      };
    };

export function getRecordingMinDurationSeconds(): number {
  const n = Number(process.env.RECORDING_MIN_DURATION_SECONDS ?? DEFAULT_MIN_RECORDING_DURATION_SEC);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_RECORDING_DURATION_SEC;
}

export function getTranscriptMinSignificantChars(): number {
  const n = Number(process.env.TRANSCRIPT_MIN_SIGNIFICANT_CHARS ?? DEFAULT_MIN_SIGNIFICANT_CHARS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_SIGNIFICANT_CHARS;
}

export function getRecordingMaxDurationSeconds(sessionType: "INTERVIEW" | "LESSON_REPORT") {
  if (sessionType === "LESSON_REPORT") {
    const n = Number(process.env.MAX_LESSON_PART_DURATION_SECONDS ?? DEFAULT_MAX_LESSON_PART_DURATION_SEC);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_LESSON_PART_DURATION_SEC;
  }
  const n = Number(process.env.MAX_INTERVIEW_DURATION_SECONDS ?? DEFAULT_MAX_INTERVIEW_DURATION_SEC);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_INTERVIEW_DURATION_SEC;
}

/** true のとき、長さが取れない音声は拒否（デフォルト: 取れない場合は STT へ進む） */
export function isStrictAudioDurationRequired(): boolean {
  return process.env.RECORDING_REQUIRE_KNOWN_DURATION === "1";
}

/**
 * バッファから再生時間（秒）を取得。解析不能時は null。
 */
export async function getAudioDurationSecondsFromBuffer(buffer: Buffer): Promise<number | null> {
  try {
    const meta = await parseBuffer(buffer, undefined, { duration: true });
    const d = meta.format.duration;
    if (typeof d === "number" && Number.isFinite(d) && d >= 0) {
      return d;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * ゲート A: 録音時間
 */
export function evaluateDurationGate(
  durationSeconds: number | null,
  opts?: {
    minSeconds?: number;
    maxSeconds?: number;
    rejectUnknown?: boolean;
    tooLongMessageJa?: string;
    unknownMessageJa?: string;
  }
): DurationGateResult {
  const min = opts?.minSeconds ?? getRecordingMinDurationSeconds();
  const max = opts?.maxSeconds;
  const rejectUnknown = opts?.rejectUnknown ?? false;

  if (durationSeconds === null) {
    if (rejectUnknown || isStrictAudioDurationRequired()) {
      return {
        ok: false,
        code: "duration_unknown",
        durationSeconds: null,
        messageJa:
          opts?.unknownMessageJa ||
          "音声の長さを確認できませんでした。別形式で保存し直すか、ファイルを分割してアップロードしてください。",
      };
    }
    return { ok: true, durationSeconds: null, skippedReason: "duration_parse_failed" };
  }

  if (durationSeconds < min) {
    return {
      ok: false,
      code: "recording_too_short",
      durationSeconds,
      minRequiredSeconds: min,
      messageJa: `録音が${min}秒未満のため、ログ生成を開始できません。${min}秒以上録音するか、十分な長さの音声ファイルをアップロードしてください。`,
    };
  }

  if (typeof max === "number" && Number.isFinite(max) && durationSeconds > max) {
    return {
      ok: false,
      code: "recording_too_long",
      durationSeconds,
      maxAllowedSeconds: max,
      messageJa:
        opts?.tooLongMessageJa ||
        `録音が長すぎます。上限は${max}秒です。音声を分割するか、録音時間を短くしてください。`,
    };
  }

  return { ok: true, durationSeconds };
}

const FILLER_ONLY_REGEX = /^[うぅんんはいえーぇっッ＿・…。、．,\s0-9]+$/u;

/**
 * 空白除去・最低限の正規化後の「本文」長と多様性を見る（ゲート B）
 */
export function evaluateTranscriptSubstance(rawText: string): TranscriptSubstanceResult {
  const minChars = getTranscriptMinSignificantChars();
  const collapsed = rawText.replace(/\s+/g, "").trim();
  if (!collapsed) {
    return {
      ok: false,
      code: "thin_transcript",
      messageJa:
        "文字起こしの結果、会話として十分な内容が認められませんでした。もう一度録音するか、マイクと周囲の環境を確認してください。",
      metrics: { significantChars: 0, minRequired: minChars, uniqueRatio: 0 },
    };
  }

  if (collapsed.length < minChars) {
    return {
      ok: false,
      code: "thin_transcript",
      messageJa:
        "文字起こしの結果、会話として十分な内容が認められませんでした。もう一度録音するか、内容を補足してから保存してください。",
      metrics: {
        significantChars: collapsed.length,
        minRequired: minChars,
        uniqueRatio: uniqueCharRatio(collapsed),
      },
    };
  }

  if (FILLER_ONLY_REGEX.test(collapsed)) {
    return {
      ok: false,
      code: "thin_transcript",
      messageJa:
        "内容が「はい」「うん」などのみに見えます。もう少し具体的に話した内容を録音してください。",
      metrics: {
        significantChars: collapsed.length,
        minRequired: minChars,
        uniqueRatio: uniqueCharRatio(collapsed),
      },
    };
  }

  const ratio = uniqueCharRatio(collapsed);
  // 極端な反復（例: 同語連打）で長さだけ満たすケース
  if (collapsed.length < minChars * 2 && ratio < 0.12) {
    return {
      ok: false,
      code: "thin_transcript",
      messageJa:
        "文字起こしの結果、情報量が少ないと判断されました。録音し直すか、テキストで補足を入力してください。",
      metrics: {
        significantChars: collapsed.length,
        minRequired: minChars,
        uniqueRatio: ratio,
      },
    };
  }

  return { ok: true };
}

function uniqueCharRatio(s: string): number {
  if (!s.length) return 0;
  return new Set([...s]).size / s.length;
}
