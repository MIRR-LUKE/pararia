# Teacher App の未送信キューと復旧導線を作る: 再送 / 二重送信防止 / 再起動耐性

## 状態

- Closed
- GitHub Issue: `#163`
- 最終更新: `2026-04-19`

## この issue で完了したこと

- IndexedDB を使う `pending-upload-store` を追加し、未送信音声を端末内に永続化できるようにした
- IndexedDB が使えない環境でも動線が切れないように memory fallback を入れた
- 待機画面から未送信一覧へ入り、`再送 / 削除` を選べる UI を実装した
- upload failure 時は音声ファイルと録音メタを pending item として保存し、再送時は同じ `recordingId` を使ってアップロードをやり直すようにした
- `/api/teacher/recordings/[id]/audio` に `Idempotency-Key` を入れ、同じ録音の二重送信を replay / pending conflict として扱えるようにした
- pending item 削除時は可能なら server 側の temporary recording を cancel し、ローカル queue からも外すようにした

## これで強くなったケース

- upload failure 後に未送信一覧から再送できる
- app 再起動後も未送信 item が残る
- 同じ録音を二重に送っても session / conversation が壊れにくい
- 先生には複雑な説明を見せず、やることを `再送` に寄せられる

## この issue に含めなかったこと

- OS の background sync や push 通知は入れていない
- queue の server-side dashboard は管理 web の別 issue に切る

## 検証

- `npm run typecheck`
- `npm run test:migration-safety`
