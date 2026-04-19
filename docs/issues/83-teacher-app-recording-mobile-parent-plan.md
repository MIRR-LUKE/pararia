# Teacher App を録音専用 mobile app として分離する親 Issue を前に進める

## 状態

- Open
- GitHub Issue: `#164`
- 最終更新: `2026-04-19`

## フェーズ

- Phase 1-2

## 目的

先生向けの録音導線を既存 web から分離し、校舎共通端末で使う録音専用 mobile app として成立させる。先生に求める行動を `録る / 終える / 確認する / 送る` の4つに絞り、既存 backend の価値を壊さずに現場運用へ乗せる。

## 何をするか

- Teacher App と Admin Web の責務を明確に分ける
- mobile auth / device registration / mobile API surface を作る
- 録音前の生徒選択をやめ、録音後の候補確認へ寄せる
- temporary session を導入し、生徒確定後に正式なログ生成へ進める
- 未送信一覧 / 再送 / 再起動復旧まで含めて main flow を安定させる
- 仮 UI を screen container / presentational component 分離で先に実装する

## 子 Issue

- `#161` / `84` Teacher App の土台を作る: app 分離 / mobile auth / 校舎共通端末登録
- `#160` / `85` Teacher App の録音主導線を作る: 待機 / 録音中 / 解析中 / temporary session
- `#162` / `86` Teacher App の生徒確認導線を作る: 候補サジェスト / 確定 / 本ログ生成トリガー
- `#163` / `87` Teacher App の未送信キューと復旧導線を作る: 再送 / 二重送信防止 / 再起動耐性

## 進捗メモ

- `#161` は着手済み。`/teacher` route group、`/teacher/setup`、Teacher App 専用 auth API、device session cookie、provisional shell を追加した
- `#160` は次の本線。MediaRecorder 導線、temporary session、upload 開始、解析中画面の実接続をここで入れる
- `#162` は domain contract を切り出して進める。生徒候補抽出、confirm 画面の実データ接続、本ログ生成トリガーをここへ寄せる
- `#163` は recovery 専用のまとまりとして維持する。pending queue、replay、idempotency、再起動復元を main flow から独立して詰める

## 完了条件

- 先生が通常利用時にログインせず、待機画面から即録音開始できる
- 録音前に生徒一覧を開かず、録音後に候補確認だけで進められる
- 生徒確定前に本ログ生成が走らない
- 通信断 / upload failure / app 再起動後も未送信を戻せる
- 仮 UI のまま内部テストに使え、後から Figma 差し替えで logic を書き直さなくて済む
