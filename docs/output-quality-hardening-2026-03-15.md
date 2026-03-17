# 出力品質ハードニング報告

更新日: 2026-03-15
対象: 会話ログ詳細 / Student Room / 自動生成パイプライン

## 結論
今回の修正で、以下を完了しました。

- 会話ログ詳細と Student Room から英語 UI を排除
- enum や内部状態がそのまま画面に漏れる問題を修正
- LLM の弱い出力をそのまま採用せず、文字起こしから再構成する fallback を追加
- 重複した generic 文言が summary / topics / questions / actions に出る問題を抑止
- `typecheck / lint / build` をすべて通過

## 直していた問題
### 1. 生成結果が generic で、会話の中身を拾えていなかった
実際には以下のような崩れが出ていました。

- `次回までの進め方` のような抽象タイトルが繰り返される
- `確認すべきポイントを具体化した` のような generic 文が繰り返される
- おすすめの話題や短い質問が transcript の中身に根差していない
- next actions が generic で、その面談に固有の行動になっていない
- Student Room の state / rationale が weak で、会話の核が出ていない

### 2. UI に英語 enum / ラベルがそのまま出ていた
実際に以下が画面に出ていました。

- `Student Room`
- `confidence`
- `priority`
- `canonical:`
- `PENDING / CONFIRMED / IGNORED`
- `STUDENT / COACH`
- `parts / pending entities / status`

### 3. 保険文の埋め方が summary をさらに悪くしていた
`min chars` を満たすための補助文が generic で、重複を増やしていました。

## 実装内容
### A. transcript 由来の theme fallback を追加
ファイル: `lib/ai/conversationPipeline.ts`

追加した考え方:

- LLM 出力が weak なときは、そのまま UI に出さない
- transcript から、学習面談で頻出の論点を theme として抽出する
- theme から以下を再構成する
  - summaryMarkdown
  - timeline
  - nextActions
  - studentState
  - recommendedTopics
  - quickQuestions
  - profileSections
  - parentPack

今回追加した代表 theme:

- 日々の学習と時間配分
- 初見問題で止まる原因の整理
- 復習方法の更新
- 崩れやすい単元の補強
- 共通テスト対策の入れ方

該当箇所:

- theme 定義: `lib/ai/conversationPipeline.ts:939`
- action 再構成: `lib/ai/conversationPipeline.ts:1125`
- parent pack 再構成: `lib/ai/conversationPipeline.ts:1282`
- weak 判定: `lib/ai/conversationPipeline.ts:1331`
- FINALIZE fallback 適用: `lib/ai/conversationPipeline.ts:1985`
- SINGLE PASS fallback 適用: `lib/ai/conversationPipeline.ts:2674`

### B. weak output 判定を強化
ファイル: `lib/ai/conversationPipeline.ts`

追加した判定:

- duplicate 文言の検出
- generic placeholder 文言の検出
- トピック / 質問 / rationale の重複検出
- summary section の中身が薄い場合の再構成

### C. summary の文字数埋めを修正
ファイル: `lib/ai/conversationPipeline.ts`

修正内容:

- filler を重複なしで使うよう変更
- generic 最終行を繰り返さないよう変更

### D. UI での日本語正規化を追加
#### 会話ログ詳細
ファイル: `app/app/logs/LogDetailView.tsx`

対応内容:

- タブ名 `Student Room` -> `生徒ルーム`
- `confidence` -> `信頼度`
- `priority` -> `優先度`
- `canonical:` -> `確定名:`
- action owner / entity kind / entity status を日本語化

該当箇所:

- タブ定義: `app/app/logs/LogDetailView.tsx:148`
- owner ラベル: `app/app/logs/LogDetailView.tsx:155`
- entity status ラベル: `app/app/logs/LogDetailView.tsx:188`
- 固有名詞 badge 反映: `app/app/logs/LogDetailView.tsx:611`

#### Student Room
ファイル: `app/app/students/[studentId]/page.tsx`

対応内容:

- session status / part type / part status / report status を日本語化
- `parts / pending entities / status` を日本語に変更
- next actions の owner 表示を日本語化
- entity kind の表示を日本語化
- report 状態の表示を日本語化

該当箇所:

- owner ラベル: `app/app/students/[studentId]/page.tsx:132`
- session status ラベル: `app/app/students/[studentId]/page.tsx:149`
- status 変換関数: `app/app/students/[studentId]/page.tsx:190`
- セッション一覧 badge: `app/app/students/[studentId]/page.tsx:622`

## ベンチマーク
対象ログ: `cmmqg6nq60005xzjigrm0jjen`

### 修正前の問題
- generic な summary
- 同じ意味の文が繰り返される
- transcript の中核論点が拾えていない
- nextActions が面談固有でない
- Student Room の state / topic / quick question が弱い

### 修正後の自動生成で出る論点
- 数学を毎日続ける前提と時間配分
- 初見問題で最初の一手が出ないこと
- 復習は参考書に戻るだけでなく、思考メモを残す必要があること
- 確率など崩れやすい単元の補強
- 共通テスト対策の導入時期と教材決定

### 修正後の next actions
- 初見演習の思考メモを残す
- 崩れやすい単元を解けるレベルから補強する
- 共通テスト演習の時期と教材を決める
- 講師が次回、再現できた一手と出ない一手を確認する

### 補足
このログは手作業の gold standard も作成済みです。

- gold standard: `docs/gold-standard-cmmqg6nq60005xzjigrm0jjen.md`

今回の自動生成は、そこへ寄せるためのロジック改善です。
手作業版そのものを上書きはしていません。

## 検証結果
実行済み:

- `npm run typecheck`
- `npm run lint`
- `npm run build`

結果:

- typecheck: OK
- lint: OK
- build: OK

追加確認:

- benchmark transcript を single-pass で再生成し、英語混入なしを確認
- summary / timeline / topics / quickQuestions / nextActions が transcript 内容に沿うことを確認

## 今後の観点
今回の修正で、"弱い LLM 出力をそのまま見せる" 状態からは抜けました。
一方で、今後さらに詰めるなら以下です。

- transcript theme を lesson report 用にも増やす
- school / life 系テーマをもう少し厚くする
- 生成物と gold standard の差分を自動評価するスクリプトを追加する
- 実データ複数件で regression チェックを回す
