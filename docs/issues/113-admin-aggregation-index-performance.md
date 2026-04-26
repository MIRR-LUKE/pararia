# admin dashboard の集計テーブル・インデックス・性能テストを追加する

## 状態

- In Progress
- GitHub Issue: `#216`
- 作成日: `2026-04-26`

## 目的

何百校舎に増えても `/admin` が重くならないよう、集計・インデックス・ページング・性能確認を入れる。

## 背景

platform admin は横断検索と横断ヘルスを扱うため、素朴に全テーブルを count / join するとすぐ重くなる。初期から性能の逃げ道を作る。

## やること

- 校舎一覧に必要な集計項目を整理する
- 必要な DB index を追加する
- 重い集計は snapshot / materialized summary 相当に分離する
- admin list API に limit / cursor を入れる
- admin dashboard 用の性能テストまたは smoke を追加する
- N+1 query を避ける

## 完了条件

- 何百校舎前提で一覧が破綻しない
- 横断一覧 API がページングされている
- 必要な index が schema に明示されている
- performance smoke で初期表示の劣化を検知できる
