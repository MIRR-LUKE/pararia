# PARARIA vNext Issue Backlog

最終更新: 2026-03-22

## 読み方
- `[x]` は、この round で完了条件まで閉じた項目です。
- `[ ]` は、まだ残っている項目です。
- issue のタイトルは GitHub と揃えています。実装順もこの順で追えば大丈夫です。
- UI が未確定の項目は、backend と共通基盤だけ先に進めています。

親 issue: [#13 PARARIA vNext 実装バックログ](https://github.com/MIRR-LUKE/pararia/issues/13)

## 今回ここまで終わったこと
- [x] 旧 `entity / 固有名詞確認` 前提の docs・API・schema・seed を撤去した
- [x] `20260322000100_remove_entity_review_legacy` を DB に適用した
- [x] `ReportDeliveryEvent` と `20260322000200_report_delivery_events` を追加し、DB に適用した
- [x] `generate-report` で `sourceLogIds` と `DRAFT_CREATED` を保存するようにした
- [x] `reports/[id]/send` で `review / sent / delivered / failed / bounced / manual_share / resent` を event として記録できるようにした
- [x] Student Room API が最新 delivery history と派生状態を返すようにした
- [x] Reports / Logs が source trace と latest delivery state を表示するようにした
- [x] Settings / Admin に最小の運用設定画面を入れた
- [x] Dashboard / 生徒一覧 を delivery event 基準の状態表示に揃えた
- [x] Dashboard に `average time-to-share` を追加した
- [x] Settings から guardianNames を更新できるようにした
- [x] `scripts/verify-report-delivery.ts` を追加し、smoke check を通した

## 完了済み issue

### [#7 P0-07 | Delivery / status / source trace の共通基盤を入れる](https://github.com/MIRR-LUKE/pararia/issues/7)
現在地: backend と基盤は完了。画面ごとの深い集計だけ残り。

- [x] `ReportDeliveryEvent` model / migration を追加した
- [x] DB に migration を適用した
- [x] `sourceLogIds` を report 生成時に保存するようにした
- [x] `draft_created / review / sent / delivered / failed / bounced / manual_share / resent` を event として保存できるようにした
- [x] Student Room API が history と latest event を返すようにした
- [x] smoke check script を追加し、主要状態遷移を検証できるようにした
- [x] Dashboard / 生徒一覧 を event 基準で統一した
- [ ] Settings 側で delivery / trust summary をさらに広げる
- [ ] `failed / bounced / delivered` を使った深い運用集計を manager view に出す

### [#3 P0-03 | 共有状態と送信履歴の最小ループを作る](https://github.com/MIRR-LUKE/pararia/issues/3)
現在地: backend は通った。最終 UI polish が残り。

- [x] Student Room で `review / sent / failed / bounced / manual_share / resent` を記録できるようにした
- [x] 最新の共有状態を Student Room に返すようにした
- [x] Share History を event ベースで表示できるようにした
- [ ] 送信失敗時の次アクション UI を Figma 確定版に合わせて整える
- [ ] 宛先修正導線を Student Room から自然につなぐ

### [#5 P0-05 | Reports / Logs を補助面として整える](https://github.com/MIRR-LUKE/pararia/issues/5)
現在地: 補助面としての役割は作れた。相互遷移の polish が残り。

- [x] Reports が `未作成 / レビュー待ち / 共有待ち / 共有済み / 手動共有 / 共有遅延` を見分けられるようにした
- [x] Reports が source trace 件数と sourceLogIds を表示できるようにした
- [x] Logs が `面談ログ / 指導報告ログ` と関連レポートを辿れるようにした
- [ ] Reports から Student Room への戻り導線をもう一段わかりやすくする
- [ ] Logs から選択済みレポート作成フローへ飛ぶ導線を調整する

### [#6 P0-06 | Settings / Admin に共有運用の最低限を入れる](https://github.com/MIRR-LUKE/pararia/issues/6)
現在地: 最小版は着手済み。編集系が残り。

- [x] `/api/settings` を追加した
- [x] 組織名更新をできるようにした
- [x] guardian 連絡先カバレッジ、送信設定サマリー、権限人数、保存期間を見える化した
- [x] guardian 連絡先の編集 UI を入れた
- [x] 送信設定を参照専用として分かる形に整えた
- [ ] 送信プロバイダ設定の編集 UI を入れる
- [ ] 権限ごとの共有運用ガードを UI でも明示する

## P0

### [#1 P0-01 | Student Room のモード別主導線を完成させる](https://github.com/MIRR-LUKE/pararia/issues/1)
現在地: 実装途中。最終 UI は Figma 確定待ち。

- [ ] `Mode Selector` を最終 UI に合わせて確定する
- [ ] `面談モード / 指導報告モード` のファーストビュー差分を整える
- [ ] `CHECK_IN / CHECK_OUT` の見せ方を指導報告モード側で磨く
- [ ] 録音後に `面談ログ生成中 / 指導報告ログ生成中` を明確に表示する

### [#2 P0-02 | Student Room のログ選択型レポート生成を常設化する](https://github.com/MIRR-LUKE/pararia/issues/2)
現在地: backend は通った。常設 UI の詰めが残り。

- [x] 選択ログで保護者レポートを生成する API を整理した
- [x] 生成時に `sourceLogIds` を保存するようにした
- [ ] `面談ログセクション / 指導報告ログセクション` を UI で分けて見せる
- [ ] 保護者レポート作成セクションを常設化する
- [ ] ログ未選択時の空状態を整える
- [ ] どのログを使って生成するかを Tutor が迷わず選べる UI にする

### [#4 P0-04 | Dashboard を朝の判断画面にする](https://github.com/MIRR-LUKE/pararia/issues/4)
現在地: 表示の言葉合わせは進んだ。event 基準の深掘りが残り。

- [x] `未生成 / レビュー待ち / 共有待ち / 共有済み` を主導線ベースに整理した
- [x] 今日の優先キューを `ログ生成 -> レビュー -> 共有` の流れに合わせた
- [x] `failed / bounced / resent / manual_shared` を KPI と queue に反映した
- [x] `average time-to-share` を出した
- [ ] drill-in から Student Room に 1 click で戻れるようにする

## P1

### [#8 P1-01 | Student Room の履歴と次アクションを強くする](https://github.com/MIRR-LUKE/pararia/issues/8)
- [ ] `Communication Timeline` を整える
- [ ] `Next Actions` を整える
- [ ] 前回共有内容と次回共有候補を 1 画面で読めるようにする

### [#9 P1-02 | Manager 向け drill-in と運用品質を見える化する](https://github.com/MIRR-LUKE/pararia/issues/9)
- [ ] `average time-to-share` を drill-in に入れる
- [ ] `共有遅延件数 / failed件数 / bounced件数 / 再送件数` を見える化する
- [ ] `誰の / どのログから / どこで止まっているか` を manager が追えるようにする

### [#10 P1-03 | Onboarding / demo data / activation を整える](https://github.com/MIRR-LUKE/pararia/issues/10)
- [ ] 初回セットアップ導線を整える
- [ ] seed / demo data を onboarding UX に合わせる
- [ ] Tutor 向けの最短導線を作る

### [#11 P1-04 | Audit / retention / trust を正式化する](https://github.com/MIRR-LUKE/pararia/issues/11)
- [x] audit helper を追加した
- [x] report generate / delivery event / settings update の監査ログを記録するようにした
- [ ] retention を正式化する
- [ ] deletion request の扱いを決める
- [ ] audit export の導線を決める
- [ ] webhook / send 設定の署名検証ポリシーを決める
- [ ] README と Settings に trust 運用を反映する

## P2

### [#12 P2-01 | Campus / LINE / weekly digest に進む](https://github.com/MIRR-LUKE/pararia/issues/12)
- [ ] Campus 比較
- [ ] Campus 正規モデル
- [ ] LINE 第二チャネル
- [ ] weekly digest / reminder

## 今は後回し
- [ ] `opened / clicked` のような細かい配信イベント
- [ ] Campus 比較 UI の作り込み
- [ ] LINE の本実装
- [ ] weekly digest の装飾

## この round で同期したもの
- [x] `Dashboard / 生徒一覧` の event 基準表示合わせ
- [x] `README` の実装同期
- [x] GitHub issue への進捗反映

## 実装時の優先順
1. `P0-07` の残りを閉じて、状態表示を画面横断で揃える
2. `P0-02` と `P0-03` の Student Room 常設導線を Figma 確定版に合わせる
3. `P0-04` の manager view を実データで固める
4. `P0-06` の settings 編集系を足す
5. その後に `P1` へ進む
