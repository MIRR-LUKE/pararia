// 環境変数は実行時に読み込む（モジュール読み込み時ではなく）
// Next.jsのAPI Routesでは process.env が自動的に .env.local から読み込まれる

type TranscribeInput = {
  buffer: Buffer;
  filename?: string;
  mimeType?: string;
  language?: string; // e.g. "ja"
};

const STT_MODEL = process.env.STT_MODEL || "whisper-1";

export type WhisperVerboseSegment = {
  id?: number;
  seek?: number;
  start?: number;
  end?: number;
  text?: string;
};

export type WhisperVerboseResult = {
  rawTextOriginal: string;
  segments: WhisperVerboseSegment[];
};

export async function transcribeAudio({
  buffer,
  filename = "audio.webm",
  mimeType = "audio/webm",
  language = "ja",
}: TranscribeInput): Promise<string> {
  // 環境変数を再読み込み（開発時のホットリロード対応）
  const apiKey = process.env.OPENAI_API_KEY || process.env.STT_API_KEY || "";
  
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY (or STT_API_KEY) is not set. STT is required (no mock).");
  }

  console.log("[transcribeAudio] Starting Whisper API call...", {
    filename,
    mimeType,
    language,
    bufferSize: buffer.length,
    apiKeyPrefix: apiKey.substring(0, 10) + "...",
    apiKeyLength: apiKey.length,
  });

  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType || "application/octet-stream" });
  form.append("file", blob, filename);
  form.append("model", STT_MODEL);
  form.append("language", language);

  try {
    // Whisper APIはタイムアウトが長い可能性があるため、タイムアウトを設定
    // 音声ファイルのサイズに応じてタイムアウトを調整（1MBあたり30秒、最低2分、最大10分）
    const fileSizeMB = buffer.length / (1024 * 1024);
    const timeoutMs = Math.min(Math.max(120000, fileSizeMB * 30000), 600000);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    console.log("[transcribeAudio] Whisper API call with timeout:", {
      fileSizeMB: fileSizeMB.toFixed(2),
      timeoutMs,
      timeoutMinutes: (timeoutMs / 60000).toFixed(1),
    });
    
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let errorDetail: any;
      try {
        errorDetail = text ? JSON.parse(text) : { error: res.statusText };
      } catch {
        errorDetail = { error: text || res.statusText };
      }
      console.error("[transcribeAudio] Whisper API error:", {
        status: res.status,
        statusText: res.statusText,
        error: errorDetail,
      });
      throw new Error(`STT failed (${res.status}): ${JSON.stringify(errorDetail)}`);
    }

    const data = (await res.json()) as { text?: string };
    const transcript = (data.text ?? "").trim();
    
    if (!transcript) {
      console.error("[transcribeAudio] Whisper API returned empty transcript");
      throw new Error("STT returned empty transcript");
    }

    console.log("[transcribeAudio] Whisper API success:", {
      transcriptLength: transcript.length,
      preview: transcript.substring(0, 100) + (transcript.length > 100 ? "..." : ""),
    });

    return transcript;
  } catch (error: any) {
    console.error("[transcribeAudio] Exception during Whisper API call:", {
      error: error?.message,
      name: error?.name,
      stack: error?.stack,
    });
    
    // タイムアウトエラーの場合、より分かりやすいメッセージを返す
    if (error?.name === "AbortError") {
      throw new Error("Whisper APIの処理がタイムアウトしました。音声ファイルが大きすぎる可能性があります。");
    }
    
    throw error;
  }
}

export async function transcribeAudioVerbose({
  buffer,
  filename = "audio.webm",
  mimeType = "audio/webm",
  language = "ja",
}: TranscribeInput): Promise<WhisperVerboseResult> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.STT_API_KEY || "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY (or STT_API_KEY) is not set. STT is required (no mock).");
  }

  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType || "application/octet-stream" });
  form.append("file", blob, filename);
  form.append("model", STT_MODEL);
  form.append("language", language);
  form.append("response_format", "verbose_json");

  // timeout: keep consistent with transcribeAudio
  const fileSizeMB = buffer.length / (1024 * 1024);
  const timeoutMs = Math.min(Math.max(120000, fileSizeMB * 30000), 600000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let errorDetail: any;
      try {
        errorDetail = text ? JSON.parse(text) : { error: res.statusText };
      } catch {
        errorDetail = { error: text || res.statusText };
      }
      console.error("[transcribeAudioVerbose] Whisper API error:", {
        status: res.status,
        statusText: res.statusText,
        error: errorDetail,
      });
      throw new Error(`STT failed (${res.status}): ${JSON.stringify(errorDetail)}`);
    }

    const data = (await res.json()) as { text?: string; segments?: WhisperVerboseSegment[] };
    const rawTextOriginal = (data.text ?? "").trim();
    const segments = Array.isArray(data.segments) ? data.segments : [];
    if (!rawTextOriginal) {
      console.error("[transcribeAudioVerbose] Whisper returned empty transcript");
      throw new Error("STT returned empty transcript");
    }
    return { rawTextOriginal, segments };
  } catch (error: any) {
    console.error("[transcribeAudioVerbose] Exception during Whisper API call:", {
      error: error?.message,
      name: error?.name,
      stack: error?.stack,
    });
    if (error?.name === "AbortError") {
      throw new Error("Whisper APIの処理がタイムアウトしました。音声ファイルが大きすぎる可能性があります。");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
