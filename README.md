# PARARIA SaaS

PARARIA は、塾・個別指導・学習コーチング向けの `Teaching OS` です。  
現在の実装は、**録音や会話メモから `面談ログ` または `指導報告ログ` を 1 本生成し、その保存済みログを選んで `保護者レポート` を作る** ことに絞っています。

この README は、**2026-04-19 時点の現行コードと一致する運用仕様書** です。

## 0. いまの読み方

この SaaS の正本は、次の順で見ます。

1. **生徒データ**
   - `Student` は生徒本人の基本情報だけを持つ
   - 削除は hard delete ではなく archive
   - 通常一覧・詳細は `archivedAt IS NULL` の生徒だけを見る
   - アーカイブ時は `StudentArchiveSnapshot` に戻すための情報を残す
2. **録音・音声**
   - browser から受けた音声は、local mode では runtime dir、production 相当では Vercel Blob に置く
   - web は「受け付け」と「job 登録」までをすぐ返す
   - 重い STT は Runpod worker が同じ DB と Blob を見て進める
3. **面談ログ / 指導報告ログ**
   - 正本は `ConversationLog.artifactJson`
   - `summaryMarkdown` は画面表示用の派生物
   - transcript は `rawTextOriginal` を壊さず、確認済み文面は `reviewedText` に分ける
4. **保護者レポート**
   - 選択したログだけを材料にする
   - 未選択ログ、前回レポート、プロフィール snapshot は本文生成に混ぜない
   - 文体は、保護者宛ての自然な月次報告として、宛名、講師自己紹介、今月の様子、具体的な話題、成長、来月への見立て、署名まで固定する
5. **保全**
   - DB は Supabase(Postgres)
   - 音声 runtime は Vercel Blob
   - DB backup だけでは足りないため、DB dump と Blob backup を両方取る
   - production / shared DB へ `prisma migrate dev` は打たない

## 0.1 2026-04-18 の安定化

今回の速度・安定性の見直しで、次を入れています。

- 生徒一覧は、初回表示と通常の `GET /api/students` で `getCachedStudentDirectoryView()` を使う
- 録音ロックを含めてほしい API 呼び出しだけは、生の取得を使って鮮度を優先する
- 生徒詳細は最初に `scope: "summary"` で軽く開き、画面が見えているときだけ既存の `useStudentDetailRefresh()` が `full` を静かに取り直す
- session progress の polling は、表示中は 1秒台を維持し、処理中の見た目を止めない
- タブが非表示のときだけ polling を 5秒、10秒、15秒へ落とす
- worker を起こす `POST /api/sessions/[id]/progress` は初回と stalled な `RECEIVED` の再始動だけに絞り、通常監視は `GET` の read-only polling に寄せる
- session promotion が終わったら、その場で app 側の conversation job を起動し、次の poll を待たずに面談ログ生成へ進める
- 手入力 transcript は保存 API が promotion 開始まで責任を持ち、`POST /api/sessions/[id]/progress` の追加キックに依存しない
- 独自 RUM は既定で送らない。送るときだけ `NEXT_PUBLIC_PARARIA_RUM_ENABLED=1` を立てる
- RUM の送信量は `NEXT_PUBLIC_PARARIA_RUM_SAMPLE_RATE` で間引ける
- RUM のサーバーログは既定で書かない。必要なときだけ `PARARIA_RUM_LOG_ENABLED=1` を立てる
- `prisma:migrate` は先に local DB か確認し、remote / production っぽい URL なら止める
- 本番や共有DBの schema 変更は `npm run prisma:migrate:deploy` だけを使う

## 0.2 毎回の安全確認

開発中の最低確認:

```bash
npm run typecheck
npm run scan:secrets
npm run test:migration-safety
npm run build
```

まとめて確認する場合:

```bash
npm run verify
```

`verify` には、面談ログと保護者レポートの回帰をまとめて見る `npm run test:generation-preservation` を入れてあります。
この中で、`artifact` の意味崩れ、再生成開始時の既存ログ消去、finalize 後の副作用巻き込み、保護者レポートの artifact 必須、session progress からの重い同期実行の逆戻りをまとめて確認します。
さらに、`artifactJson / summaryMarkdown / formattedTranscript` を本番コードの別ルートから勝手に書き換えないよう、`npm run test:conversation-generation-boundary` を同じ保全ゲートへ入れています。
認証が必要な重い smoke は別に切り、普段の確認では安全側の回帰を先に落とせるようにしています。

今回の変更で特に見るテスト:

```bash
npm run test:migration-safety
npm run test:generation-preservation
npm run test:session-progress-polling
npm run test:session-part-ingest-dispatch
npm run test:promote-session-dispatch
npm run test:conversation-app-dispatch
npm run test:session-progress-worker-wake
npm run test:runpod-queue-ownership
npm run test:rum-route
npm run test:student-directory-route
npm run test:student-room-route
```

`test:student-directory-route` と `test:student-room-route` は fixture を作るため、local app + local DB 以外では安全ガードで止まります。production や共有DBに無理やり流しません。

## Engineering

- コード品質と性能の基準は [docs/engineering-rules.md](./docs/engineering-rules.md)
- DB / Blob の保全・復旧手順は [docs/db-backup-recovery.md](./docs/db-backup-recovery.md)
- protected critical path は `録音ロック -> session part ingest -> session progress -> student room -> next meeting memo` として扱い、回帰確認は `npm run test:critical-path-smoke`
- backend / perf 系ブランチは UI を触らない前提で進め、guard の自己確認は `npm run test:backend-scope-guard`
- Node の正本は `.nvmrc` と `package.json` の `engines.node` の `22`
- tracked ファイルに秘密値が混ざっていないかは `npm run scan:secrets` で見る
- mutating fixture を使う smoke / UI script は local app + local DB でしか動かさない。remote で明示的に許可するときだけ `PARARIA_ALLOW_REMOTE_FIXTURES=1`
- 面談ログ / 保護者レポートを remote で実動確認する `npm run test:remote-generation-smoke -- --base-url https://pararia.vercel.app` は、明示的に `PARARIA_ALLOW_REMOTE_GENERATION_SMOKE=1` を付けたときだけ動く
- production / shared tenant の整合性確認は read-only の `npm run test:student-integrity-audit -- --base-url https://pararia.vercel.app`
- 公開 RUM API は本文上限と軽い回数制限をかけ、検索文字列をログに残さない。RUM 送信もサーバーログも既定ではオフ
- 生徒 / 会話 / 設定 / レポート送信 / 招待 / 復元系の書き込み API は軽い回数制限を通す
- 招待 URL は公開 URL から組み立て、平文 token は API 応答に残さない
- `jobs/run` と `maintenance/cleanup` の定期実行は Vercel cron に頼らず、GitHub Actions から `POST` で叩く
- shape guard は `npm run check:code-shape`
- 最低限の確認は `npm run typecheck && npm run scan:secrets && npm run test:migration-safety && npm run build`

## Teacher App

- 先生向けの録音専用導線は、管理 web の `/app/*` とは分けて `/teacher` に載せる
- 初回の校舎共通端末設定は `/teacher/setup` で行い、通常利用時は待機画面から始める
- `/teacher` で `待機 -> 録音 -> 解析中 -> 生徒確認 -> 完了 -> 未送信一覧` の provisional flow が通る
- 録音開始時に `TeacherRecordingSession` を作り、録音停止後は音声 upload と `TeacherRecordingJob` で STT と候補抽出を進める
- `TRANSCRIBING` / `AWAITING_STUDENT_CONFIRMATION` の途中で再読み込みしても、同じ登録端末の active recording を復元して続きから戻れる
- 生徒を確定すると、正式な `Session` と `SessionPart` を作成または再利用し、既存の `PROMOTE_SESSION` 導線で本ログ生成へ渡す
- `該当なし` を選んだ録音は、生徒未確定のまま `STUDENT_CONFIRMED` として保存し、管理 web 側で後続確認できる
- upload failure は IndexedDB 永続化の未送信キューへ退避し、未送信一覧から `再送 / 削除` を選べる
- `/api/teacher/recordings/[id]/audio` は `Idempotency-Key` を受け取り、同一録音の二重送信を抑止する
- Teacher App の端末認証は `TeacherAppDevice` で永続化し、signed cookie / bearer token の両方で `deviceId` を検証する
- 録音 app の本命方針は `完全ネイティブ` で、`/teacher` は flow 検証と backend 契約確認のための web 導線として残す
- 管理画面、レポート確認、設定、監査は引き続き web のまま運用する
- native app 用の auth / recording 契約は [docs/teacher-app-native-auth-contract.md](./docs/teacher-app-native-auth-contract.md) を正本にする
- 親 issue は `#164`、子 issue は `#161`, `#160`, `#162`, `#163`
- 詳細な仕様と進捗メモは [docs/issues/83-teacher-app-recording-mobile-parent-plan.md](./docs/issues/83-teacher-app-recording-mobile-parent-plan.md) から辿る

## 1. 先に結論

- 主導線は `Student Room`
- 録音モードは `INTERVIEW` と `LESSON_REPORT` の 2 つ
- 会話ログの正本は `ConversationLog.artifactJson`
- transcript は `raw / reviewed / display` の役割を分ける
- ログ生成は `reviewedText` があればそれを優先し、なければ raw transcript を使う
- ログ生成の主経路は `structured artifact` を 1 回で作ること
- `summaryMarkdown` は artifact から render する派生物
- 生成後のログ本文は講師が手で編集できるが、自動保存はしない。手動保存前に離脱しようとした場合は pop-up で止める
- 面談ログが完成したら、その内容から `次回の面談メモ` を別 job で作る
- retry と deterministic recovery は最後の保険で、fallback 前提の設計にはしない
- `reviewState` が transcript review の現在状態を表す正本
- `qualityMetaJson.transcriptReview` は review が必要な理由と件数の説明だけを持つ
- STT は OpenAI 音声 API を使わず、Runpod 上の `faster-whisper` worker を正本にする
- ローカル web / 本番 web のどちらでも、web 側は enqueue と進捗監視を担当し、Runpod worker は STT 専用で使う
- その構成では通常 upload と live chunk を `Vercel Blob` に置き、web と Runpod worker の両方から読めるようにする
- 固有名詞辞書の `sendToProvider` は将来の外部 STT 切り替え用に残しているが、現行の faster-whisper worker では使わない
- `summaryMarkdown` は画面表示や互換用に保存する派生物
- ログ生成は `ConversationJob.FINALIZE` を中心に動き、失敗時は retry / stale recovery を持つ
- 自動の後段 polish は **ない**
- `保護者レポート` は **選択したログだけ** を使い、`artifactJson` を優先して `summaryMarkdown` で補う
- 未選択ログ、前回レポート、プロフィール snapshot はレポート本文生成に入れない
- faithfulness の代表テストは GitHub Actions の `Conversation Quality` でも回す

## 2. 非交渉の設計原則

### 2.1 Log Only

- 面談モードの成果物は `面談ログ`
- 指導報告モードの成果物は `指導報告ログ`
- どちらも正本は `artifactJson`
- transcript の正本は `rawTextOriginal`
- `reviewedText` は固有名詞候補を反映した確認用 transcript
- `rawTextCleaned` は後方互換のために残している legacy の display / preview transcript
- `preprocessTranscript()` は `displayTranscript` を返し、保存時だけ legacy カラム `rawTextCleaned` に入れる
- `summaryMarkdown` は `artifactJson` から render した表示用の派生物
- 補助表示として `formattedTranscript` または raw transcript を持つ
- 旧 `timeline / nextActions / parentPack / profileDelta` を別成果物として増やす構成はやめ、必要な情報は `artifactJson` に集約する
- `generate.ts` は JSON で artifact を先に返させ、markdown は後から render する
- deterministic recovery は「JSON が壊れた」「出力が弱すぎる」ときの最後の救済だけにする

### 2.2 Single Finalize Pass

- ログ本文は `FINALIZE` 1 回で `DONE` にする
- 後段の追加仕上げ job や段階的 finalize は使わない
- `FORMAT` は transcript 表示が必要なときだけ追加する
- 生成途中の「下書き公開 + 裏で最終調整」はしない

### 2.3 Selected Artifact First

- 保護者レポートに入れる材料は選択済みログだけ
- 正本としては各ログの `artifactJson` を使う
- `summaryMarkdown` は文脈確認用の派生物として補助的に使う
- 未選択ログは本文生成に使わない
- 前回レポートの本文は入れない
- 生徒プロフィール snapshot は入れない
- 候補ログ全件の自動束ねはしない

### 2.4 Duration Enforcement On Both Sides

- 面談は `60 分` まで
- 指導報告は `CHECK_IN / CHECK_OUT` の各 part が `10 分` まで
- client 側でも止める
- server 側でも reject する

## 3. 体験の主導線

1. 講師が `Student Room` を開く
2. `面談` か `指導報告` を選ぶ
3. 録音するか、音声ファイルを取り込む
4. 保存 API は **受付だけ即時返す**
5. 裏側で STT と session promotion を進める
6. session が揃ったら、Runpod を止めたあと app 側で `FINALIZE` を走らせ、ログ本文を 1 本生成する
7. 講師は `ログ本文` と `文字起こし` を確認し、必要ならログ本文だけ手で直して保存する
8. 面談モードなら、ログ保存後に `次回の面談メモ` を軽い background job で作る
9. 必要なログだけを選び、保護者レポートを作る
10. 共有状態を更新する

## 4. 画面の役割

### 4.1 `/app/dashboard`

- 今日優先して動くべき生徒を見る
- `面談を始める` / `授業を始める` に入る
- 面談未実施、チェックアウト待ち、レポート未作成、共有待ちを確認する

### 4.2 `/app/students`

- 生徒検索
- 生徒追加
- 一覧のまま、その場で生徒情報を編集して保存できる
- アーカイブは押した直後に一覧から外し、失敗したときだけ元に戻す
- Student Room へ移動

### 4.3 `/app/students/[studentId]`

主作業面。

- `StudentSessionConsole`
  - `INTERVIEW`
  - `LESSON_REPORT`
  - `CHECK_IN / CHECK_OUT`
  - 録音開始
  - 音声ファイル取り込み（`.mp3` / `.m4a` のみ）
- `次回の面談メモ` カード
  - 録音カードの右隣に出す
  - `前回の面談まとめ` と `おすすめの話題` の 2 つだけを短文で出す
  - 面談ログ完成後に `生成中… -> READY / FAILED` で差し替える
  - `作り直す` で再生成できる
- `StudentSessionStream`
  - 進行中または完了済みの面談ログを追う
- 指導報告ログ一覧
- 保護者レポート生成カード
- `LogView`
- `ReportStudio`

### 4.4 `/app/logs`

- ログの補助参照面
- `summaryMarkdown` と transcript を確認する
- どのレポートに使われたかを追う

### 4.5 `/app/reports`

- レポート確認の補助面
- 主作業は Student Room に戻す

### 4.6 `/app/settings`

- 運用設定
- guardian 情報の補完確認
- 保存方針の確認
- 組織名、プラン、人数上限、表示言語、タイムゾーン、同意バージョンの更新
- 招待の詰まり、権限人数、最近の操作履歴の確認
- 管理者向けの保守コンソールから `jobs/run` と `maintenance/cleanup` を実行
- 止まった会話処理 / 音声処理を見て、その会話やセッションだけ再開
- 削除した会話ログ / 保護者レポートを設定画面から復元
- 保守 API は管理者セッション、または `x-maintenance-secret` / `Authorization: Bearer` で通す
- 実行した人、実行方法、対象は監査ログに残す

### 4.7 設定画面でできること

- 組織の土台を持つ
  - 組織名
  - プラン名
  - 生徒上限
  - 表示言語
  - タイムゾーン
  - 同意バージョン
- 保護者情報の穴埋め
  - `guardianNames` 未入力の生徒だけを出す
  - その場で保護者名を保存する
- 招待とアカウントの確認
  - 招待中
  - 期限切れ
  - 受け入れ済み
- 権限の考え方の確認
  - 日常操作
  - 設定変更と復元
  - 保守 API と強い管理操作
- 保守コンソール
  - 会話ジョブ / 音声ジョブの待ち数
  - 詰まり疑い件数
  - 会話処理 / 音声処理の明細
  - 削除した会話ログ / 保護者レポートの復元
  - 最近の監査ログ
  - `ジョブを回す`
  - `保存期限切れを掃除`

## 5. モード別仕様

### 5.1 面談モード

- `Session.type = INTERVIEW`
- part は `FULL` 1 本
- 最大長は `60 分`
- ready になった transcript をまとめて 1 本の `面談ログ` を作る
- 生成完了後は `ConversationLog.status = DONE`

生成されるもの:

- `artifactJson`
- `summaryMarkdown`
- `NextMeetingMemo`
- `rawTextOriginal`
- `reviewedText`
- `rawTextCleaned`
- `rawSegments`
- `reviewState`
- 必要時の `formattedTranscript`
- `qualityMetaJson`

生成しないもの:

- timeline JSON
- next action JSON
- parent pack JSON
- profile delta JSON
- 話題候補タブ向け補助成果物

### 5.2 指導報告モード

- `Session.type = LESSON_REPORT`
- part は `CHECK_IN` と `CHECK_OUT`
- 各 part の最大長は `10 分`
- 両方揃ってから 1 本の `指導報告ログ` を作る
- `CHECK_IN` だけではログ生成しない
- `CHECK_OUT` だけでもログ生成しない

生成されるもの:

- `artifactJson`
- `summaryMarkdown`
- `rawTextOriginal`
- `reviewedText`
- `rawTextCleaned`
- `rawSegments`
- `reviewState`
- 必要時の `formattedTranscript`
- `qualityMetaJson`

生成しないもの:

- lesson report 補助 JSON
- 親共有 pack
- observation JSON
- student state JSON

## 6. 同期 / 非同期の分割

### 6.1 同期でやること

- 認可
- 入力バリデーション
- duration 上限チェック
- SessionPart の保存
- live chunk 保存
- job enqueue
- 進捗 API の返却

### 6.2 非同期でやること

- file upload 後の STT
- live recording finalize
- Session promotion
- transcript 統合
- `FINALIZE`
- 任意の `FORMAT`

## 7. 速度設計

目標:

- 保存受付は数秒以内
- 一般的なケースでは STT 完了後に `20〜60 秒` でログ本文を返せる構成
- 何分もかかる後段 LLM 連鎖を作らない

そのための実装:

- ログ生成は `FINALIZE` の 1 call に寄せる
- 会話ログ生成のモデルは `gpt-5.4` を使い、mini / nano へ自動で落とさない
- 1 回の生成で structured artifact を作り、表示用 markdown はそこから派生させる
- hidden な polish を走らせない
- transcript 表示整形は `FORMAT` に分離し、常時実行しない
- Runpod worker を使う主導線では、file upload と live chunk を `Vercel Blob` に置き、web と worker の参照先を一致させる
- inline / local 保存は isolated な開発検証用に残しているが、本番相当フローの正本にはしない
- ユーザーが選べる音声ファイルは `.mp3` / `.m4a` のみ
- STT worker は長い音声でも 1 本のファイルとして扱い、モデル読み込み後はそのまま全文を起こす
- UI は `文字起こし中 -> 取りまとめ中 -> ログ生成中` を分けて表示する
- session progress API で UI を早く戻す
- poll は処理中だけ動かし、経過時間とタブ表示状態で間隔を広げる
- worker 再キックは初回と stalled な `RECEIVED` の再始動だけに絞り、通常は read-only polling で追う

### 7.1 ローカル web / 本番 web 共通の Runpod 構成

主導線は `web -> queue -> Runpod worker(STT) -> Runpod stop -> web(app) で LLM finalize` に統一する。
ここでいう web は `localhost` でも `Vercel production` でも同じで、差分は env だけに寄せる。

- web 側
  - session / part / conversation を作る
  - 音声 upload と live chunk を受ける
  - job を `QUEUED` に積む
  - 必要なら Runpod Pod を自動 wake する
  - 進捗 API を返す
  - 手入力 transcript は保存 API が promotion 開始まで責任を持ち、その後の review / finalize は通常の progress 導線で追う
  - STT 完了後は app 側で conversation job を即起動する
- Runpod worker 側
  - 同じ DB と Blob を見る
  - `QUEUED` の session part job を取りに行く
  - `faster-whisper` で STT
  - transcript を保存し、promotion まで終えたら停止対象に戻る

必要な env:

- web 側
  - `PARARIA_BACKGROUND_MODE=external`
  - `PARARIA_AUDIO_STORAGE_MODE=blob`
  - `PARARIA_AUDIO_BLOB_ACCESS=private`
  - `NEXT_PUBLIC_AUDIO_STORAGE_MODE=blob`
  - `BLOB_READ_WRITE_TOKEN=...`
- Runpod worker 側
  - 同じ `DATABASE_URL`
  - 同じ `DIRECT_URL`
  - 同じ `BLOB_READ_WRITE_TOKEN`
  - `OPENAI_API_KEY`
  - `PARARIA_BACKGROUND_MODE=external`
  - `PARARIA_AUDIO_STORAGE_MODE=blob`

補足:

- `external` では Runpod は STT 専用で使い、conversation job / 次回面談メモ job は app 側が実行する
- 60分級の音声 file upload は browser から blob へ直接送り、Runpod worker から同じ参照を読む
- live 録音 chunk も blob を共有保存に使う
- `external + local storage` は Runpod worker が音声を読めないので許可しない

### 7.2 長尺 transcript をどう入力するか

- raw transcript / reviewed transcript は DB にそのまま残し、ここを要約で上書きしない
- 圧縮は `ログ生成モデルへの入力` のためだけに使う
- prompt の共通ルールは先頭にまとめ、毎回変わる生徒名・日付・transcript は後ろへ置く
- 初回生成と repair は同じ prompt cache namespace を使い、共通 prefix のキャッシュを使い回す
- `estimateTokens(text.length / 2)` の簡易見積もりで全文サイズを判定する
- 面談は、おおむね `9000 token` 以下なら:
  - `抽出済み重要発話 + 文字起こし全文` を両方入れる
- 指導報告などその他のケースは、おおむね `3500 token` 以下なら:
  - `抽出済み重要発話 + 文字起こし全文` を両方入れる
- それを超える長尺 transcript では:
  - `抽出済み重要発話` だけをログ生成入力に使う
- 面談の抽出ルール:
  - 冒頭 `14` 行
  - 面談キーワードを含む行 `28` 行まで
  - 情報量が高い行 `20` 行まで
  - 終盤 `14` 行
  - 重複除去後に最大 `72` 行
- 指導報告の抽出ルール:
  - チェックイン `10` 行まで
  - チェックアウト `12` 行まで
  - 授業キーワードを含む行 `18` 行まで
  - 情報量が高い行 `14` 行まで

### 7.3 Runpod で GPU worker を動かす

Pararia は、いまの作りだと Runpod の **Serverless endpoint** より **Pod worker** のほうが合います。
ただし 4090 を常駐させるのではなく、**on-demand 起動 + idle stop** を前提にします。

- Vercel 側は upload と job 登録だけを行う
- 音声は Blob に置く
- Runpod Pod は `npm run worker:runpod` で queue を処理し、STT と session promotion までを担当する
- `external` mode では web 側が queue へ enqueue し、STT 完了後の `FINALIZE` / `FORMAT` / `次回の面談メモ` は app 側で実行する

repo には Runpod 用の worker イメージ定義を入れています。

- `Dockerfile.runpod-worker`
- `scripts/run-runpod-worker.ts`
- `scripts/runpod-worker-start.sh`
- `scripts/requirements.runpod-worker.txt`
- `.github/workflows/publish-runpod-worker.yml`
- 詳細手順: [docs/runpod-worker.md](docs/runpod-worker.md)

GitHub Actions の `Publish Runpod Worker Image` が通ると、GHCR に worker イメージが出ます。

- `ghcr.io/<GitHub owner>/pararia-runpod-worker:latest`
- `ghcr.io/<GitHub owner>/pararia-runpod-worker:sha-...`
- `RUNPOD_WORKER_IMAGE` を未設定にしたときは、Vercel 上なら現在の commit sha を使う
- ローカル端末で `RUNPOD_WORKER_IMAGE` が空でも、同名の既存 Pod があればそれを優先して再利用し、新しい別 Pod を増やしにくくしている
- sha 固定で厳密に運用したい場合は、`RUNPOD_WORKER_IMAGE` を明示的に `:sha-...` で設定する

Runpod REST API で Pod を作る / 起こす / 止めるスクリプトも入れています。

- `npm run runpod:deploy -- --gpu="NVIDIA GeForce RTX 4090" --name="pararia-gpu-worker"`
- `npm run runpod:start`
- `npm run runpod:start -- --wait`
- `npm run runpod:start -- --fresh --wait`
- `npm run runpod:status`
- `npm run runpod:stop`
- `npm run runpod:terminate`
- `scripts/runpod-deploy.ts` は `.env.local` → `.env` の順で env を自動読込する

Runpod 側では、Pod 作成時に次を入れれば動きます。

- Container Image: まずは `ghcr.io/<GitHub owner>/pararia-runpod-worker:sha-...`
- `latest` は簡便ですが、切り分けや本番固定では避ける
- GPU: まずは `RTX 4090` か `RTX 5090`
- Start Command: 空でよい

必須 env:

- `DATABASE_URL`
  - Supabase / Neon など pooled URL を使うときは `connection_limit=1` を付ける
- `DIRECT_URL`
- `BLOB_READ_WRITE_TOKEN`
- `OPENAI_API_KEY`
- `PARARIA_BACKGROUND_MODE=external`
- `PARARIA_AUDIO_STORAGE_MODE=blob`
- `PARARIA_AUDIO_BLOB_ACCESS=private`
- `NEXT_PUBLIC_AUDIO_STORAGE_MODE=blob`
- `RUNPOD_WORKER_IMAGE` はできれば `:sha-...` 固定、未設定でも Vercel 上では現在の commit sha を優先

private GHCR image を使うときは、Runpod 側の container registry auth を作って
`RUNPOD_WORKER_CONTAINER_REGISTRY_AUTH_ID` も渡す。

GPU は `RUNPOD_WORKER_GPU_CANDIDATES` で優先順を指定できます。
既定は `NVIDIA GeForce RTX 5090,NVIDIA GeForce RTX 4090` で、5090 が取れないときだけ 4090 にフォールバックします。

PowerShell のセッションに env を入れられない場合は、repo ルートの `.env.local` に次を追記すれば `npm run runpod:deploy` でそのまま使えます。

```bash
RUNPOD_API_KEY="your-runpod-api-key"
```

on-demand 運用のときは、worker は session part queue が空になった時点で自分の Pod を stop します。
取りこぼし確認のための idle 停止も残しており、`RUNPOD_WORKER_AUTO_STOP_IDLE_MS` の既定は `60000` ms（1分）です。

本番 web の upload / regenerate から自動で Pod を wake したい場合は、Vercel 側の server env にも `RUNPOD_API_KEY` を入れて deploy してください。
それが未設定でも、ローカル端末から `npm run runpod:start -- --wait` で手動 wake はできます。
同時 upload が重なったときも、web 側は短い DB lock で wake を直列化して二重 Pod 作成を避けます。
停止側も同名 Pod 全体を確認して stop するため、`latest` と `sha-...` が混ざっても止め漏れを起こしにくくしています。

`npm run runpod:start -- --wait` は、Pod が `RUNNING` になるだけでなく、worker の `db-ok` heartbeat が出るまで待ちます。

worker loop の調整 env:

- `RUNPOD_WORKER_SESSION_PART_LIMIT=8`
- `RUNPOD_WORKER_SESSION_PART_CONCURRENCY=1`
- `RUNPOD_WORKER_CONVERSATION_LIMIT=0`
- `RUNPOD_WORKER_CONVERSATION_CONCURRENCY=1`
- `RUNPOD_WORKER_IDLE_WAIT_MS=2500`
- `RUNPOD_WORKER_ACTIVE_WAIT_MS=200`
- `RUNPOD_WORKER_AUTO_STOP_IDLE_MS=60000`
- `RUNPOD_WORKER_ONLY_SESSION_ID=...`
- `RUNPOD_WORKER_ONLY_CONVERSATION_ID=...`

STT 推奨値:

- `FASTER_WHISPER_MODEL=large-v3`
- `FASTER_WHISPER_REQUIRE_CUDA=1`
- `FASTER_WHISPER_DEVICE=auto`
- `FASTER_WHISPER_COMPUTE_TYPE=auto`
- `FASTER_WHISPER_BEAM_SIZE=1`
- `FASTER_WHISPER_BATCH_SIZE=16`
- `FASTER_WHISPER_VAD_MIN_SILENCE_MS=1000`
- `FASTER_WHISPER_VAD_SPEECH_PAD_MS=400`
- `FASTER_WHISPER_VAD_THRESHOLD=0.5`
- `FASTER_WHISPER_CHUNKING_ENABLED=0`
- `FASTER_WHISPER_POOL_SIZE=1`

GPU が強いときの最初の目安:

- `RTX 4090`: `FASTER_WHISPER_BATCH_SIZE=16`
- `RTX 5090`: `FASTER_WHISPER_BATCH_SIZE=24`

速度優先の補足:

- `beam_size=1` を既定にし、精度より 1 本の完了速度を優先する
- VAD は `min_silence_duration_ms=1000` を基準にし、切り詰め比較は `500 / 1000 / 2000` で見る
- `compute_type=auto` のままでよいが、worker image は `CTranslate2 4.7.1 + CUDA 12.8` 前提にする
- `RTX 4090` など pre-Blackwell では `int8_float16` 系を優先する
- `RTX 5090` など Blackwell では `cuBLAS` の制約を避けるため `float16` 系を優先する
- production queue から特定の session だけ処理したいときは `RUNPOD_WORKER_ONLY_SESSION_ID` を使う
- 通常運用の既定値は `RUNPOD_WORKER_CONVERSATION_LIMIT=0` で、Runpod は STT 専用に固定する
- 計測 JSON は `npm run runpod:measure-summary -- --dir .tmp/runpod-ux --out .tmp/runpod-ux-summary.md` で p50 / p95 にまとめる

まずは `chunking off / pool 1` のまま、1 本の音声をそのまま GPU に流すのが安全です。
  - 終盤 `6` 行
  - 重複除去後に最大 `42` 行
- ノイズ除外:
  - `録音を始めます`
  - `質問ありますか`
  - `以上です`
  - 短い相づちだけの行
  - 英字が多いノイズ行

### 7.4 面談ログ 1 分台 issue の進め方

- GitHub の親 issue は `#151`
- 2026-04-17 の本番マイク録音フロー baseline は:
  - 録音開始まで `856ms`
  - 録音停止可能になるまで `92.5秒`
  - 停止後に成功表示まで `130.9秒`
  - 合計 `163.8秒`
- 同日の裏側計測では、OpenAI の面談ログ生成そのものは約 `11.7秒` で、主ボトルネックは `STT + 起動待ち + 進捗制御` に寄っていた
- 2026-04-18 時点で、親 issue の子 issue `#152` `#153` `#154` `#155` `#156` は実装済み
  - `#152`: STT subphase 計測と VAD env
  - `#153`: read-only polling と手入力 transcript の one-shot 開始
  - `#154`: prompt cache prefix 安定化
  - `#155`: active job / last good artifact の保全
  - `#156`: p50 / p95 / cost 集計
- ここから親 issue を閉じるには、production 相当の 3 回連続計測を同じ条件で取り、どの改善で何秒縮んだかを issue か README に残す
- Runpod / STT の内訳を見るときは:
  - `npm run runpod:measure-ux -- --profile 5090 --startup-mode reuse --out-dir .tmp/runpod-ux`
  - `npm run runpod:measure-summary -- --dir .tmp/runpod-ux --out .tmp/runpod-ux-summary.md`
- アプリ全体の生成導線を remote で確認するときは:
  - `PARARIA_ALLOW_REMOTE_GENERATION_SMOKE=1 npm run test:remote-generation-smoke -- --base-url https://pararia.vercel.app`
- 既存のローカル長尺ベンチは `docs/interview-benchmarks/*.json` と `docs/stt-benchmarks/*.json` を参照する
- 2026-04-18 に `5090 + reuse startup` で `runpod:measure-ux` を 3 本回した結果は:
  - `Queue->Conversation`: `152.0秒 / 125.2秒 / 145.1秒`
  - `p50`: `145.1秒`
  - `p95`: `152.0秒`
  - baseline `163.8秒` 比で `p50 -18.7秒`、`p95 -11.8秒`、best run `-38.6秒`
- ただし、この 3 run では:
  - `Queue->STT` は `41.7秒 / 51.6秒 / 56.0秒`
  - `finalize duration` は `15.0秒 / 16.2秒 / 17.8秒`
  - それでも STT 後に大きい空白待ちが残る
  - `sttPrepareMs` など STT subphase は `null`
  - `llmCachedInputTokens` も `0`
- なので 2026-04-18 時点の次の改善 issue は:
  - `#159`: STT 後の handoff / queue lag を分解して短くする
  - `#158`: Runpod worker 計測を本番一致にして STT subphase null をなくす
  - `#157`: prompt cache を本番でも効かせて cached input を回復する
- 2026-04-19 時点では、この 3 本の実装自体は入っている
  - `runpod:measure-ux` JSON に `promotionCompletedAt / conversationKickRequestedAt / conversationAppDispatchStartedAt / conversationJobClaimedAt / reviewCompletedAt / finalizeStartedAt / finalizeCompletedAt` が残る
  - `runpod:measure-summary` は `## Warnings` に missing metric を出し、`## Post-STT breakdown` で post-STT 内訳を p50 / p95 で出す
  - prompt cache 診断として `promptCacheKey / promptCacheRetention / promptCacheStablePrefixTokensEstimate` も残る
- 親 issue `#151` をきれいに閉じる最後の作業は:
  - publish 済み worker image を指定して `runpod:measure-ux` を 3 本取り直す
  - `runpod:measure-summary` の `Queue->Conversation p50` と `post-STT unknown p50` が baseline `163.8秒` 比でどこまで縮んだかを issue に追記する
  - `sttPrepareMs` が non-null、`llmCachedInputTokens` が 0 固定から外れたことを確認して `#157 / #158 / #159` を close する

### 7.5 prompt cache と実コストの見方

- OpenAI への会話ログ生成は、リクエストとしては毎回全文を送る
- ただし `gpt-5.4` では prompt cache が効くので、同じ先頭部分は初回より安くなる
- Pararia では:
  - system prompt の固定ルール
  - 構造化 JSON schema に関する固定指示
  - repair 時の共通 prefix
  をできるだけ前に寄せ、cache が効きやすい形にしている
- 2026-04-19 以降の面談ログ prompt は、固定契約を前に、`生徒名 / 面談日 / 面談時間 / transcript` のような可変情報を後ろに寄せる
- そのため cache miss を見るときは、`cachedInputTokens` だけでなく:
  - `promptCacheKey`
  - `promptCacheRetention`
  - `promptCacheStablePrefixTokensEstimate`
  も一緒に見る
- そのため、実コストを見るときは次の 2 つを分けて見る
  - `cold`: その cache namespace で最初の 1 回
  - `warm`: 直後に同じ条件でもう 1 回流したとき
- ただし `cold` でも、直前のベンチや同じ prefix の別リクエストで cache が温まっていれば cached input が乗る
- 完全に cache なしの上限を見たいときは、`cachedInputTokens = 0` として同じ token 数で計算し直す
- `warm` の方が安いのは正常
- 請求がベンチより高く見えるときは、たいてい `cold` に近い条件になっている
- 実ベンチでは `docs/interview-benchmarks/*.json` に:
  - 入力トークン
  - キャッシュ入力トークン
  - 出力トークン
  - cold / warm の個別コスト
  を残す
- 重要:
  - 圧縮はあくまで `長尺入力を安全に扱うための evidence pick`
  - 生成物が弱い / 根拠が薄い場合は repair または deterministic recovery に進む
  - repair でもモデルは落とさず、同じ `gpt-5.4` で再試行する

### 7.6 速度を落とすものとして明示的にやめたこと

- analyze -> reduce -> finalize の多段 LLM
- 自動の追加仕上げ job
- 旧 structured artifact の同時生成
- 保護者レポート素材の裏生成
- ログ本体以外の hidden output を同時に作ること

## 8. ジョブ設計

### 8.1 `SessionPartJob`

型:

- `TRANSCRIBE_FILE`
- `FINALIZE_LIVE_PART`
- `PROMOTE_SESSION`

責務:

- 音声を transcript に変える
- live chunk を part に確定する
- session を `ConversationLog` 化できる状態へ進める

### 8.2 `ConversationJob`

型:

- `FINALIZE`
- `FORMAT`
- `GENERATE_NEXT_MEETING_MEMO`

責務:

- `FINALIZE`
  - transcript から `artifactJson` を先に作り、そこから `summaryMarkdown` を render する
  - 完了時に `ConversationLog.status = DONE`
- `GENERATE_NEXT_MEETING_MEMO`
  - 面談ログの `artifactJson / summaryMarkdown` を材料に、`前回の面談まとめ` と `おすすめの話題` だけを短く作る
  - 面談ログ本体とは別で失敗してよく、conversation 自体は `DONE` のままにする
- `FORMAT`
  - transcript 表示を整形する
  - 本文生成の必須条件ではない

持つ観測情報:

- `executionId`
- `attempts / maxAttempts`
- `nextRetryAt`
- `leaseExpiresAt / lastHeartbeatAt`
- `failedAt / completedAt`
- `lastRunDurationMs / lastQueueLagMs`

補足:

- retryable error は backoff 付きで再試行する
- stale な `RUNNING` job は lease 期限切れで再回収する

## 9. データモデル

### 9.1 中核モデル

- `Student`
- `StudentProfile`
- `Session`
- `SessionPart`
- `SessionPartJob`
- `ConversationLog`
- `ConversationJob`
- `NextMeetingMemo`
- `Report`
- `ReportDeliveryEvent`
- `AuditLog`
- `StudentRecordingLock`

`AuditLog` は、`action` だけでなく `organizationId / targetType / targetId / status / detailJson` を持ち、
だれが何をどこへ行った操作かを後から追える形にする。

### 9.2 `ConversationLog` の現在の意味

- `artifactJson`
  - 会話ログの正本
  - `summary / claims / nextActions / sharePoints / facts / changes / assessment / nextChecks / sections` を持つ
  - 各 entry は `text / evidence / basis / humanCheckNeeded / confidence / claimType / actionType` を持てる
- `summaryMarkdown`
  - `artifactJson` から render される表示用の本文
  - markdown そのものを正本として再解釈しない
- `rawTextOriginal`
  - 元 transcript
  - faster-whisper worker の返り値を意味を変えずに保存する evidence の保存先
  - 行末統一と trim 以外の sanitize はしない
- `reviewedText`
  - proper noun suggestion を反映した確認用 transcript
  - ログ生成では `reviewedText` があればこちらを優先する
- `rawTextCleaned`
  - display / preview 用の軽整形 transcript
  - legacy カラムなので evidence path には使わない
- `rawSegments`
  - STT segment
- `reviewState`
  - `NONE / REQUIRED / RESOLVED`
  - transcript review の現在状態を見る正本
- `formattedTranscript`
  - 必要時だけ整形
- `qualityMetaJson`
  - STT 時間、モデル、警告、生成時間、job retry 情報など
  - `transcriptReview` には review 理由、件数、更新時刻だけを入れる

### 9.3 `NextMeetingMemo` の意味

- 面談 1 回につき 1 件だけ持つ
- `sessionId / conversationId` を 1 対 1 で持ち、面談ログに追従する
- `previousSummary`
  - `前回の面談まとめ` 用の短文
- `suggestedTopics`
  - `おすすめの話題` 用の短文
- `status`
  - `QUEUED / GENERATING / READY / FAILED`
- `rawJson`
  - prompt version、token usage、source sections などの生成メタ
- これは詳細ログの代わりではなく、`次の面談で一瞬で見返すための補助メモ`

## 10. 保護者レポート

### 10.1 入力ルール

- 選択したログだけを使う
- 本文生成では各ログの `artifactJson` を優先して使う
- `summaryMarkdown` は必要時だけ補助材料として使う
- 保護者レポート preview の quality 判定も、`summaryMarkdown` だけではなく各ログの `artifactJson` を優先して見る
- bundle preview では `今回の判断・補足` と `次回確認` を分けて扱う
- 未選択ログは入れない
- 前回レポートは入れない
- profile snapshot は入れない
- 初回生成が弱すぎるときだけ、同じ `gpt-5.4` で 1 回だけ再生成する
- 生成時の `model / apiCalls / tokenUsage / retried` は `Report.qualityChecksJson.generationMeta` に残す

### 10.2 UI ルール

- 追加候補は提案だけ
- 自動追加しない
- `Report.sourceLogIds` に利用ログを残す
- 生成 progress は `選択確認 -> ログ整理 -> 本文生成 -> 保存反映` を実 phase ベースで表示する
- 擬似タイマーで先に `保存` まで進めない

### 10.3 本文品質ルール

- 保護者レポートは `先生から保護者へ送る手紙` の読み味を優先する
- 出力の並びは次で固定する
  1. 宛名
  2. 自己紹介
  3. リード
  4. 冒頭 1 段落
  5. 本文 4 段落
  6. 締め 1 段落
  7. `今後ともどうぞよろしくお願いいたします。`
  8. 校舎名 / 担当講師名
- 冒頭段落は、`今月は〜と感じています` のように、その月の全体印象を短めに伝える
- 本文 4 段落は次の役割に固定する
  - 科目・教材・学習法の迷いと、その判断理由
  - 受験期としての意味づけ、いま大事な段階
  - `今月特に印象的だったのは、` から始めてもよい本人の変化
  - `今月の成長として大きかったのは、` から始めてもよい成長の整理と来月の意識
- 締め段落は 1 文だけにして、業務連絡のようにしない
- `今後ともどうぞよろしくお願いいたします。` は本文に混ぜず、固定行として別で出す
- 署名は `校舎名` と `担当講師 名前` を別行で出す
- `teacherName` があるときは `担当講師をさせていただいております、<校舎名>の<先生名>です。`
- `teacherName` が無いときは `<校舎名>よりご報告いたします。`
- `guardianNames` が空でも、分かるなら生徒の姓から `○○様` で始める
- 教材名や学習手順を細かく説明しすぎず、保護者に届く言葉へ整理する
- 出力が弱いときだけ 1 回だけ再生成し、次のような崩れを検知してやり直す
  - 冒頭が長すぎる
  - 段落数が足りない
  - 同じ内容の言い換えが多い
  - 日本語の不自然な空白が混ざる
  - 本文が確認項目の羅列になっている
  - 締めに `よろしくお願いいたします` まで混ざる

### 10.4 状態

- `DRAFT`
- `REVIEWED`
- `SENT`

## 11. 録音制約

### 11.1 client 側

- 録音開始直後は `録音準備中` を出し、マイク許可と録音セッション準備が終わってから `録音中` に進める
- `StudentSessionConsole` が録音秒数上限で停止
- 録音中または未送信の録音がある間は、ブラウザ離脱で警告を出す
- 録音中にアプリ内リンクを押したときも、移動前に確認する
- 録音の `終了` は実際に取れた音声が 60 秒を超えてからだけ押せる
- `キャンセル` はサーバーへ送らず、この端末に一時保存する
- 録音停止後は先に端末へ一時保存してから upload する
- upload 失敗時は、一時保存した録音を `再送 / 端末へ保存 / 破棄` できる
- `IndexedDB` へ保存できないブラウザ状態でも、そのタブ上ではメモリ保持して `再送 / 端末へ保存` を続けられる
- file upload 前に audio metadata を見て長すぎるファイルを reject
- file upload 前に audio metadata を見て短すぎるファイルも reject
- file picker では `.mp3` / `.m4a` 以外を選べない
- 拡張子 / MIME が `.mp3` / `.m4a` に合わないファイルは reject する

### 11.2 server 側

- `POST /api/sessions/[id]/parts`
  - file upload duration を解析して `短すぎる / 長すぎる` を reject
  - `.mp3` / `.m4a` 以外の file upload を reject
- `POST /api/sessions/[id]/parts/live`
  - live chunk 累積 duration を見て reject
- duration 不明なら strict に reject する経路を持つ
- STT 後に内容が薄すぎる transcript は reject し、録り直しを促す
- faster-whisper worker が音声形式を読めないときだけ、同じ worker のまま一度 `AAC/M4A` へ正規化して再実行する

## 12. 進捗表示

### 12.1 session progress の段階

- `IDLE`
- `RECEIVED`
- `TRANSCRIBING`
- `WAITING_COUNTERPART`
- `GENERATING`
- `READY`
- `REJECTED`
- `ERROR`

### 12.2 重要な約束

- 「下書き公開して裏で最終調整」はしない
- `READY` はそのまま確認してよい最終ログ
- `WAITING_COUNTERPART` は lesson report 特有

## 13. API 一覧

### 13.1 認証

- `GET/POST /api/auth/[...nextauth]`

### 13.2 生徒

- `GET/POST /api/students`
- `GET/PUT /api/students/[id]`
- `GET /api/students/[id]/room`
- `GET/POST/PATCH/DELETE /api/students/[id]/recording-lock`

### 13.3 セッション

- `GET/POST /api/sessions`
- `GET/PATCH /api/sessions/[id]`
- `POST /api/sessions/[id]/parts`
- `POST /api/sessions/[id]/parts/live`
- `GET /api/sessions/[id]/progress`
- `POST /api/sessions/[id]/next-meeting-memo/regenerate`

### 13.4 コミュニケーションログ

- `GET/POST /api/conversations`
- `GET/PATCH/DELETE /api/conversations/[id]`
- `POST /api/conversations/[id]/restore`
- `POST /api/conversations/[id]/regenerate`
- `POST /api/conversations/[id]/format`
- `GET/POST /api/conversations/[id]/review`
- `PATCH /api/conversations/[id]/review/suggestions/[suggestionId]`

補足:

- `POST /api/conversations`
  - transcript 直入力を受けて background worker を起動する
- `GET /api/conversations/[id]?brief=1`
  - 軽量取得だけを行う
- `POST /api/conversations/[id]`
  - 進行中ログの worker 再キックに使う
- `PATCH /api/conversations/[id]`
  - ログ本文の手動編集保存に使う
  - `summaryMarkdown` を保存すると `artifactJson` も同時に更新する
  - 編集途中は自動保存しない
- `DELETE /api/conversations/[id]`
  - 物理削除ではなく、いったん見えなくするだけにする
  - `POST /api/conversations/[id]/restore` で戻せる
- `POST /api/conversations/[id]/regenerate?format=1`
  - 再生成に加えて transcript 整形も再実行
- `POST /api/sessions/[id]/next-meeting-memo/regenerate`
  - 面談ログが `DONE` のときだけ `次回の面談メモ` を再生成する
  - progress polling を増やさず、既存の Student Room refresh で差し替える
- `GET /api/conversations/[id]/review`
  - raw / reviewed / display transcript と proper noun suggestion を返す
  - 読み取り専用で、副作用は持たない
- `POST /api/conversations/[id]/review`
  - reviewed transcript と suggestion を作り直す
- `PATCH /api/conversations/[id]/review/suggestions/[suggestionId]`
  - `confirmed / rejected / manually_edited` を保存する

### 13.5 保護者レポート

- `POST /api/ai/generate-report`
- `POST /api/reports/[id]/send`
- `POST /api/reports/[id]/restore`

補足:

- `POST /api/ai/generate-report`
  - 選択した `sessionIds` または `logIds` だけを使う
  - `artifactJson` first で bundle を組む
  - 弱い draft は同モデルで 1 回だけ repair する
  - `qualityChecksJson.bundleQualityEval` と `qualityChecksJson.generationMeta` を保存する
- `DELETE /api/reports/[id]`
  - 物理削除ではなく、いったん見えなくするだけにする
  - `POST /api/reports/[id]/restore` で戻せる

### 13.6 ジョブ / メンテナンス

- `POST /api/jobs/run`
- `POST /api/maintenance/cleanup`

補足:

- `jobs/run` と `maintenance/cleanup` は、ふつうの画面操作ではなく保守操作として扱う
- route 側でも止める。通るのは管理者セッションか `x-maintenance-secret` / `Authorization: Bearer` だけ
- 実行した人や対象は監査ログに残す
- 定期実行は `.github/workflows/maintenance-schedule.yml` から `POST` で呼ぶ。日次は cleanup、`jobs/run` は必要なときだけ手動実行にする
- 生徒画面やログ画面の再実行は、それぞれ `POST /api/sessions/[id]/progress` と `POST /api/conversations/[id]` だけを使う

## 14. 主要ファイル

- `lib/ai/conversationPipeline.ts`
  - 互換用の入口
- `lib/ai/conversation/`
  - spec / generate / normalize / fallback / transport の本体
  - `spec.ts` を prompt 方針の正本にし、通常生成も retry も JSON で artifact を作る
  - `generate.ts` は artifact 先行、`transport.ts` は JSON 生成経路を持つ
- `lib/conversation-artifact.ts`
  - 正本 artifact の schema / render / parse
- `lib/conversation-editing.ts`
  - ログ本文編集の normalize / dirty 判定 / save payload
- `lib/jobs/conversationJobs.ts`
  - `FINALIZE / FORMAT` と retry / observability
- `lib/jobs/sessionPartJobs.ts`
  - STT、live finalize、session promotion
- `lib/ai/stt.ts`
  - Node から local `faster-whisper` worker を呼ぶ橋
- `scripts/faster_whisper_worker.py`
  - 常駐の `faster-whisper` worker
- `lib/session-service.ts`
  - part から conversation を作る
- `lib/session-progress.ts`
  - Student Room の進捗状態
- `lib/transcript/source.ts`
  - evidence 用 transcript と display 用 transcript の切り分け
- `lib/transcript/glossary.ts`
  - 内部辞書と provider hint 用語の読み出し
- `lib/transcript/review-service.ts`
  - proper noun suggestion と reviewed transcript の orchestration
- `lib/transcript/review-composition.ts`
  - session part を review 用 transcript に合成する
- `lib/transcript/review-persistence.ts`
  - suggestion の DB 同期と review state の保存
- `lib/transcript/review-list.ts`
  - review API 向けの suggestion 一覧を組み立てる
- `lib/transcript/review-assessment.ts`
  - reviewState と review 理由の判定
- `lib/transcript/preprocess.ts`
  - raw transcript から display / preview transcript と prompt block を作る
- `lib/recording/validation.ts`
  - duration gate
- `lib/ai/parentReport.ts`
  - selected artifact first のレポート生成
  - 弱い初回出力の 1 回 repair と generation meta の集約
- `lib/ai/next-meeting-memo.ts`
  - 面談ログの 1〜5 を材料に `前回の面談まとめ / おすすめの話題` を短文で作る
- `lib/next-meeting-memo.ts`
  - memo 文面の sanitize / validation と、Student Room で出す対象 session の選定
- `lib/operational-log.ts`
  - artifact / 保存済みログ本文から report bundle preview を作る
- `app/app/students/[studentId]/ReportStudio.tsx`
  - 保護者レポート生成 UI と phase 表示
- `app/app/logs/LogView.tsx`
  - ログ本文の手動編集、手動保存、未保存離脱ガード
- `lib/generation-progress.ts`
  - 保護者レポートの `選択確認 / ログ整理 / 本文生成 / 保存反映` を定義する
- `lib/runtime-paths.ts`
  - runtime 保存先の共通化
- `lib/runtime-cleanup.ts`
  - runtime file の安全な削除
- `app/app/students/[studentId]/StudentSessionConsole.tsx`
  - 録音と file upload
- `app/app/students/[studentId]/page.tsx`
  - 録音カード、次回の面談メモカード、保護者レポートカードを並べる
- `app/api/sessions/[id]/parts/route.ts`
  - file upload 入口
- `app/api/sessions/[id]/parts/live/route.ts`
  - live recording 入口
- `app/api/sessions/[id]/progress/route.ts`
  - 進捗 API

## 15. ローカル保存先ルール

- runtime data は source code と分けて扱う
- local mode では、音声アップロード、live chunk、manifest などの runtime file は `PARARIA_RUNTIME_DIR` 配下へ保存する
- blob mode では、通常 upload と live chunk は `Vercel Blob` に保存する
- `PARARIA_RUNTIME_DIR` 未設定時は後方互換のため repo 配下の `.data/` を使う
- `PARARIA_RUNTIME_DIR` を repo 外へ向けると、uploads / temp audio を完全に分離できる
- `.data/` と `.tmp/` は Git 管理対象に入れない
- benchmark や検証スクリプトの出力は `.tmp/` などの ignore 済みディレクトリへ出す
- mutating fixture を作る script は local app + local DB の組み合わせ以外では既定で fail する
- 保存期間は `PARARIA_TRANSCRIPT_RETENTION_DAYS` / `PARARIA_AUDIO_RETENTION_DAYS` / `PARARIA_REPORT_DELIVERY_EVENT_RETENTION_DAYS` で調整する
- transcript 保存期間を過ぎたら `rawTextOriginal / rawTextCleaned / reviewedText / rawSegments / proper noun suggestion` を消す
- 削除ポリシーの詳細は `docs/data-retention-policy.md` を参照する

開発時の推奨:

```bash
# 例: repo の外に runtime 保存先を置く
PARARIA_RUNTIME_DIR=../pararia-runtime

# 例: TTL をローカルで短くする
PARARIA_TRANSCRIPT_RETENTION_DAYS=14
PARARIA_AUDIO_RETENTION_DAYS=14
```

## 15.1 Runpod / faster-whisper worker セットアップ

本番相当フローの正本は `Runpod Pod + faster-whisper worker` です。
ローカル web から試す場合も、`PARARIA_BACKGROUND_MODE=external` と `PARARIA_AUDIO_STORAGE_MODE=blob` を使って同じ契約で Runpod に渡します。

- Runpod 側の起動入口は `npm run worker:runpod`
- Pod の生成 / 起動 / 停止は `npm run runpod:deploy`, `npm run runpod:start`, `npm run runpod:stop`
- worker image は `Dockerfile.runpod-worker` と `.github/workflows/publish-runpod-worker.yml` から GHCR へ publish する
- `RUNPOD_API_KEY` を web 側にも入れると、upload / regenerate 時に Pod を自動 wake できる
- `RUNPOD_WORKER_AUTO_STOP_IDLE_MS` を入れておくと、queue が空のまま一定時間たった Pod を自動 stop できる。既定は 1 分
- stop 判定は `SessionPartJob` と `ConversationJob` の `QUEUED / RUNNING` が両方ゼロの時だけ掛ける
- progress 画面と log 画面は read-only polling を基本にし、起動キックは upload / regenerate / 明示再開だけで出す

開発機で worker を直接検証したいときだけ、次を使う:

- Python `3.9+`
- `pip install faster-whisper`
- GPU で動かす場合は `faster-whisper` README の NVIDIA 依存
- Windows で CUDA DLL を別ディレクトリに置く場合は `FASTER_WHISPER_LIBRARY_PATH`
- worker コマンドを変えたいときだけ `FASTER_WHISPER_PYTHON` または `FASTER_WHISPER_WORKER_ARGS_JSON`
- 50 分台の面談を `STT -> 面談ログ生成` まで通して測るときは `npm run benchmark:interview-log`
- 保護者レポートの retry / sanitization のスモークは `npm run test:parent-report-generation`
  - 宛名、自己紹介、本文 4 段落、締め、固定あいさつ、署名の並びまで確認する
- ログ本文の手動編集 save payload / dirty 判定のスモークは `npm run test:log-editing`
- 直接録音 UI の本番相当確認は `npm run test:recording-ui -- --base-url http://localhost:3000 --skip-navigation-dialog`
- 途中離脱ガードだけ確認するときは `npm run test:recording-ui -- --base-url http://localhost:3000 --leave-safety-only`

現行の STT 実行は次の前提です。

## 16. DB / Backup / Recovery

この repo では、**DB は Supabase(Postgres)、音声 runtime は Vercel Blob** が正本です。  
そのため、**DB backup だけでは完全復旧になりません**。世界標準の運用に合わせて、次の 4 層で守ります。

1. **Supabase 側の DB backup / PITR**
2. **`pg_dump` による別系統の論理バックアップ**
3. **Vercel Blob の別退避**
4. **アプリ側で hard delete を避ける**

### 16.1 非交渉ルール

- shared / production DB に対して `prisma migrate dev` を直接打たない
- `npm run prisma:migrate` は local DB 以外を自動で止める
- shared / production DB へ migration を反映するときは `npm run prisma:migrate:deploy` を使う
- shared / production への schema 反映は `prisma migrate deploy` を使う
- `DATABASE_URL` は通常の app 接続用、`DIRECT_URL` は migration / backup 用の直結専用で扱う
- Prisma が direct を使うのは `PARARIA_USE_DIRECT_DATABASE_URL=1` を明示したときだけ
- 生徒削除は **hard delete しない**
- 生徒は **archive** し、関連データと runtime path の snapshot を `StudentArchiveSnapshot` に残す
- runtime 音声は DB と別系統なので、DB dump と Blob 退避を **両方** 回す

### 16.2 いまの削除ポリシー

- `/app/students` からの操作は「削除」ではなく **アーカイブ**
- アーカイブすると、生徒は通常一覧・ダッシュボード・通常導線から外れる
- 面談ログ、指導報告ログ、保護者レポート、runtime path 情報は保持する
- 復旧に必要な snapshot を `StudentArchiveSnapshot` に保存する
- 復旧は管理者 API または script から行う

### 16.3 毎日やる backup

DB dump:

```bash
npm run backup:db
```

- `pg_dump` を使って `.backups/db/<timestamp>/pararia.dump` を作る
- 実行端末には PostgreSQL client (`pg_dump`) が必要
- `pg_dump` が無い場合は Supabase CLI fallback を試すが、Windows では Docker Desktop が必要
- metadata と sha256 を同じディレクトリに残す
- 接続先は `PARARIA_BACKUP_DATABASE_URL` → `DIRECT_URL` → `DATABASE_URL` の順で解決する
- backup 専用の接続先を使えるなら `PARARIA_BACKUP_DATABASE_URL` を先に入れる
- `.tmp/vercel.env` と `.tmp/vercel-prod.env` を読むのは `--include-tmp-env` を付けたときだけ
- 本番では Supabase の PITR を有効にした上で、この dump を **別ストレージにも退避** する

Blob runtime backup:

```bash
npm run backup:blob
```

- 既定では `session-audio/` prefix を列挙し、`.backups/blob/<timestamp>/files/` にダウンロードする
- `manifest.json` に pathname / uploadedAt / size / etag / localSha256 を残す
- inventory だけ欲しい場合は `npm run backup:blob -- --manifest-only`
- backup は `PARARIA_BLOB_BACKUP_TOKEN` を使う
- `BLOB_READ_WRITE_TOKEN` は runtime / upload 用として分けておく

両方まとめて回す:

```bash
npm run backup:all
```

GitHub Actions でも同じ思想で回す:

- workflow: `.github/workflows/backup-runtime-and-db.yml`
- cadence: 6 時間ごと
- secrets:
  - `PARARIA_BACKUP_DATABASE_URL`
  - `SUPABASE_PROJECT_REF`
  - `SUPABASE_ACCESS_TOKEN` (status 取得用)
  - `PARARIA_BLOB_BACKUP_TOKEN` (Blob manifest も保全したい場合)
- 出力:
  - DB: roles / schema / data dump + sha256
  - Supabase: PITR / backup 状態 JSON
  - Blob: 日次は manifest、手動実行時は full export も可
- retention:
  - GitHub artifact 14 日

`workflow_dispatch` では次を選べます。

- `blob_mode=manifest`
  - 軽い inventory だけ取る
- `blob_mode=full`
  - 対象 prefix の blob 本体まで artifact に入れる

無料前提のおすすめ:

- 日次 schedule は `manifest`
- 必要時だけ `workflow_dispatch + blob_mode=full`

GitHub secrets を CLI から同期したい場合:

```bash
npm run backup:sync-github-secrets
```

`.tmp/vercel.env` や `.tmp/vercel-prod.env` を使うときだけ、次を付ける:

```bash
npm run backup:sync-github-secrets -- --include-tmp-env
```

注意:

- `gh auth status` が通っても、token に **Actions secrets write 権限** がないと同期は 403 で失敗する
- backup 用の Blob secret は `PARARIA_BLOB_BACKUP_TOKEN` だけを同期する

### 16.3.1 Supabase 側で必ずやること

この repo だけでは完結しません。Supabase 側では次を必須にします。

1. **PITR を有効化する**
   - `Settings > Add-ons` から有効化
   - 誤削除や壊れた migration に対する最終保険
2. **sandbox restore を定期的に試す**
   - 毎月 1 回、別環境へ restore して戻ることを確認
3. **backup をダウンロード可能な運用にする**
   - managed backup だけに依存せず、GitHub Actions / `pg_dump` 系の別系統を持つ

注記:

- Supabase 側の PITR 有効化や project 設定変更は **管理権限付き access token または dashboard 権限** が必要
- このマシンでは現時点で `SUPABASE_ACCESS_TOKEN` が見えていないため、repo 側自動化までは実装済み、dashboard 側トグルだけは未実行

### 16.4 復旧コマンド

アーカイブ済み生徒の確認:

```bash
npm run students:archived
```

アーカイブ済み生徒の復旧:

```bash
npm run restore:student -- --student-id <studentId>
```

バックアップを別 DB に戻す確認:

```bash
npm run restore:db -- --backup-dir <backup-dir> --database-url <restore-db-url>
```

### 16.5 運用ベストプラクティス

- Supabase は **PITR を有効化** する
- DB dump は **毎日** 取り、少なくとも 1 つは Supabase / Vercel とは別ベンダへ退避する
- Blob backup も **毎日** 回す
- **週 1 回** は restore drill をやる
  - dump を別 DB に戻せるか
  - blob backup から対象音声を取り出せるか
  - archive した生徒を restore script で戻せるか
- GitHub Actions の `Backup Restore Drill` は、DB backup を作って別 DB に戻し、最後に中身を確認する
- backup 成功だけでは不十分で、**restore できること** を確認する

### 16.6 公式ドキュメント

- Supabase Backups / PITR:
  - https://supabase.com/docs/guides/platform/backups
- Supabase CLI `db dump`:
  - https://supabase.com/docs/reference/cli/supabase-db-dump
- Vercel Blob:
  - https://vercel.com/docs/storage/vercel-blob

- 音声は `scripts/faster_whisper_worker.py` の常駐 worker で起こす
- 同じ `large-v3` モデルを使ったまま transcript を作る
- CUDA では `BatchedInferencePipeline` を優先し、CPU へは自動で逃がさない
- 旧 OpenAI STT / diarized fallback / file chunk plan は使わない
- `rawTextOriginal` は faster-whisper worker の返り値をそのまま保存する
- `rawTextCleaned` は display 用の軽整形だけに使う

今の動き方をふつうの言葉で書くと:

- ふだんは `並列ではない`
- ふだんは `1本の音声` を `1つのGPU worker` にそのまま渡す
- その中で `beam_size=1` と `batch_size=16` を基本に GPU 処理を速くしている
- つまり `音声ファイルを細かく切って何本も同時実行` は、今は既定で `オフ`
- もし `FASTER_WHISPER_CHUNKING_ENABLED=1` にしたときだけ、音声を分けて複数 worker に流す
- もし `FASTER_WHISPER_POOL_SIZE=2` 以上にしたときだけ、worker を複数立てる

要するに:

- 今の既定は `GPU 1枚で1本をそのまま速く起こす`
- 今は `ごちゃごちゃした並列処理を常時使う形ではない`

## 17. 現在の smoke check

2026-04-18 時点の主な smoke / regression:

- `npm run typecheck`
- `npm run scan:secrets`
- `npm run test:migration-safety`
- `npm run test:generation-preservation`
- `npm run test:critical-path-smoke`
- `npm run test:student-integrity-audit -- --base-url https://pararia.vercel.app`
- `npm run test:audio-upload-support`
- `npm run test:backend-scope-guard`
- `npm run test:external-worker-config`
- `npm run test:generation-progress`
- `npm run test:local-stt`
- `npm run test:next-meeting-memo-route`
- `npm run test:recording-lock-route`
- `npm run test:session-progress`
- `npm run test:session-progress-polling`
- `npm run test:rum-route`
- `npm run test:student-room-route`
- `npm run test:student-directory-route`

## 18. CI の品質ゲート

- GitHub Actions の `Conversation Quality` で faithfulness 系の代表チェックを回す
- `Conversation Quality` は `npm run test:generation-preservation` を先に通し、面談ログと保護者レポートの回帰をまとめて守る
- GitHub Actions の `Critical Path Smoke` で `録音ロック -> student room -> next meeting memo` の route smoke を回す
- GitHub Actions の `Backend Scope Guard` で backend / perf 系 branch の UI 変更を止める
- workflow では PostgreSQL service container を立てて、local と同じ Prisma 前提で回す
- 実行内容:
  - `npm ci`
  - `npm run prisma:generate`
  - `npm run prisma:test:prepare`
  - `npm run typecheck`
  - `npm run test:generation-preservation`
  - `npm run test:conversation-eval -- --out artifacts/conversation-eval-report.md`
  - `npm run prisma:seed`
  - `npm run test:critical-path-smoke`
  - `npm run check:backend-scope`
- `conversation-eval` のレポートは artifact として保存する
- 目的は「コードは通るが、主経路が壊れた」や「backend branch に UI が混ざった」を PR 時点で止めること

## 19. やらないこと

- ログ生成と同時に別成果物を量産すること
- ログ本文の裏で高コストな polish を回すこと
- `artifactJson` 以外の別正本を増やすこと
- 未選択ログを勝手に保護者レポートへ混ぜること
- client 側だけで duration 制約を信じること
