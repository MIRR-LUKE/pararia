# PARARIA SaaS

PARARIA は、塾・個別指導・学習コーチング向けの `Teaching OS` です。  
現在の実装は、**録音や会話メモから `面談ログ` または `指導報告ログ` を 1 本生成し、その保存済みログを選んで `保護者レポート` を作る** ことに絞っています。

この README は、**2026-03-27 時点の現行コードと一致する運用仕様書** です。

## 1. 先に結論

- 主導線は `Student Room`
- 録音モードは `INTERVIEW` と `LESSON_REPORT` の 2 つ
- 会話ログの正本は `ConversationLog.artifactJson`
- transcript は `raw / reviewed / display` の役割を分ける
- ログ生成は `reviewedText` があればそれを優先し、なければ raw transcript を使う
- ログ生成の主経路は `structured artifact` を 1 回で作ること
- `summaryMarkdown` は artifact から render する派生物
- retry と deterministic recovery は最後の保険で、fallback 前提の設計にはしない
- `reviewState` が transcript review の現在状態を表す正本
- `qualityMetaJson.transcriptReview` は review が必要な理由と件数の説明だけを持つ
- STT は OpenAI 音声 API を使わず、ローカル GPU の `faster-whisper` を正本にする
- 固有名詞辞書の `sendToProvider` は将来の外部 STT 切り替え用に残しているが、現行の local STT では使わない
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
6. session が揃ったら `FINALIZE` でログ本文を 1 本生成する
7. 講師は `ログ本文` と `文字起こし` を確認する
8. 必要なログだけを選び、保護者レポートを作る
9. 共有状態を更新する

## 4. 画面の役割

### 4.1 `/app/dashboard`

- 今日優先して動くべき生徒を見る
- `面談を始める` / `授業を始める` に入る
- 面談未実施、チェックアウト待ち、レポート未作成、共有待ちを確認する

### 4.2 `/app/students`

- 生徒検索
- 生徒追加
- Student Room へ移動

### 4.3 `/app/students/[studentId]`

主作業面。

- `StudentSessionConsole`
  - `INTERVIEW`
  - `LESSON_REPORT`
  - `CHECK_IN / CHECK_OUT`
  - 録音開始
  - 音声ファイル取り込み（`.mp3` / `.m4a` のみ）
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
- file upload は server 側で丸ごと受け取り、ローカル worker にそのまま渡す
- ユーザーが選べる音声ファイルは `.mp3` / `.m4a` のみ
- STT worker は長い音声でも 1 本のファイルとして扱い、モデル読み込み後はそのまま全文を起こす
- UI は `文字起こし中 -> 取りまとめ中 -> ログ生成中` を分けて表示する
- session progress API で UI を早く戻す
- poll で worker を再キックできる

### 7.1 長尺 transcript をどう入力するか

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
  - 終盤 `6` 行
  - 重複除去後に最大 `42` 行
- ノイズ除外:
  - `録音を始めます`
  - `質問ありますか`
  - `以上です`
  - 短い相づちだけの行
  - 英字が多いノイズ行

### 7.2 prompt cache と実コストの見方

- OpenAI への会話ログ生成は、リクエストとしては毎回全文を送る
- ただし `gpt-5.4` では prompt cache が効くので、同じ先頭部分は初回より安くなる
- Pararia では:
  - system prompt の固定ルール
  - 構造化 JSON schema に関する固定指示
  - repair 時の共通 prefix
  をできるだけ前に寄せ、cache が効きやすい形にしている
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

### 7.2 速度を落とすものとして明示的にやめたこと

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

責務:

- `FINALIZE`
  - transcript から `artifactJson` を先に作り、そこから `summaryMarkdown` を render する
  - 完了時に `ConversationLog.status = DONE`
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
- `Report`
- `ReportDeliveryEvent`
- `AuditLog`
- `StudentRecordingLock`

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
  - local STT worker の返り値を意味を変えずに保存する evidence の保存先
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

## 10. 保護者レポート

### 10.1 入力ルール

- 選択したログだけを使う
- 本文生成では各ログの `artifactJson` を優先して使う
- `summaryMarkdown` は必要時だけ補助材料として使う
- bundle preview では `今回の判断・補足` と `次回確認` を分けて扱う
- 未選択ログは入れない
- 前回レポートは入れない
- profile snapshot は入れない

### 10.2 UI ルール

- 追加候補は提案だけ
- 自動追加しない
- `Report.sourceLogIds` に利用ログを残す

### 10.3 状態

- `DRAFT`
- `REVIEWED`
- `SENT`

## 11. 録音制約

### 11.1 client 側

- `StudentSessionConsole` が録音秒数上限で停止
- 録音中または未送信の録音がある間は、ブラウザ離脱で警告を出す
- 録音中にアプリ内リンクを押したときも、移動前に確認する
- 録音の `終了` は 60 秒以上たってからだけ押せる
- `キャンセル` はサーバーへ送らず、この端末に一時保存する
- 録音停止後は先に端末へ一時保存してから upload する
- upload 失敗時は、一時保存した録音を `再送 / 端末へ保存 / 破棄` できる
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
- local STT が音声形式を読めないときだけ、同じ local STT のまま一度 `AAC/M4A` へ正規化して再実行する

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

- `POST /api/auth/login`
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

### 13.4 コミュニケーションログ

- `GET/POST /api/conversations`
- `GET/PATCH/DELETE /api/conversations/[id]`
- `POST /api/conversations/[id]/regenerate`
- `POST /api/conversations/[id]/format`
- `GET/POST /api/conversations/[id]/review`
- `PATCH /api/conversations/[id]/review/suggestions/[suggestionId]`

補足:

- `POST /api/conversations`
  - transcript 直入力を受けて background worker を起動する
- `GET /api/conversations/[id]?brief=1&process=1`
  - 軽量取得 + worker 再キック
- `POST /api/conversations/[id]/regenerate?format=1`
  - 再生成に加えて transcript 整形も再実行
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

### 13.6 ジョブ / メンテナンス

- `GET/POST /api/jobs/run`
- `POST /api/jobs/conversation-logs/process`
- `POST /api/jobs/session-parts/process`
- `GET/POST /api/maintenance/cleanup`

## 14. 主要ファイル

- `lib/ai/conversationPipeline.ts`
  - 互換用の入口
- `lib/ai/conversation/`
  - spec / generate / normalize / fallback / transport の本体
  - `spec.ts` を prompt 方針の正本にし、通常生成も retry も JSON で artifact を作る
  - `generate.ts` は artifact 先行、`transport.ts` は JSON 生成経路を持つ
- `lib/conversation-artifact.ts`
  - 正本 artifact の schema / render / parse
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
- `lib/operational-log.ts`
  - artifact / 保存済みログ本文から report bundle preview を作る
- `lib/runtime-paths.ts`
  - runtime 保存先の共通化
- `lib/runtime-cleanup.ts`
  - runtime file の安全な削除
- `app/app/students/[studentId]/StudentSessionConsole.tsx`
  - 録音と file upload
- `app/api/sessions/[id]/parts/route.ts`
  - file upload 入口
- `app/api/sessions/[id]/parts/live/route.ts`
  - live recording 入口
- `app/api/sessions/[id]/progress/route.ts`
  - 進捗 API

## 15. ローカル保存先ルール

- runtime data は source code と分けて扱う
- 音声アップロード、live chunk、manifest などの runtime file は `PARARIA_RUNTIME_DIR` 配下へ保存する
- `PARARIA_RUNTIME_DIR` 未設定時は後方互換のため repo 配下の `.data/` を使う
- `PARARIA_RUNTIME_DIR` を repo 外へ向けると、uploads / temp audio を完全に分離できる
- `.data/` と `.tmp/` は Git 管理対象に入れない
- benchmark や検証スクリプトの出力は `.tmp/` などの ignore 済みディレクトリへ出す
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

## 15.1 ローカル STT セットアップ

- Python `3.9+` を入れる
- `pip install faster-whisper` を実行する
- GPU で動かすときは `faster-whisper` README にある NVIDIA 依存を入れる
  - 公式 README では `CUDA 12 + cuDNN 9` が基本
  - Windows では `whisper-standalone-win` の配布ライブラリを `PATH` に置く方法も案内されている
- `FASTER_WHISPER_COMPUTE_TYPE=auto` を基本にし、worker 側でその GPU が扱える型へ自動で寄せる
- `FASTER_WHISPER_DEVICE=auto` のままなら、worker は最初に CUDA を試す
- `FASTER_WHISPER_REQUIRE_CUDA=1` を正本にして、CUDA で起動できない環境は即エラーにする
- `FASTER_WHISPER_BATCH_SIZE=8` を既定にして、CUDA では `BatchedInferencePipeline` を使う
- `FASTER_WHISPER_CHUNKING_ENABLED=0` を既定にして、まずは 1 本の音声をそのまま GPU batched inference に流す
- Windows で CUDA DLL を別ディレクトリに置く場合は `FASTER_WHISPER_LIBRARY_PATH` にそのディレクトリを入れる
- 何も入っていなくても、repo 内の `.data/local-stt/cuda12` に `cublas64_12.dll` があれば自動でそこを使う
- Windows では worker 側で `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8` を強制しているので、日本語 transcript をそのまま JSON で受け取れる
- worker コマンドを変えたいときだけ `FASTER_WHISPER_PYTHON` か `FASTER_WHISPER_WORKER_ARGS_JSON` を使う
- 初回起動時は Hugging Face からモデルを取得するので、最初の 1 回だけ時間がかかる
- 50 分台の面談を `STT -> 面談ログ生成` まで通して測るときは `npm run benchmark:interview-log` を使う

実機メモ:

- `GTX 1070 8GB + faster-whisper large-v3` では `FASTER_WHISPER_COMPUTE_TYPE=auto` が安全
- この構成では `int8_float16` は通らず、worker が CUDA の対応型を見て `int8` などへ自動で寄せる
- upstream の `faster-whisper` README では、`RTX 3070 Ti 8GB` 上で `large-v2 / beam_size=5 / batch_size=8` が `13分音声を17秒` という batched benchmark が公開されている
- 2026-04-01 にローカル GPU で `.m4a` 実音声 1 本の文字起こしを通し、約 `65 秒` で transcript を返すことを確認済み

現行の STT 実行は次の前提です。

- 音声は `scripts/faster_whisper_worker.py` の常駐 worker で起こす
- 同じ `large-v3` モデルを使ったまま transcript を作る
- CUDA では `BatchedInferencePipeline` を優先し、CPU へは自動で逃がさない
- 旧 OpenAI STT / diarized fallback / file chunk plan は使わない
- `rawTextOriginal` は local STT の返り値をそのまま保存する
- `rawTextCleaned` は display 用の軽整形だけに使う

今の動き方をふつうの言葉で書くと:

- ふだんは `並列ではない`
- ふだんは `1本の音声` を `1つのGPU worker` にそのまま渡す
- その中で `batch_size=8` の GPU 処理を使って速くしている
- つまり `音声ファイルを細かく切って何本も同時実行` は、今は既定で `オフ`
- もし `FASTER_WHISPER_CHUNKING_ENABLED=1` にしたときだけ、音声を分けて複数 worker に流す
- もし `FASTER_WHISPER_POOL_SIZE=2` 以上にしたときだけ、worker を複数立てる

要するに:

- 今の既定は `GPU 1枚で1本をそのまま速く起こす`
- 今は `ごちゃごちゃした並列処理を常時使う形ではない`

## 16. 現在の smoke check

2026-04-01 に次を実行して通過確認済み:

- `npm run typecheck`
- `npm run test:audio-upload-support`
- `npm run test:conversation-draft-quality`
- `npm run test:conversation-eval -- --out .tmp/conversation-eval-report.md`
- `npm run test:generation-progress`
- `npm run test:lesson-report-flow`
- `npm run test:local-stt`
- `npm run test:log-render-and-llm-retries`
- `npm run test:live-transcription`
- `npm run test:session-progress`
- `npm run test:transcript-preprocess`
- `npm run test:transcript-review`
- `npx tsx scripts/test-conversation-artifact-semantics.ts`
- `npm run build`

## 17. CI の品質ゲート

- GitHub Actions の `Conversation Quality` で faithfulness 系の代表チェックを回す
- workflow では PostgreSQL service container を立てて、local と同じ Prisma 前提で回す
- 実行内容:
  - `npm ci`
  - `npm run prisma:generate`
  - `npm run prisma:test:prepare`
  - `npm run typecheck`
  - `npm run test:transcript-review`
  - `npx tsx scripts/test-conversation-artifact-semantics.ts`
  - `npm run test:conversation-draft-quality`
  - `npm run test:conversation-eval -- --out artifacts/conversation-eval-report.md`
- `conversation-eval` のレポートは artifact として保存する
- 目的は「コードは通るが、盛ったログや固有名詞崩れが入った」を PR 時点で止めること

## 18. やらないこと

- ログ生成と同時に別成果物を量産すること
- ログ本文の裏で高コストな polish を回すこと
- `artifactJson` 以外の別正本を増やすこと
- 未選択ログを勝手に保護者レポートへ混ぜること
- client 側だけで duration 制約を信じること
