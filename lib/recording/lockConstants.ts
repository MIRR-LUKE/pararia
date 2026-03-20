/** Heartbeat 推奨間隔（ms）。設計メモ: 10s */
export const RECORDING_LOCK_HEARTBEAT_MS = 10_000;

/** 最終 heartbeat からこの時間超過で失効（ms）。設計メモ: 30s */
export const RECORDING_LOCK_TTL_MS = 30_000;
