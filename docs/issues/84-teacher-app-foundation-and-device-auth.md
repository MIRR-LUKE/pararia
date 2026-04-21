# Teacher App の土台を作る: app 分離 / mobile auth / 校舎共通端末登録

## 状態

- Closed
- GitHub Issue: `#161`
- 最終更新: `2026-04-19`

## この issue で完了したこと

- `/teacher` と `/teacher/setup` を route group で分離した
- `app/api/teacher/auth/device-login`、`/session`、`/logout` を追加し、Teacher App 専用の認証面を切った
- `TeacherAppDevice` を追加し、端末名を organization 単位で永続化できるようにした
- Teacher App の session token に `deviceId` を入れ、cookie / bearer token の両方で登録済み端末かどうかを検証するようにした
- `TeacherAppClient`、screen components、flow hook を分け、後から Figma に差し替えやすい provisional UI の境界を作った
- 管理者または室長だけが端末設定できる role guard を維持した

## これで満たした条件

- 初回だけ管理者がログインして端末登録できる
- 通常利用時は待機画面から始まり、先生にログインを要求しない
- mobile API が `organization / user / device` を追える形になった
- 画面ロジックが UI 実装から分離され、view 差し替えしやすい
- Teacher App 側に管理者向け一覧 / 設定 / 詳細導線を混ぜていない

## この issue に含めなかったこと

- 端末 revoke UI や device inventory 画面は管理 web の別 issue に切る
- bearer token の refresh endpoint は今回追加しない。180 日 TTL の signed session を Teacher App の現行契約とする

## 検証

- `npm run prisma:generate`
- `npm run typecheck`
- `npm run test:migration-safety`
- `npm run test:teacher-app-device-auth`
