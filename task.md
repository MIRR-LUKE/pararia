# PARARIA vNext Issue Backlog

更新日: 2026-03-22  
前提: 旧確認フローは廃止済み。以後の issue はすべて `面談モード / 指導報告モード / ログ選択型の保護者レポート生成` を前提にする。
親 issue: [#13 PARARIA vNext 実装バックログ (2026-03-22)](https://github.com/MIRR-LUKE/pararia/issues/13)

## 0. いまの基準線

- 主導線は `Student Room`
- 録音は `面談モード` と `指導報告モード`
- 生成物は `面談ログ` と `指導報告ログ`
- `保護者レポート` は選択したログだけから都度生成する
- `/logs` と `/reports` は補助面のまま
- 旧 `entity review` 系の UI / API / schema / seed は削除済み

## 1. 実装順

1. `P0-01` Student Room のモード別主導線を完成させる
2. `P0-02` Student Room のログ選択型レポート生成を常設化する
3. `P0-03` 共有状態と送信履歴の最小ループを作る
4. `P0-04` Dashboard を朝の判断画面にする
5. `P0-05` Reports / Logs を補助面として整える
6. `P0-06` Settings / Admin に共有運用の最低限を入れる
7. `P0-07` Delivery / status / source trace の共通基盤を入れる
8. `P1-01` Student Room の履歴と次アクションを強くする
9. `P1-02` Manager 向け drill-in と運用品質を見える化する
10. `P1-03` Onboarding / demo data / activation を整える
11. `P1-04` Audit / retention / trust を正式化する
12. `P2-01` Campus / LINE / weekly digest に進む

## 2. P0

### Issue P0-01 | Student Room のモード別主導線を完成させる

- GitHub: [#1](https://github.com/MIRR-LUKE/pararia/issues/1)

- ラベル:
  - `priority/P0`
  - `area/student-room`
  - `type/ux`
- 目的:
  - Tutor が `面談モード / 指導報告モード` を見失わずに録音へ入れるようにする
- 画面:
  - `Student Room`
- 変更するブロック:
  - `Mode Selector`
  - `Recording / Capture Block`
  - `Session Status Banner`
- やること:
  - [ ] モード切替を常設する
  - [ ] モードごとに録音開始文言と補助説明を分ける
  - [ ] `CHECK_IN / CHECK_OUT` の進行状況を指導報告モードで明示する
  - [ ] 録音後に `面談ログ生成中 / 指導報告ログ生成中` を見せる
- 完了条件:
  - [ ] Tutor が 3 秒以内に現在モードを認識できる
  - [ ] 指導報告モードで `CHECK_IN / CHECK_OUT` のどちらを録るか迷わない
  - [ ] 録音後の次状態が画面上で分かる
- 依存:
  - なし

### Issue P0-02 | Student Room のログ選択型レポート生成を常設化する

- GitHub: [#2](https://github.com/MIRR-LUKE/pararia/issues/2)

- ラベル:
  - `priority/P0`
  - `area/student-room`
  - `area/reports`
  - `type/flow`
- 目的:
  - `ログ生成 -> ログ選択 -> 保護者レポート生成` を Student Room で閉じる
- 画面:
  - `Student Room`
- 変更するブロック:
  - `面談ログセクション`
  - `指導報告ログセクション`
  - `保護者レポート作成セクション`
- やること:
  - [ ] 面談ログと指導報告ログを UI 上で明確に分ける
  - [ ] 保護者レポート候補ログを選択できるようにする
  - [ ] 選択件数と選択中ログをその場で確認できるようにする
  - [ ] `保護者レポートを生成` を主 CTA にする
- 完了条件:
  - [ ] Tutor が Student Room だけでレポート生成まで進める
  - [ ] 未選択ログが勝手に使われない
  - [ ] `どのログを使って作るか` が視覚的に分かる
- 依存:
  - `P0-01`

### Issue P0-03 | 共有状態と送信履歴の最小ループを作る

- GitHub: [#3](https://github.com/MIRR-LUKE/pararia/issues/3)

- ラベル:
  - `priority/P0`
  - `area/student-room`
  - `area/delivery`
  - `type/ops`
- 目的:
  - レポート生成後の `確認 -> 共有` を止めない
- 画面:
  - `Student Room`
- 変更するブロック:
  - `Delivery Status`
  - `Share History`
- やること:
  - [ ] 現在の共有状態を見えるようにする
  - [ ] `送信済みにする` の導線を分かりやすくする
  - [ ] 共有履歴を最小限で表示する
  - [ ] 手動共有の記録を履歴に残せるようにする
- 完了条件:
  - [ ] Tutor が共有済みか未共有かをすぐ見分けられる
  - [ ] 最新の共有アクションが Student Room で追える
  - [ ] レポート生成後に別画面へ逃がさなくてよい
- 依存:
  - `P0-02`

### Issue P0-04 | Dashboard を朝の判断画面にする

- GitHub: [#4](https://github.com/MIRR-LUKE/pararia/issues/4)

- ラベル:
  - `priority/P0`
  - `area/dashboard`
  - `type/ux`
- 目的:
  - Manager が朝いちで `何が止まっているか` を分かるようにする
- 画面:
  - `Dashboard`
- 変更するブロック:
  - `KPI Cards`
  - `Drill-in Table`
  - `Delayed Share Queue`
- やること:
  - [ ] `review待ち件数` を出す
  - [ ] `保護者レポート未生成件数` を出す
  - [ ] `共有遅延件数` を出す
  - [ ] `failed / bounced件数` を出す
  - [ ] KPI から対象生徒一覧に降りられるようにする
- 完了条件:
  - [ ] Manager が 5 秒以内に主要な止まりを把握できる
  - [ ] 最重要項目から Student Room へ 1 クリックで降りられる
- 依存:
  - `P0-03`
  - `P0-07`

### Issue P0-05 | Reports / Logs を補助面として整える

- GitHub: [#5](https://github.com/MIRR-LUKE/pararia/issues/5)

- ラベル:
  - `priority/P0`
  - `area/reports`
  - `area/logs`
  - `type/ux`
- 目的:
  - 補助画面を主役に戻さず、確認用として使いやすくする
- 画面:
  - `Reports`
  - `Logs`
- 変更するブロック:
  - `Filters`
  - `Selected Logs Summary`
  - `Mode Filter`
  - `Related Reports`
- やること:
  - [ ] Reports で `未作成 / 下書き / 送付済み` を追いやすくする
  - [ ] Logs で `面談ログ / 指導報告ログ` を見分けやすくする
  - [ ] どのログがどの保護者レポートに使われたかを見せる
  - [ ] Student Room に戻る導線を強くする
- 完了条件:
  - [ ] 補助画面だけ見ていても現在地を見失わない
  - [ ] 主作業を Student Room に戻せる
- 依存:
  - `P0-02`
  - `P0-07`

### Issue P0-06 | Settings / Admin に共有運用の最低限を入れる

- GitHub: [#6](https://github.com/MIRR-LUKE/pararia/issues/6)

- ラベル:
  - `priority/P0`
  - `area/settings`
  - `type/admin`
- 目的:
  - 共有を始める前の最低限の設定確認を 1 画面に寄せる
- 画面:
  - `Settings / Admin`
- 変更するブロック:
  - `Guardian Contacts`
  - `Sending Config`
  - `Role Permissions`
  - `Consent & Retention`
- やること:
  - [ ] guardian 連絡先の最小管理 UI を作る
  - [ ] メール送信設定の状態を見せる
  - [ ] 役割ごとの共有権限を見直す
  - [ ] 保持方針の最低限を明示する
- 完了条件:
  - [ ] Manager が「共有を始めてよいか」を判断できる
  - [ ] Student Room から設定不足へ戻す導線がある
- 依存:
  - `P0-03`

### Issue P0-07 | Delivery / state / source trace の共通基盤を入れる

- GitHub: [#7](https://github.com/MIRR-LUKE/pararia/issues/7)

- ラベル:
  - `priority/P0`
  - `area/platform`
  - `area/delivery`
  - `type/backend`
- 目的:
  - 画面ごとに状態の意味がずれないようにする
- 対象:
  - `Report`
  - `sourceLogIds`
  - delivery event 設計
  - audit の最小版
- やること:
  - [ ] 保護者レポートと `sourceLogIds` の追跡を正式な基準にする
  - [ ] `送信 / 再送 / 手動共有` を event として持てる形にする
  - [ ] Dashboard と Student Room が同じ意味で状態を見られるようにする
  - [ ] 将来の `failed / bounced / delivered` に耐えるデータ構造にする
- 完了条件:
  - [ ] ログ選択型レポート生成の根拠が追える
  - [ ] 共有イベントをあとから UI に出せる
  - [ ] 画面ごとに状態定義がぶれない
- 依存:
  - なし

## 3. P1

### Issue P1-01 | Student Room の履歴と次アクションを強くする

- GitHub: [#8](https://github.com/MIRR-LUKE/pararia/issues/8)

- ラベル:
  - `priority/P1`
  - `area/student-room`
  - `type/ux`
- 目的:
  - Tutor が「前回までの流れ」と「次の一手」を同じ画面で掴めるようにする
- やること:
  - [ ] `Communication Timeline` を入れる
  - [ ] `Next Actions` を強くする
  - [ ] 前回共有内容と今回共有内容をつなぐ
- 完了条件:
  - [ ] 共有履歴と次の確認事項が 1 画面で読める
- 依存:
  - `P0-03`

### Issue P1-02 | Manager 向け drill-in と運用品質を見える化する

- GitHub: [#9](https://github.com/MIRR-LUKE/pararia/issues/9)

- ラベル:
  - `priority/P1`
  - `area/dashboard`
  - `type/analytics`
- 目的:
  - 共有運用のボトルネックを Manager が追えるようにする
- やること:
  - [ ] `average time-to-share` を主要指標に入れる
  - [ ] `再送発生件数` と `手動共有件数` を出す
  - [ ] `誰が / どのログから / 何日止まっているか` を drill-in で見せる
- 完了条件:
  - [ ] Manager が止まり方の傾向を説明できる
- 依存:
  - `P0-04`
  - `P0-07`

### Issue P1-03 | Onboarding / demo data / activation を整える

- GitHub: [#10](https://github.com/MIRR-LUKE/pararia/issues/10)

- ラベル:
  - `priority/P1`
  - `area/onboarding`
  - `type/product`
- 目的:
  - 初回導入で最初の 1 人を end-to-end で完了しやすくする
- やること:
  - [ ] 初回セットアップ導線を整える
  - [ ] seed / demo data を現行 UX に合わせる
  - [ ] Tutor 向けの最短導線を作る
- 完了条件:
  - [ ] 新規環境で最初の Student Room 体験が迷わない
- 依存:
  - `P0-01`
  - `P0-02`

### Issue P1-04 | Audit / retention / trust を正式化する

- GitHub: [#11](https://github.com/MIRR-LUKE/pararia/issues/11)

- ラベル:
  - `priority/P1`
  - `area/platform`
  - `area/settings`
  - `type/trust`
- 目的:
  - 教育データと共有履歴を扱う前提を運用上も明確にする
- やること:
  - [ ] retention を正式化する
  - [ ] deletion request の扱いを決める
  - [ ] audit export の要否を決める
  - [ ] webhook / send 記録の監査方針を決める
- 完了条件:
  - [ ] README と Settings が同じ trust 前提で説明できる
- 依存:
  - `P0-06`
  - `P0-07`

## 4. P2

### Issue P2-01 | Campus / LINE / weekly digest に進む

- GitHub: [#12](https://github.com/MIRR-LUKE/pararia/issues/12)

- ラベル:
  - `priority/P2`
  - `area/expansion`
- 目的:
  - Teaching OS の核を保ったまま拡張する
- やること:
  - [ ] Campus 比較
  - [ ] Campus 正規モデル
  - [ ] LINE 第二チャネル
  - [ ] weekly digest / reminder
- 完了条件:
  - [ ] P0 / P1 が安定したあとに着手する
- 依存:
  - `P0` と `P1` の完了

## 5. 非目標

- 出欠
- 請求
- 会計
- 時間割
- 広い SIS 化

## 6. Issue 化するときの共通ルール

- タイトルは `P0-01 | Student Room ...` 形式で統一する
- 1 issue 1 outcome にする
- 受け入れ条件は必ず画面で検証できる文にする
- DB / API 名は本文末尾の補足に下げる
- 旧確認フローを前提にしたタスクは今後追加しない
