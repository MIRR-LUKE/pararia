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

- `#161` は土台として成立した。`/teacher` route group、`/teacher/setup`、Teacher App 専用 auth API、device session cookie、provisional shell までつながった
- `#160` は main flow 完了。MediaRecorder、temporary recording session、音声 upload、解析中 progress、cancel、active recording 復元まで入り、残りは `#162` と `#163` に寄せた
- `#162` は部分着手済み。文字起こしからの生徒候補抽出、候補確認画面、`該当なし`、`selectedStudentId / confirmedAt` の保存までは入った
- 残りの本線は、生徒確定後の正式 `Session / SessionPart / Conversation` 昇格と、`#163` の未送信 queue / 再送 / 再起動復旧

## 完了条件

- 先生が通常利用時にログインせず、待機画面から即録音開始できる
- 録音前に生徒一覧を開かず、録音後に候補確認だけで進められる
- 生徒確定前に本ログ生成が走らない
- 通信断 / upload failure / app 再起動後も未送信を戻せる
- 仮 UI のまま内部テストに使え、後から Figma 差し替えで logic を書き直さなくて済む
