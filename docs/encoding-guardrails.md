# UTF-8 Guardrails

PARARIA では、日本語テキストと GitHub issue コメントを UTF-8 前提で扱う。

## ルール
- PowerShell で日本語を扱う前に `scripts/Enable-Utf8.ps1` を実行する
- VS Code では、この workspace の既定 terminal と file encoding を UTF-8 に固定する
- Windows の CurrentUserAllHosts profile に UTF-8 guardrails を入れて、repo 外の PowerShell セッションでも既定を UTF-8 に寄せる
- GitHub issue コメント本文は、PowerShell の here-string に直書きしない
- issue コメントは UTF-8 の `.md` ファイルに保存し、`scripts/Update-GitHubIssueComment.ps1` から送る
- PowerShell のダブルクオート here-string にバッククォート付きテキストを書かない
- 日本語ファイルを確認するときは `Get-Content -Encoding utf8` を使う

## NG
- `@" ... "@` の中に Markdown のバッククオート付き日本語を入れて、そのまま API に投げる
- 既定コードページ 932 のまま issue コメントを送る

## OK
- `. .\\scripts\\Enable-Utf8.ps1`
- `Get-Content -Encoding utf8 README.md`
- `.\scripts\Update-GitHubIssueComment.ps1 -CommentId 123 -BodyFilePath .\tmp\comment.md`

## 補足
- `.editorconfig` で UTF-8 を既定にしている
- `.gitattributes` で主要テキスト拡張子を UTF-8 前提に固定している
- `.vscode/settings.json` で、この repo を開いたときの terminal を `PowerShell (UTF-8)` に固定している
- `C:\Users\lukew\Documents\WindowsPowerShell\profile.ps1` と `C:\Users\lukew\Documents\PowerShell\profile.ps1` に UTF-8 の default 設定を入れている
