# Teacher Recording State Machine

Teacher App 録音の通常フローは、backend 側で次の状態遷移だけを許可する。

```txt
RECORDING
↓
TRANSCRIBING
↓
AWAITING_STUDENT_CONFIRMATION
↓
STUDENT_CONFIRMED
```

許可する例外は次の通り。

```txt
RECORDING -> CANCELLED
TRANSCRIBING -> ERROR
AWAITING_STUDENT_CONFIRMATION -> ERROR
```

`STUDENT_CONFIRMED`、`CANCELLED`、`ERROR` は終端状態として扱う。これらの状態から録音アップロード、STT完了、生徒確定、キャンセルなどの通常フローに戻してはいけない。

実装上は `lib/teacher-app/server/recording-status.ts` の `updateTeacherRecordingStatus` を使い、更新時に現在状態も `where` 条件へ含める。これにより、同じ録音に対する再送や遅延jobが来ても、確定済み録音を `TRANSCRIBING` に戻したり、キャンセル済み録音をアップロード済みにしたりしない。
