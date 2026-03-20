# Recording validation

`POST /api/sessions/:id/parts` で適用されます。

| ゲート | タイミング | 失敗時 HTTP | `code` |
|--------|------------|-------------|--------|
| A 長さ | 音声ファイル:**STT 前**（`music-metadata` で duration） | 422 | `recording_too_short` / `duration_unknown` |
| B 内容 | STT 後または手入力テキスト後:**パート保存前** | 422 | `thin_transcript` |

成功時のみ `SessionPart` は `READY`、ゲート B 失敗時は `ERROR` で保存され `qualityMetaJson.validationRejection` に詳細が入ります。

環境変数: ルートの `.env.example` 参照。

## 録音ロック（マルチユーザー）

- **取得**: `POST /api/students/:studentId/recording-lock`（body: `{ "mode": "INTERVIEW" | "LESSON_REPORT" }`）→ `lockToken`
- **heartbeat**: `PATCH` 同 URL（body: `{ lockToken }`）— クライアントは約 10 秒間隔
- **解放**: 音声 `POST /api/sessions/:id/parts` 完了時にサーバが自動解放。異常時は `DELETE`（body: `{ lockToken }`）または管理者の強制解放（`POST` + `{ forceRelease: true }`）
- **parts**: 音声アップロード時は FormData に `lockToken` 必須。手入力テキストのみは不要。

設計意図: `docs/recording-validation-multiuser-org-design.md`
