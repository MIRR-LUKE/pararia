import { getAudioRetentionDays, getReportDeliveryEventRetentionDays, getTranscriptRetentionDays } from "@/lib/system-config";

export type DataRetentionPolicy = {
  key: string;
  label: string;
  deleteMode: "hard_delete" | "soft_delete" | "retain";
  retentionDays: number | null;
  notes: string[];
};

export const DATA_RETENTION_POLICIES: DataRetentionPolicy[] = [
  {
    key: "session_audio",
    label: "録音ファイル / live chunk / manifest",
    deleteMode: "hard_delete",
    retentionDays: getAudioRetentionDays(),
    notes: [
      "保存期間を過ぎたら runtime storage から物理削除する。",
      "削除後は SessionPart の storageUrl も消す。",
    ],
  },
  {
    key: "session_transcript",
    label: "SessionPart の文字起こし",
    deleteMode: "hard_delete",
    retentionDays: getTranscriptRetentionDays(),
    notes: [
      "保存期間を過ぎたら rawTextOriginal / rawTextCleaned / rawSegments を消す。",
      "生成済みログやレポートは残す。",
    ],
  },
  {
    key: "conversation_raw",
    label: "ConversationLog の生文字起こし",
    deleteMode: "hard_delete",
    retentionDays: getTranscriptRetentionDays(),
    notes: [
      "保存期間を過ぎたら rawTextOriginal / rawTextCleaned / rawSegments を消す。",
      "artifactJson と summaryMarkdown は正本 / 派生物として残す。",
    ],
  },
  {
    key: "conversation_artifact",
    label: "ConversationLog の structured artifact / summary",
    deleteMode: "hard_delete",
    retentionDays: null,
    notes: [
      "会話ログ削除時に削除する。",
      "保護者レポートで参照中なら source trace から外す。",
    ],
  },
  {
    key: "report",
    label: "保護者レポート本文 / 共有履歴",
    deleteMode: "hard_delete",
    retentionDays: null,
    notes: [
      "レポート本文は削除操作があるまで保持する。",
      `delivery events は ${getReportDeliveryEventRetentionDays()} 日を過ぎたら cleanup で整理する。`,
    ],
  },
  {
    key: "audit_log",
    label: "監査ログ",
    deleteMode: "retain",
    retentionDays: null,
    notes: [
      "アプリからは削除しない。",
      "操作履歴として残す。",
    ],
  },
];

export function buildRetentionPolicyMarkdown() {
  return DATA_RETENTION_POLICIES.map((policy) =>
    [
      `## ${policy.label}`,
      `- 削除方式: ${policy.deleteMode}`,
      `- 保存期間: ${policy.retentionDays ? `${policy.retentionDays}日` : "別途定義または無期限"}`,
      ...policy.notes.map((note) => `- ${note}`),
    ].join("\n")
  ).join("\n\n");
}
