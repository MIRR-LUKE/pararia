import { getAudioRetentionDays, getReportDeliveryEventRetentionDays, getTranscriptRetentionDays } from "@/lib/system-config";
import {
  getTeacherRecordingErrorRetentionDays,
  getTeacherRecordingNoStudentRetentionDays,
  getTeacherRecordingUnconfirmedRetentionDays,
} from "@/lib/teacher-app/recording-retention-policy";

export type DataRetentionPolicy = {
  key: string;
  label: string;
  deleteMode: "hard_delete" | "soft_delete" | "retain" | "dry_run_only";
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
    key: "teacher_recording_audio",
    label: "Teacher App 録音ファイル",
    deleteMode: "dry_run_only",
    retentionDays: getAudioRetentionDays(),
    notes: [
      "TeacherRecordingSession.audioStorageUrl は uploadedAt / recordedAt / createdAt の順で古さを判定する。",
      "scripts/dry-run-data-retention-cleanup.ts は候補の件数とIDだけを出す。",
      "初期運用では削除しない。実削除は別途承認後に実装する。",
    ],
  },
  {
    key: "teacher_recording_unconfirmed",
    label: "未確定 Teacher App 録音",
    deleteMode: "dry_run_only",
    retentionDays: getTeacherRecordingUnconfirmedRetentionDays(),
    notes: [
      "RECORDING / TRANSCRIBING / AWAITING_STUDENT_CONFIRMATION のまま confirmedAt がない録音を updatedAt で判定する。",
      "初期運用では削除しない。dry-run で滞留件数とIDを確認する。",
    ],
  },
  {
    key: "teacher_recording_error",
    label: "ERROR状態 Teacher App 録音",
    deleteMode: "dry_run_only",
    retentionDays: getTeacherRecordingErrorRetentionDays(),
    notes: [
      "TeacherRecordingSession.status = ERROR の録音を updatedAt で判定する。",
      "初期運用では削除しない。原因調査後に削除可否を判断する。",
    ],
  },
  {
    key: "teacher_recording_no_student",
    label: "該当なしのまま放置された Teacher App 録音",
    deleteMode: "dry_run_only",
    retentionDays: getTeacherRecordingNoStudentRetentionDays(),
    notes: [
      "STUDENT_CONFIRMED かつ selectedStudentId / promotedSessionId / promotedConversationId がない録音を confirmedAt / updatedAt で判定する。",
      "初期運用では削除しない。dry-run で滞留件数とIDを確認する。",
    ],
  },
  {
    key: "teacher_recording_raw_transcript",
    label: "Teacher App 録音 raw transcript",
    deleteMode: "dry_run_only",
    retentionDays: getTranscriptRetentionDays(),
    notes: [
      "TeacherRecordingSession.transcriptText / transcriptSegmentsJson / transcriptMetaJson を analyzedAt / updatedAt で判定する。",
      "初期運用では削除しない。dry-run で滞留件数とIDを確認する。",
    ],
  },
  {
    key: "session_transcript",
    label: "SessionPart の文字起こし",
    deleteMode: "hard_delete",
    retentionDays: getTranscriptRetentionDays(),
    notes: [
      "保存期間を過ぎたら rawTextOriginal / rawTextCleaned / reviewedText / rawSegments を消す。",
      "proper noun suggestion も一緒に消す。",
      "生成済みログやレポートは残す。",
    ],
  },
  {
    key: "conversation_raw",
    label: "ConversationLog の生文字起こし",
    deleteMode: "hard_delete",
    retentionDays: getTranscriptRetentionDays(),
    notes: [
      "保存期間を過ぎたら rawTextOriginal / rawTextCleaned / reviewedText / rawSegments を消す。",
      "proper noun suggestion も一緒に消す。",
      "artifactJson と summaryMarkdown は正本 / 派生物として残す。",
    ],
  },
  {
    key: "conversation_artifact",
    label: "ConversationLog の structured artifact / summary",
    deleteMode: "soft_delete",
    retentionDays: null,
    notes: [
      "会話ログ削除時は deletedAt / deletedByUserId を付けて一覧から隠す。",
      "管理画面からしばらく復元できる。",
    ],
  },
  {
    key: "report",
    label: "保護者レポート本文 / 共有履歴",
    deleteMode: "soft_delete",
    retentionDays: null,
    notes: [
      "レポート削除時は deletedAt / deletedByUserId を付けて一覧から隠す。",
      "管理画面からしばらく復元できる。",
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
