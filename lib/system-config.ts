export type SendingProvider = "resend" | "postmark" | "none";

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

export function getTranscriptRetentionDays() {
  return parsePositiveInt(process.env.PARARIA_TRANSCRIPT_RETENTION_DAYS, 30);
}

export function getAudioRetentionDays() {
  return parsePositiveInt(process.env.PARARIA_AUDIO_RETENTION_DAYS, getTranscriptRetentionDays());
}

export function buildRetentionExpiryDate(days: number, baseDate = new Date()) {
  const expiresAt = new Date(baseDate);
  expiresAt.setDate(expiresAt.getDate() + Math.floor(days));
  return expiresAt;
}

export function getTranscriptExpiryDate(baseDate = new Date()) {
  return buildRetentionExpiryDate(getTranscriptRetentionDays(), baseDate);
}

export function getAudioExpiryDate(baseDate = new Date()) {
  return buildRetentionExpiryDate(getAudioRetentionDays(), baseDate);
}

export function getReportDeliveryEventRetentionDays() {
  return parsePositiveInt(process.env.PARARIA_REPORT_DELIVERY_EVENT_RETENTION_DAYS, 365);
}

export function getSendingProvider(): SendingProvider {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.POSTMARK_SERVER_TOKEN || process.env.POSTMARK_API_TOKEN) return "postmark";
  return "none";
}

export function getSendingConfigSummary() {
  const provider = getSendingProvider();
  return {
    provider,
    manualShareEnabled: true,
    emailConfigured: provider !== "none",
    lineConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
    emailStatusLabel:
      provider === "resend"
        ? "Resend 設定済み"
        : provider === "postmark"
          ? "Postmark 設定済み"
          : "メール送信は未設定",
    lineStatusLabel: process.env.LINE_CHANNEL_ACCESS_TOKEN ? "LINE 設定済み" : "LINE は未設定",
  };
}

export function getTrustPolicySummary() {
  return {
    transcriptRetentionDays: getTranscriptRetentionDays(),
    reportDeliveryEventRetentionDays: getReportDeliveryEventRetentionDays(),
    guardianNoticeRequired: true,
    deletionRequestFlow: "要個別対応",
  };
}
