# audit などの非本質 side effect を main flow から切り離す

## 状態

- Open
- GitHub Issue: `#83`
- 最終更新: `2026-04-14`

## 何をするか

archive、restore、report send、settings update などの本処理に対して、audit log や補助書き込みが失敗しても main flow を巻き込まないようにする。

## なぜやるか

本体処理は成功しているのに audit のような補助処理で API 全体が 500 になると、ユーザーから見ると「失敗したように見える」うえ、再試行で二重操作の不安も生む。

## やること

- audit log を safe wrapper 経由で書く
- 既存 route の `writeAuditLog` 呼び出しを best-effort 化する
- force release など service 側の補助書き込みも切り離す
- 失敗時は server log にだけ残し、main response は守る

## 完了条件

- 補助 side effect の失敗で主処理が 500 にならない
- route ごとの try/catch の書き方が揃う
- archive / restore / report / settings 系の挙動が安定する

## ラベル

- `backend`
- `ops`
- `quality`
- `priority:high`
