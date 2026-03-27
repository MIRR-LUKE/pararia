# データ削除 / 保存期間ポリシー

このドキュメントは、PARARIA でどのデータをどう消すかを整理するためのものです。

## 基本方針

- 録音ファイルや生の文字起こしは、永続保存の前提にしない
- 画面表示やレポートに使う正本は `ConversationLog.artifactJson` とする
- `summaryMarkdown` は `artifactJson` から作る派生物として扱う
- 監査ログはアプリから削除しない

## データ種別ごとの方針

### 録音ファイル / live chunk / manifest

- 削除方式: hard delete
- 保存期間: `PARARIA_AUDIO_RETENTION_DAYS` 日
- cleanup 実行時に runtime storage から物理削除する
- cleanup は `SessionPart.storageUrl` も null にする

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
