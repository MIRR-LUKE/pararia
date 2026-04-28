# データ削除 / 保存期間ポリシー

このドキュメントは、PARARIA でどのデータをどう消すかを整理するためのものです。

## 基本方針

- 録音ファイルや生の文字起こしは、永続保存の前提にしない
- 画面表示やレポートに使う正本は `ConversationLog.artifactJson` とする
- `summaryMarkdown` は `artifactJson` から作る派生物として扱う
- 監査ログはアプリから削除しない
- Teacher App 録音の整理は、初期運用では dry-run の候補確認だけを行い、デフォルトでは何も削除しない

## Teacher App 録音整理の dry-run

Issue #246 の範囲では、削除処理は作らない。`scripts/dry-run-data-retention-cleanup.ts` は、指定した `organizationId` の中だけで削除候補の件数と ID を出す確認用スクリプトとする。

```bash
npx tsx scripts/dry-run-data-retention-cleanup.ts --organization-id <orgId>
npx tsx scripts/dry-run-data-retention-cleanup.ts --organization-id <orgId> --json --limit 500
```

- `--organization-id` は必須。tenant / organization 境界をまたがって候補を混ぜない。
- 出力は rule ごとの `count` と `ids`。`--limit` を超える場合は `truncated: true` になる。
- `mode` は常に `dry-run`、`willDelete` は常に `false`。
- 実削除、storage 削除、DB 更新、録音/confirm/STT/レポート生成の挙動変更はこの段階では行わない。

### dry-run 対象ルール

| 対象 | 候補条件 | 既定期間 |
| --- | --- | --- |
| 古いTeacher録音音声 | `TeacherRecordingSession.audioStorageUrl` があり、`uploadedAt -> recordedAt -> createdAt` の順で採用した日時が `PARARIA_AUDIO_RETENTION_DAYS` 日より古い | `PARARIA_AUDIO_RETENTION_DAYS`。未設定時は `PARARIA_TRANSCRIPT_RETENTION_DAYS` と同じ |
| 古い未確定録音 | `status` が `RECORDING / TRANSCRIBING / AWAITING_STUDENT_CONFIRMATION` のいずれかで、`confirmedAt` がなく、`updatedAt` が古い | `PARARIA_TEACHER_RECORDING_UNCONFIRMED_RETENTION_DAYS`。未設定時は14日 |
| 古いERROR状態録音 | `status = ERROR` で、`updatedAt` が古い | `PARARIA_TEACHER_RECORDING_ERROR_RETENTION_DAYS`。未設定時は30日 |
| 該当なし放置録音 | `status = STUDENT_CONFIRMED`、`selectedStudentId / promotedSessionId / promotedConversationId` がすべてなく、`confirmedAt -> updatedAt` の順で採用した日時が古い | `PARARIA_TEACHER_RECORDING_NO_STUDENT_RETENTION_DAYS`。未設定時は30日 |
| 古いTeacher録音raw transcript | `TeacherRecordingSession.transcriptText / transcriptSegmentsJson / transcriptMetaJson` のいずれかがあり、`analyzedAt -> updatedAt` の順で採用した日時が古い | `PARARIA_TRANSCRIPT_RETENTION_DAYS`。未設定時は30日 |
| 古い昇格済み録音音声 | `SessionPart.storageUrl` があり、親 `Session.organizationId` が対象 organization で、`createdAt` が古い | `PARARIA_AUDIO_RETENTION_DAYS` |
| 古いSessionPart raw transcript | 親 `Session.organizationId` が対象 organization で、`transcriptExpiresAt <= now` かつ raw transcript 系カラムが残っている | `transcriptExpiresAt` |
| 古いConversationLog raw transcript | `ConversationLog.organizationId` が対象 organization で、`rawTextExpiresAt <= now` かつ raw transcript 系カラムが残っている | `rawTextExpiresAt` |

同じ録音 ID が複数ルールに出ることはあり得る。たとえば古い `ERROR` 録音が音声も transcript も保持している場合、調査しやすいように rule ごとに別カウントで表示する。

## データ種別ごとの方針

### 録音ファイル / live chunk / manifest

- 削除方式: hard delete
- 保存期間: `PARARIA_AUDIO_RETENTION_DAYS` 日
- cleanup 実行時に runtime storage から物理削除する
- cleanup は `SessionPart.storageUrl` も null にする

### Teacher App 録音ファイル / 未確定録音 / 該当なし録音

- 削除方式: dry-run only
- 保存期間: 上記 dry-run 対象ルールを参照
- 初期運用では `TeacherRecordingSession` を削除しない
- dry-run の結果を見て、削除 SLA、監査ログ、storage 削除順序を別途決める
- tenant / organization 境界は `organizationId` 指定で固定し、他 organization の ID を同じ出力に混ぜない

### Teacher App 録音 raw transcript

- 削除方式: dry-run only
- 保存期間: `PARARIA_TRANSCRIPT_RETENTION_DAYS` 日
- 初期運用では `TeacherRecordingSession.transcriptText / transcriptSegmentsJson / transcriptMetaJson` を削除しない
- dry-run で対象 ID を確認し、実削除は別途承認後に実装する

### SessionPart の文字起こし

- 削除方式: hard delete
- 保存期間: `PARARIA_TRANSCRIPT_RETENTION_DAYS` 日
- cleanup 実行時に `rawTextOriginal / rawTextCleaned / reviewedText / rawSegments` を削除する
- proper noun suggestion も一緒に削除する

### ConversationLog の生文字起こし

- 削除方式: hard delete
- 保存期間: `PARARIA_TRANSCRIPT_RETENTION_DAYS` 日
- cleanup 実行時に `rawTextOriginal / rawTextCleaned / reviewedText / rawSegments` を削除する
- proper noun suggestion も一緒に削除する
- artifact と要約本文は残す

### 会話ログの structured artifact / 要約本文

- 削除方式: hard delete
- 保存期間: 個別削除まで保持
- 会話ログ削除時に削除する
- 保護者レポート参照中なら source trace から外す

### 保護者レポート本文 / 共有履歴

- 削除方式: hard delete
- 保存期間: 個別削除まで保持
- レポート削除時に delivery event と一緒に削除する
- `ReportDeliveryEvent` 単体は `PARARIA_REPORT_DELIVERY_EVENT_RETENTION_DAYS` 日を過ぎたら cleanup 対象

### 監査ログ

- 削除方式: retain
- 保存期間: 運用ポリシーで別管理
- アプリ画面や通常 API からは削除しない
