# ログ生成の retry と next meeting memo を prompt cache 前提で安定させる

## 状態

- Closed
- GitHub Issue: `#154`
- 最終更新: `2026-04-18`

## 何をするか

面談ログ生成の retry / repair で prompt cache の prefix を崩さないようにし、next meeting memo でも prompt cache key と retention を持てるようにする。

## なぜやるか

system prompt を retry ごとに作り直すと cache hit が落ち、同じ失敗対応でもコストと待ち時間がぶれる。

next meeting memo も毎回同じ骨格を使うため、cache を使わない理由がない。

## やること

- retry 時も元の system prompt を固定する
- 修復指示は後続 user message に寄せる
- next meeting memo に prompt cache key / retention を入れる
- job meta に cache 情報を残せるようにする

## 完了条件

- retry でも cache prefix が安定する
- next meeting memo で cache 設定を持てる
- 実行結果から cache 設定を追える
