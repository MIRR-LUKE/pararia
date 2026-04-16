type LlmApiHealthResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: "llm_api_key_invalid" | "llm_api_unavailable";
      message: string;
      detail: string;
    };

type CachedLlmApiHealth = {
  expiresAt: number;
  result: LlmApiHealthResult;
};

const SUCCESS_CACHE_MS = 30_000;
const FAILURE_CACHE_MS = 10_000;

let cachedLlmApiHealth: CachedLlmApiHealth | null = null;

function readCachedLlmApiHealth(now: number) {
  if (!cachedLlmApiHealth) return null;
  if (cachedLlmApiHealth.expiresAt <= now) {
    cachedLlmApiHealth = null;
    return null;
  }
  return cachedLlmApiHealth.result;
}

function writeCachedLlmApiHealth(result: LlmApiHealthResult, ttlMs: number, now: number) {
  cachedLlmApiHealth = {
    expiresAt: now + ttlMs,
    result,
  };
  return result;
}

function getLlmApiKey() {
  return process.env.LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
}

export async function checkLlmApiHealth(): Promise<LlmApiHealthResult> {
  const llmApiKey = getLlmApiKey();
  if (!llmApiKey) {
    return {
      ok: false,
      code: "llm_api_key_invalid",
      message: "LLM の認証情報が未設定です。OPENAI_API_KEY を設定してから、もう一度お試しください。",
      detail: "OPENAI_API_KEY is not set.",
    };
  }

  const now = Date.now();
  const cached = readCachedLlmApiHealth(now);
  if (cached) return cached;

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${llmApiKey}`,
      },
    });
    if (response.ok) {
      return writeCachedLlmApiHealth({ ok: true }, SUCCESS_CACHE_MS, now);
    }

    const raw = await response.text().catch(() => "");
    const invalid = response.status === 401 || response.status === 403 || /invalid_api_key|incorrect api key|unauthorized|authentication/i.test(raw);
    const result: LlmApiHealthResult = invalid
      ? {
          ok: false,
          code: "llm_api_key_invalid",
          message: "LLM の認証に失敗しました。OPENAI_API_KEY が無効か期限切れです。Vercel の環境変数を更新してください。",
          detail: raw || `LLM API failed (${response.status})`,
        }
      : {
          ok: false,
          code: "llm_api_unavailable",
          message: "LLM に接続できませんでした。時間をおいてから、もう一度お試しください。",
          detail: raw || `LLM API failed (${response.status})`,
        };
    return writeCachedLlmApiHealth(result, FAILURE_CACHE_MS, now);
  } catch (error: any) {
    return writeCachedLlmApiHealth(
      {
        ok: false,
        code: "llm_api_unavailable",
        message: "LLM に接続できませんでした。時間をおいてから、もう一度お試しください。",
        detail: String(error?.message ?? error ?? "unknown llm error"),
      },
      FAILURE_CACHE_MS,
      now
    );
  }
}
