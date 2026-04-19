# Teacher App を内部配布して実機 QA を回せるようにする

## 状態

- Open
- GitHub Issue: `#167`
- 最終更新: `2026-04-19`

## 目的

実装が入っても、端末に入れて回せなければ意味がない。  
TestFlight と Play Internal Testing で **校舎テストに出せる状態** まで持っていく。

## 親 issue

- `#171` / `93` Teacher 録音 app を完全ネイティブ前提で作り直す全体計画

## この issue でやること

- iOS は TestFlight、Android は Play Internal Testing で内部配布できる手順を作る
- 校舎責任者向けの初期設定手順を doc 化する
- 実機 QA チェックリストを作る
- 対象端末、OS version、iPhone / Android 差分を表にする
- microphone permission、端末ログイン、録音、未送信再送、logout の確認項目をそろえる
- 現場から返ってくる不具合の報告テンプレートを作る

## 今回のゴール

- 公開ストア審査ではなく **内部テスト運用** を回せること
- 実機で main flow を繰り返し確認できること

## 完了条件

- iOS / Android の内部配布ビルドを責任者へ渡せる
- セットアップ手順と QA 手順が 1 つの文書群で追える
- 現場で詰まりやすい確認項目が事前に潰されている
