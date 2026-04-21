# Runpod UX 計測を p50 / p95 / cost までまとめて見えるようにする

## 状態

- Closed
- GitHub Issue: `#156`
- 最終更新: `2026-04-18`

## 何をするか

Runpod UX 計測 JSON を、profile / startup mode / GPU / image ごとに集約し、pod ready、queue-to-STT、conversation 完了、cache hit、cost の分位を一目で比べられるようにする。

## なぜやるか

単発の JSON を見ても、cold/warm や image 差分の傾向がつかみにくい。

本当に運用判断に使うには、p50 だけでなく p95 と cost まで並べて比較できる必要がある。

## やること

- Runpod UX 計測に STT subphase と LLM token / cache / cost を入れる
- 集計スクリプトで p50 / p95 を markdown table に出す
- README と worker ドキュメントに集計コマンドを書く

## 完了条件

- 計測 JSON に phase 別時間と cost が入る
- 集計コマンドで markdown summary が出る
- ドキュメントを見れば運用手順が分かる
