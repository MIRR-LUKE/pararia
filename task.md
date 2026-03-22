# PARARIA vNext 画面別改善ドキュメント

更新日: 2026-03-22

## 1. 一言定義

> PARARIAは、授業・面談の会話を、次回指導・保護者共有・教室運営に変換する Teaching OS。

## 2. このプロダクトの主導線

- 講師は `Student Room` で会話を確認する。
- 講師は `Student Room` で entity を確認し、レポートを整える。
- 講師は `Student Room` で保護者共有を完了する。
- 管理者は `Dashboard` で review待ち、entity block、共有遅延、送信失敗を朝いちで把握する。
- `Reports` と `Logs` は参照面として残すが、主導線には戻さない。
- `Settings / Admin` は共有運用を安全に始めるための管理画面にする。
- `DB / 状態定義 / Delivery / Audit / Trust` は共通土台として支える。

## 3. 画面マップ

- 主役画面: `Student Room`
- 管理画面: `Dashboard`
- 補助画面: `Reports`, `Logs`
- 設定画面: `Settings / Admin`
- 画面ではない共通土台: `State`, `Delivery`, `Evidence`, `Audit`, `Trust`
- 後回し: `Campus 比較`, `LINE 第二チャネル`, `週次レビュー装飾`, `opened / clicked の詳細イベント`

## 4. 画面別改善方針

## Student Room

### 役割

講師が、会話確認から保護者共有完了までを 1 画面で閉じる主画面。

### 誰が使うか

Tutor

### ファーストビュー

画面上部に `生徒名 / 今日の状態 / レポート状態 / 共有状態 / 次にやること` がすぐ見える状態にする。

### 最初に取る行動

講師はまず `今日のレポートが送信可能か` を確認し、必要なら `entity確認` か `送信` に進む。

### Before

共有状態、再送、手動共有、根拠、失敗時の次アクションが分散していて、講師が「今どこまで終わっているか」を瞬時に判断しづらい。

### After

`レポート確認 -> 送信 -> 失敗時の分岐 -> 共有履歴確認` が Student Room 内のブロックとしてつながり、shared までの導線が一本化される。

### UIブロック構成

1. `Header`
2. `Student Summary`
3. `Session Status Banner`
4. `Conversation Summary`
5. `Entity Check`
6. `Report Card`
7. `Delivery Status`
8. `Share History`
9. `Evidence Panel`
10. `Next Actions`

### 今回追加・変更すること

- [ ] [Student Room / Session Status Banner] `レビュー待ち / 送信可能 / 送信済み / 配達済み / 失敗 / 手動共有` を見えるようにする
- [ ] [Student Room / Report Card] レポートの確認状態と共有可否を同じ場所で表示する
- [ ] [Student Room / Entity Check] `entity pending` があると送信できない理由を明示する
- [ ] [Student Room / Delivery Status] `送信 / 再送 / 手動共有記録` をこのブロックで完結させる
- [ ] [Student Room / Delivery Status] 送信失敗時に `再送 / 宛先修正 / 手動共有` の3分岐を出す
- [ ] [Student Room / Share History] `送信済み / 配達済み / 失敗 / 手動共有` を時系列で見せる
- [ ] [Student Room / Evidence Panel] section単位で `どの会話ログ由来か` を最低限見せる
- [ ] [Student Room / Evidence Panel] `regenerate reason` と `manual edit 有無` を見せる
- [ ] [Student Room / Next Actions] 今の状態に応じた次の行動を1つだけ強く出す

### 状態一覧

- `処理中`
- `レビュー待ち`
- `送信可能`
- `送信済み`
- `配達済み`
- `失敗`
- `手動共有`

### エラー・空状態

- `entity pending`: 送信ボタンを無効化し、確認すべき固有名詞にスクロールできるようにする
- `guardian未設定`: 送信の代わりに `連絡先を設定する` を出す
- `送信失敗`: `再送 / 宛先修正 / 手動共有` を同じ場所で出す
- `共有履歴なし`: `まだ共有していません` と最初の送信導線を出す
- `根拠なし`: `根拠が弱い可能性があります` を warning で出す

### 完了条件

- [ ] Tutor が Student Room だけで共有完了まで進める
- [ ] 送信可能な状態なら 3 クリック以内で送信まで進める
- [ ] 送信失敗時に `再送 / 宛先修正 / 手動共有` の3分岐が必ず出る
- [ ] 共有状態を 3 秒以内に見分けられる

### 関連する基盤

- `ReportStatus`
- `ReportDelivery`
- `ReportDeliveryEvent`
- `GuardianContact`
- `AuditLog`
- `/api/reports/[id]/send`

## Dashboard

### 役割

教室長・管理者が、朝いちで止まりと要介入を見つける管理画面。

### 誰が使うか

Manager

### ファーストビュー

最上段に 4 つの KPI カードを並べ、その下に `止まっている対象一覧` が続く構成にする。

### 最初に取る行動

管理者はまず `review待ち件数` と `failed / bounced件数` を見て、最も危険なカードから drill-in する。

### Before

いまは「今日の優先キュー」はあるが、止まりの種類が広く、どれを最初に見るべきかがすぐ分からない。

### After

朝の判断に必要な 4 指標がファーストビューに固定され、1クリックで対象生徒や対象レポートへ降りられる。

### UIブロック構成

1. `Header`
2. `KPI Cards`
3. `Drill-in Table`
4. `Queue Summary`
5. `Quick Actions`

### 今回追加・変更すること

- [ ] [Dashboard / KPI Cards] 初版の指標を `review待ち件数 / blocked_by_entity件数 / 平均time-to-share / failed・bounced件数` の4つに絞る
- [ ] [Dashboard / KPI Cards] 危険度の高い順にカードの強弱を付ける
- [ ] [Dashboard / Drill-in Table] KPIカードを押すと対象の生徒・レポート一覧が出るようにする
- [ ] [Dashboard / Drill-in Table] `誰が / 何で / 何日止まっているか` を見せる
- [ ] [Dashboard / Queue Summary] 既存の優先キューは補助情報として下段に残す
- [ ] [Dashboard / Quick Actions] `招待` は補助面に下げて主役から外す

### 状態一覧

- `レビュー待ち`
- `固有名詞確認待ち`
- `共有遅延`
- `送信失敗`
- `配達失敗`

### エラー・空状態

- `止まりなし`: `今日は大きな滞留がありません` を出す
- `データ少ない`: onboarding 導線やデモデータ導線を出す
- `集計失敗`: `再読み込み` と fallback テキストを出す

### 完了条件

- [ ] Manager が 5 秒以内に `review待ち件数` と `failed件数` を視認できる
- [ ] 最重要カードから 1 クリックで対象一覧に進める
- [ ] 朝見れば何が止まっているか迷わない

### 関連する基盤

- `ReportStatus`
- `SessionStatus`
- `ReportDeliveryEvent`
- `enteredAt / time-to-share`
- dashboard 集計 route

## Reports

### 役割

レポート一覧と検索のための補助画面。

### 誰が使うか

Tutor / Manager

### ファーストビュー

検索条件と状態フィルタ、その下にレポート一覧が見える構成にする。

### 最初に取る行動

ユーザーは `失敗` や `共有済み` などの状態で絞り込み、対象レポートを開く。

### Before

状態表示が新しい運用モデルに追いつかず、一覧から shared の進み具合を読み取りにくい。

### After

レポートはここで作業するのではなく、状態確認と検索に使う画面として整理される。

### UIブロック構成

1. `Header`
2. `Filters`
3. `Report List`
4. `Status Chips`
5. `Open in Student Room`

### 今回追加・変更すること

- [ ] [Reports / Filters] `レビュー待ち / 送信済み / 配達済み / 失敗 / 手動共有` で絞れるようにする
- [ ] [Reports / Report List] 共有状態を新定義に合わせて表示する
- [ ] [Reports / Open in Student Room] 主作業は Student Room へ戻す導線を強くする

### 状態一覧

- `レビュー待ち`
- `送信可能`
- `送信済み`
- `配達済み`
- `失敗`
- `手動共有`

### エラー・空状態

- `該当なし`: 条件に合うレポートがないことを明示する
- `データなし`: まず Student Room でレポート作成を促す

### 完了条件

- [ ] レポート一覧で shared の進み具合を誤解なく見られる
- [ ] 主作業をここで始めず、必要時に Student Room へ戻れる

### 関連する基盤

- `ReportStatus`
- `ReportDeliveryEvent`

## Logs

### 役割

会話ログの参照と根拠確認のための補助画面。

### 誰が使うか

Tutor / Manager

### ファーストビュー

会話の要点、entity状態、関連レポートへの導線がすぐ見える構成にする。

### 最初に取る行動

ユーザーは `このログが何に使われたか` と `どこが弱いか` を確認する。

### Before

会話ログは見られるが、レポート根拠や regenerate 理由とのつながりが弱い。

### After

Logs は「ただ読む画面」ではなく、`なぜこのレポートになったか` を補助的に確認する画面になる。

### UIブロック構成

1. `Header`
2. `Conversation Summary`
3. `Entity Status`
4. `Evidence Links`
5. `Regenerate Info`
6. `Open Related Report`

### 今回追加・変更すること

- [ ] [Logs / Evidence Links] 関連レポートと根拠のつながりを見やすくする
- [ ] [Logs / Regenerate Info] `regenerate reason` と `manual edit 有無` を見られるようにする
- [ ] [Logs / Entity Status] `entity pending` や `low evidence` を読みやすくする

### 状態一覧

- `要点あり`
- `entity確認待ち`
- `根拠弱め`
- `再生成あり`

### エラー・空状態

- `ログなし`: まだ会話ログがないことを明示する
- `根拠リンクなし`: まだレポートへ使われていないことを示す

### 完了条件

- [ ] `なぜこのレポートになったか` を補助画面として十分追える
- [ ] 主導線を Logs に戻さずに済む

### 関連する基盤

- `ConversationLog`
- `AuditLog`
- `sourceConversationLogIds`

## Settings / Admin

### 役割

共有運用を安全に始めるための管理画面。

### 誰が使うか

Manager / Admin

### ファーストビュー

`連絡先設定 / 送信設定 / 権限 / 保存方針` の4ブロックが最初に見える構成にする。

### 最初に取る行動

管理者は `guardian 連絡先` と `メール送信設定` が整っているかを確認する。

### Before

guardian 連絡先、Webhook、権限、保存方針がまだ運用画面として揃っていない。

### After

「共有を始めてよいか」をこの画面で判断できるようになる。

### UIブロック構成

1. `Header`
2. `Guardian Contacts`
3. `Sending Config`
4. `Role Permissions`
5. `Consent & Retention`
6. `Webhook Health`

### 今回追加・変更すること

- [ ] [Settings / Guardian Contacts] guardian 連絡先の最小管理 UI を作る
- [ ] [Settings / Sending Config] メール送信設定を確認できるようにする
- [ ] [Settings / Webhook Health] Webhook 署名検証の状態を見えるようにする
- [ ] [Settings / Role Permissions] `誰がレビュー / 送信 / override できるか` を見直す
- [ ] [Settings / Consent & Retention] consent / notice / 保存期間の最低限を見える化する

### 状態一覧

- `設定済み`
- `未設定`
- `要確認`
- `エラー`

### エラー・空状態

- `連絡先なし`: Student Room から設定へ戻す導線を出す
- `Webhook異常`: 再確認手順を出す
- `権限不足`: 誰に依頼すべきかを出す

### 完了条件

- [ ] Manager が共有運用を始める条件をこの画面で確認できる
- [ ] Student Room の送信ブロックがこの画面の設定不足で止まる場合、戻り先が明確になる

### 関連する基盤

- `GuardianContact`
- `UserRole`
- `AuditLog`
- retention 方針

## 共通基盤

### 役割

全画面が同じ意味で動くための土台。

### 誰が使うか

画面としては見えないが、効く先は Student Room / Dashboard / Reports / Logs / Settings の全部。

### Before

状態名、shared 定義、根拠、Delivery、監査、保存方針がまだ画面単位で完全には揃っていない。

### After

UI表示、KPI、送信履歴、監査線が同じ state 定義で動く。

### 今回追加・変更すること

- [ ] [共通基盤 / State] `reviewed / shared / sent / delivered / manually_confirmed / failed / bounced` の定義を固定する
- [ ] [共通基盤 / State] `ReportStatus` と `Delivery event` を UI 表示名に合わせて再設計する
- [ ] [共通基盤 / Time] `enteredAt` 相当と `time-to-share` を計測できるようにする
- [ ] [共通基盤 / Evidence] section 単位の `sourceConversationLogIds` を持たせる
- [ ] [共通基盤 / Evidence] `sourceSpans` は後回しにする
- [ ] [共通基盤 / Audit] `reviewer / sender / override actor / regenerate reason` を残す
- [ ] [共通基盤 / Trust] guardian 連絡先、保存期間、Webhook 署名検証、role 制御の最小版を入れる

### 状態一覧

- `レビュー待ち`
- `送信可能`
- `送信済み`
- `配達済み`
- `失敗`
- `手動共有`

### エラー・空状態

- `状態未定義`: UI に出す状態名を増やさない
- `Delivery event 不足`: Dashboard と Student Room の表示差を出さない

### 完了条件

- [ ] Student Room と Dashboard が同じ state 定義で動く
- [ ] shared 率と time-to-share を同じルールで計測できる
- [ ] 根拠と監査線を最低限辿れる

### 関連する基盤

- `prisma/schema.prisma`
- `AuditLog`
- `ReportStatus`
- `ReportDeliveryEvent`

## 5. P0

### P0 / 共通基盤

- [ ] [共通基盤 / State] `shared / sent / delivered / manually_confirmed` を固定する
- [ ] [共通基盤 / Source Of Truth] `Session / ConversationLog / Report / Delivery / Risk` の責務を固定する
- [ ] [共通基盤 / State] `ReportStatus` を UI 表示に合わせて再設計する
- [ ] [共通基盤 / Time] `time-to-share` を計測できるようにする
- [ ] [共通基盤 / Evidence] `sourceConversationLogIds` と `regenerate reason` を持たせる
- [ ] [共通基盤 / Audit] reviewer / sender / override actor を残す
- [ ] [共通基盤 / Trust] guardian 連絡先、保存期間、Webhook 署名検証、role 制御の最小版を入れる

### P0 / Student Room

- [ ] [Student Room / Session Status Banner] 共有状態を新表示へ統一する
- [ ] [Student Room / Report Card] `送信可能かどうか` を見えるようにする
- [ ] [Student Room / Delivery Status] `送信 / 再送 / 手動共有記録` を完結させる
- [ ] [Student Room / Delivery Status] 失敗時の3分岐を出す
- [ ] [Student Room / Share History] 最小の共有履歴を出す
- [ ] [Student Room / Evidence Panel] section単位の根拠を出す

### P0 / Dashboard

- [ ] [Dashboard / KPI Cards] `review待ち件数` を出す
- [ ] [Dashboard / KPI Cards] `blocked_by_entity件数` を出す
- [ ] [Dashboard / KPI Cards] `平均time-to-share` を出す
- [ ] [Dashboard / KPI Cards] `failed / bounced件数` を出す
- [ ] [Dashboard / Drill-in Table] KPI から対象一覧へ降りられるようにする

### P0 / Settings / Admin

- [ ] [Settings / Guardian Contacts] 連絡先管理を作る
- [ ] [Settings / Sending Config] メール送信設定を出す
- [ ] [Settings / Webhook Health] Webhook 状態を出す
- [ ] [Settings / Role Permissions] role と override を見直す
- [ ] [Settings / Consent & Retention] 最低限の trust 情報を出す

## 6. P1

### P1 / Student Room

- [ ] [Student Room / Share History] delivery timeline を強化する
- [ ] [Student Room / Evidence Panel] `sourceSpans` を使った根拠表示へ拡張する
- [ ] [Student Room / Next Actions] 前回共有内容と今回共有内容をつなぐ

### P1 / Dashboard

- [ ] [Dashboard / Today’s Stuck] 正式ブロック化する
- [ ] [Dashboard / Today’s Risk] 共有遅延と面談空白を見る
- [ ] [Dashboard / Tutor Quality] reviewed率、regenerate率、manual edit率を見る
- [ ] [Dashboard / Guardian Delivery] sent率、delivered率、failed率を見る

### P1 / 補助画面

- [ ] [Reports / Filters] 共有状態と失敗状態で検索しやすくする
- [ ] [Reports / Report List] 新状態表示へ寄せる
- [ ] [Logs / Evidence Links] 根拠参照を見やすくする
- [ ] [Logs / Regenerate Info] regenerate 理由を見やすくする

### P1 / 共通基盤

- [ ] [共通基盤 / Activation] 初回セットアップウィザードを整える
- [ ] [共通基盤 / Activation] デモデータ導線を整える
- [ ] [共通基盤 / Audit] audit export の要否を決める
- [ ] [共通基盤 / Trust] retention と deletion request を正式化する

## 7. P2

- [ ] [後回し / Dashboard] Campus 比較を追加する
- [ ] [後回し / 共通基盤] Campus 正規モデルを作る
- [ ] [後回し / Dashboard] 週次レビュー card / reminder / digest を整える
- [ ] [後回し / Settings] LINE 第二チャネルを追加する

## 8. 依存関係

- [ ] [共通基盤 / State] `shared / sent / delivered` 定義の固定が先。これがないと Student Room と Dashboard の数字が揃わない
- [ ] [共通基盤 / State] `ReportStatus` 再設計が先。これがないと Reports と Student Room の表示が揃わない
- [ ] [Settings / Guardian Contacts] 連絡先管理が先。これがないと Student Room の送信導線が閉じない
- [ ] [共通基盤 / Delivery] `ReportDeliveryEvent` が先。これがないと Dashboard で failed / bounced を出せない
- [ ] [共通基盤 / Audit] `AuditLog` 拡張が先。これがないと override や manual share を追えない
- [ ] [Settings / Webhook Health] 署名検証が先。これがないと本番で delivery event を信頼できない

## 9. 実装順

1. [ ] [共通基盤 / State] `Teaching OS` 定義、North Star、Activation を固定する
2. [ ] [共通基盤 / State] `shared / sent / delivered / manually_confirmed` を固定する
3. [ ] [共通基盤 / Source Of Truth] `Session / ConversationLog / Report / Delivery / Risk` を固める
4. [ ] [共通基盤 / Evidence・Audit・Trust] 最小版を入れる
5. [ ] [Settings / Guardian Contacts・Sending Config・Webhook Health] 最小版を入れる
6. [ ] [Student Room / Delivery Status・Share History] shared まで 1 画面で閉じる
7. [ ] [Dashboard / KPI Cards・Drill-in Table] 4 指標の初版を出す
8. [ ] [Student Room / Share History・Evidence Panel] 共有履歴と根拠を強める
9. [ ] [Dashboard / Today’s Risk・Tutor Quality・Guardian Delivery] 管理画面を広げる
10. [ ] [共通基盤 / Activation・Retention] 本設計に進む
11. [ ] [Reports / Logs] 新状態に合わせる
12. [ ] [後回し] Campus / LINE / 週次レビューへ進む

## 10. 画面別サマリー表

| 画面 | 誰が使うか | この画面でやること | 今回増えるUIブロック | 重要操作 | 見るべき状態 | P0完了条件 |
| --- | --- | --- | --- | --- | --- | --- |
| Student Room | Tutor | 会話確認から共有完了までを閉じる | Session Status Banner, Delivery Status, Share History, Evidence Panel, Next Actions | 送信, 再送, 手動共有, entity確認 | レビュー待ち, 送信可能, 送信済み, 配達済み, 失敗, 手動共有 | Student Room だけで shared まで完了できる |
| Dashboard | Manager | 朝の止まりを見つけて対象へ降りる | KPI Cards, Drill-in Table | KPI確認, drill-in | レビュー待ち, 固有名詞確認待ち, 共有遅延, 送信失敗 | 5秒以内に止まりを認識できる |
| Reports | Tutor / Manager | レポート状態を検索・参照する | Filters, Status Chips, Open in Student Room | 状態で絞る, Student Roomへ戻る | 送信済み, 配達済み, 失敗, 手動共有 | 新状態で一覧を誤解なく読める |
| Logs | Tutor / Manager | 会話ログの根拠と再生成理由を参照する | Evidence Links, Regenerate Info | 根拠確認, 関連レポートへ移動 | entity確認待ち, 根拠弱め, 再生成あり | レポート根拠を補助面として追える |
| Settings / Admin | Manager / Admin | 共有運用を安全に始める | Guardian Contacts, Sending Config, Role Permissions, Consent & Retention, Webhook Health | 連絡先設定, 権限確認, Webhook確認 | 設定済み, 未設定, 要確認, エラー | 共有運用に必要な設定をここで確認できる |
| 共通基盤 | 全画面に効く | 状態、Delivery、Audit、Trust を揃える | 画面追加ではなく全画面の表示を統一する土台 | state定義, time計測, event保存 | レビュー待ち, 送信可能, 送信済み, 配達済み, 失敗, 手動共有 | 全画面が同じ意味で動く |

この文書を見れば、ルウクがどの画面のどのブロックを、どの順で作るか一目で分かる状態にする。
