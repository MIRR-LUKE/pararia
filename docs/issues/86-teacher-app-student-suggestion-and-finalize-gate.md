# Teacher App の生徒確認導線を作る: 候補サジェスト / 確定 / 本ログ生成トリガー

## 状態

- Closed
- GitHub Issue: `#162`
- 最終更新: `2026-04-19`

## この issue で完了したこと

- transcript から在籍生徒候補を組み立てる候補抽出ロジックを接続した
- 生徒確認画面で transcript 冒頭、候補ボタン、`該当なし` を出せるようにした
- `POST /api/teacher/recordings/[id]/confirm` で候補選択または `該当なし` を保存できるようにした
- 生徒を確定したときは、正式な `Session` を作成または再利用し、`SessionPart` を `READY` で upsert して `PROMOTE_SESSION` を enqueue するようにした
- transcript preprocess / reviewed transcript 生成 / `updateSessionStatusFromParts` を通し、既存の本ログ生成パイプラインへ接続した
- `TeacherRecordingSession` に `promotedSessionId` と `promotedConversationId` を保存し、同じ確定操作の再送を idempotent に扱えるようにした

## UX とデータの整理

- 生徒確定前に本ログ生成は走らない
- `該当なし` の場合は `Session / Conversation` を作らず、`STUDENT_CONFIRMED` のまま保存して管理 web 側へ引き継ぐ
- 候補が高信頼でも自動確定はしない

## 完了条件に対する結果

- 録音前に生徒を探させない: 達成
- 生徒確認画面で候補ボタンと `該当なし` を迷わず押せる: 達成
- 候補が弱くても自動確定しない: 達成
- 生徒確定前に本ログ生成が走らず、確定後にだけ trigger される: 達成
- 既存の `Session / Conversation / Report` 基盤を壊さない: 達成

## 検証

- `npm run typecheck`
- `npm run test:teacher-app-student-candidates`
- `npm run test:promote-session-dispatch`
