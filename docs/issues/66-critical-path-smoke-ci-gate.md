# 面談 -> 保護者レポートまで含む generation smoke を CI で止める

## 状態

- 実装済み
- GitHub Issue: `#80`
- 最終更新: `2026-04-21`

## 何をするか

面談ログが保存されてから保護者レポートが生成・取得できるまでの最小経路を CI で実行し、生成主経路の破壊を PR 時点で止める。

## なぜやるか

既存の `Conversation Quality` は artifact 契約と保全テストには効くが、`generate-report` route と保存反映を通した E2E までは 1 本の smoke として拾っていない。

このままだと、

- 選択済みログからの保護者レポート生成が route 層で壊れても CI で遅れて気づく
- `student room` 側の最新レポート反映まで含めた regression が main に入る
- UI で最初に見える `保護者レポートの生成に失敗しました` まで気づけない

が残る。

## いま既に入っていること

- `Critical Path Smoke` workflow は `録音ロック -> student room -> session progress -> next meeting memo` を route smoke として回している
- `Conversation Quality` workflow は `npm run test:generation-preservation` で面談ログ / 保護者レポートの契約回帰を回している

## 今回入ったもの

- `generate-report` を含む generation smoke script を追加した
- 選択済みログ fixture から保護者レポートを生成し、保存後の取得と student room 反映まで確認するようにした
- `Generation Route Smoke` workflow を追加し、毎 PR / merge queue / main push で回すようにした
- `select logs / validate artifact / generate report / persist report / fetch report` のどこで落ちたか分かる出力にした
- GitHub の `main` branch protection に `conversation-quality`, `critical-path-smoke`, `generation-route-smoke`, `backend-scope-guard` を required status checks として設定した

## 完了条件

- 面談 -> 保護者レポート生成までの最小回帰が PR 時点で止まる
- 失敗した段階がログから分かる
- main へ入る前に report generation route と保存反映の破壊を検知できる

## この issue の外に残ること

- route 失敗に `stage / operationId` を統一して載せる observability 強化

## ラベル

- `backend`
- `quality`
- `tooling`
- `ci`
- `priority:high`
