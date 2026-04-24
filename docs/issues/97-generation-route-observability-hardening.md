# generate-report 主経路に stage / operationId / failure taxonomy を入れて調査コストを下げる

## 状態

- Closed
- GitHub Issue: `#174`
- 最終更新: `2026-04-24`

## 進捗

- `POST /api/ai/generate-report` に `stage / operationId / reason` を返す failure shape を入れた
- success response でも `operationId` と `stage: persist_report` を返すようにした
- `GET /api/reports/[id]` と `GET /api/students/[id]/room` も同じ observability helper の語彙に寄せた
- `report generated but audit log failed` と `revalidate failed` は warning log に落として main flow を守るようにした
- `scripts/test-report-generation-route.ts` に success だけでなく error-contract smoke を追加した

## 残り

- `Generation Route Smoke` workflow が PR / merge queue / main push でこの新しい error-contract smoke を踏むことの確認
- 必要なら UI 側に `operationId` を見せるかどうかの判断

## 何をするか

`#80` で `generate-report -> 保存 -> /api/reports/[id] -> student room` の smoke は CI 必須になった。  
次は、本番や preview でこの主経路が失敗したときに、**どの段階で壊れたかを即座に切り分けられるようにする**。

対象は少なくとも次の経路:

- `POST /api/ai/generate-report`
- `GET /api/reports/[id]`
- `GET /api/students/[id]/room`
- report persistence / latest report aggregation に関わる service / helper

## なぜやるか

いまは CI で regression を止められる一方で、実運用での失敗はまだ調査コストが高い。

- `generate-report` のどこで落ちたかが response だけだと見えにくい
- report 保存は成功したが room 反映で落ちたのか、最初から artifact validation で落ちたのかが分かりにくい
- UI 側のエラーと server log を 1 本の識別子で結びにくい
- 失敗した route が増えるほど、再現と切り分けの時間が膨らむ

`#80` が「main に壊れたものを入りにくくする」ためのガードなら、この issue は「壊れたときに数分で原因の場所まで寄れる」ための仕上げ。

## やること

- route / service 共通で使える軽い operation context helper を用意する
- `operationId`, `route`, `stage`, `reason` を最小共通の failure shape として定義する
- `generate-report` 主経路の主要 stage を列挙して固定する
  - `validate_input`
  - `load_selected_logs`
  - `validate_artifact`
  - `build_report`
  - `persist_report`
  - `load_report_detail`
  - `load_student_room`
- user-facing 日本語 message は保ちつつ、debug 用 metadata は response と server log に同じ値で残す
- server log は `operationId` で grep できる形にそろえる
- smoke / integration test で failure shape の regression を止める

## 完了条件

- `generate-report` 主経路の失敗で stage が分かる
- UI / route response / server log を同じ `operationId` で結びつけられる
- CI failure と本番 failure の切り分け語彙がそろう
- `処理に失敗しました` だけでは終わらない

## この issue の外に残すもの

- audit など noncritical side effect の best-effort 化
- Runpod worker 側の phase observability parity
- Sentry など外部基盤の導入判断

## ラベル

- `backend`
- `quality`
- `ops`
- `observability`
- `priority:high`
