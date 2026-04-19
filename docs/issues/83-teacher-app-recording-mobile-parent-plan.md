# Teacher App を録音専用 mobile app として分離する

## 状態

- Closed
- GitHub Issue: `#164`
- 最終更新: `2026-04-19`

## この issue で完了したこと

- Teacher App を `/teacher` と `/teacher/setup` に分離し、管理 web の導線と責務を切り分けた
- 校舎共通端末ログインを `TeacherAppDevice` ベースで永続化し、signed cookie / bearer token の両方で `deviceId` を検証するようにした
- provisional UI を `screen / hook / container` 境界で分け、`待機 -> 録音 -> 解析中 -> 生徒確認 -> 完了 -> 未送信一覧` を一通り通せるようにした
- 録音開始時は temporary `TeacherRecordingSession` を作り、音声 upload 後に STT と生徒候補抽出を走らせる構造にした
- 生徒確定後は正式な `Session / SessionPart` を作成または再利用し、既存の `PROMOTE_SESSION` ジョブで本ログ生成へ渡すようにした
- upload failure は IndexedDB 永続化の未送信キューへ退避し、再送と削除で復旧できるようにした

## 子 issue の整理

- `#161` / `84`: Closed
- `#160` / `85`: Closed
- `#162` / `86`: Closed
- `#163` / `87`: Closed

## 受け入れ条件に対する結果

- 先生が通常利用時にログインせず、待機画面から即録音開始できる: 達成
- 録音前に生徒一覧を開かず、録音後に候補確認だけで進められる: 達成
- 生徒確定前に本ログ生成が走らない: 達成
- 通信断 / upload failure / app 再起動後も未送信を戻せる: 達成
- provisional UI のまま内部テストに使え、後から Figma 差し替えで logic を書き直さなくて済む: 達成

## 補足

- Phase 3 に書いていた `NFC タッチ開始` や `予定連動` は、この親 issue の close 条件には含めず、必要になった時点で別 issue に切る
- `該当なし` を選んだ録音は、生徒未確定のまま保存し、管理 web 側で後続確認する

## 検証

- `npm run prisma:generate`
- `npm run typecheck`
- `npm run test:migration-safety`
- `npm run test:teacher-app-device-auth`
- `npm run test:teacher-app-student-candidates`
- `npm run test:promote-session-dispatch`
