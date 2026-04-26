# Teacher App Native Auth Contract

更新日: `2026-04-26`

## 目的

Teacher 録音 native app が backend に入るための auth / recording 契約を明文化する。録音の作成、upload、進捗確認、確定は native app 専用で、Web からの録音導線は持たない。

## 認証モデル

- native app は **bearer access token + stateful refresh token** を使う
- access token は短命で、署名付き token
- refresh token は opaque token で、server 側に hash を保存する
- refresh token は rotate する
- logout で auth session を revoke する
- Web `/teacher` と `/teacher/setup` は native app 専用案内だけを表示する
- `POST /api/teacher/auth/device-login` は `410 Gone` を返し、Web cookie session の新規発行はしない
- 録音系 endpoint は bearer token 認証だけを受け付け、cookie session では `410 Gone` を返す

## native auth endpoints

### `POST /api/teacher/native/auth/device-login`

校舎責任者が端末を初期設定するときに使う。

request:

```json
{
  "email": "admin@example.com",
  "password": "********",
  "deviceLabel": "渋谷校 Android 端末 01",
  "client": {
    "platform": "ANDROID",
    "appVersion": "1.0.0",
    "buildNumber": "100"
  }
}
```

response:

```json
{
  "session": {
    "userId": "user_x",
    "organizationId": "org_x",
    "deviceId": "device_x",
    "role": "ADMIN",
    "roleLabel": "管理者",
    "userName": "校舎責任者",
    "userEmail": "admin@example.com",
    "deviceLabel": "渋谷校 Android 端末 01",
    "issuedAt": "2026-04-19T11:00:00.000Z",
    "expiresAt": "2026-04-19T11:30:00.000Z"
  },
  "client": {
    "platform": "ANDROID",
    "appVersion": "1.0.0",
    "buildNumber": "100"
  },
  "auth": {
    "accessToken": "....",
    "accessTokenExpiresAt": "2026-04-19T11:30:00.000Z",
    "refreshToken": "....",
    "refreshTokenExpiresAt": "2026-10-16T11:00:00.000Z",
    "authSessionId": "auth_x",
    "tokenType": "Bearer"
  }
}
```

### `POST /api/teacher/native/auth/refresh`

request:

```json
{
  "refreshToken": "....",
  "client": {
    "platform": "ANDROID",
    "appVersion": "1.0.1",
    "buildNumber": "101"
  }
}
```

response は login と同じ shape。  
refresh token は rotate される。

### `GET /api/teacher/native/auth/session`

header:

```txt
Authorization: Bearer <accessToken>
```

response:

```json
{
  "session": { "...": "..." },
  "client": {
    "platform": "ANDROID",
    "appVersion": "1.0.0",
    "buildNumber": "100"
  },
  "auth": {
    "authSessionId": "auth_x",
    "accessTokenExpiresAt": "2026-04-19T11:30:00.000Z",
    "tokenType": "Bearer"
  }
}
```

### `POST /api/teacher/native/auth/logout`

header:

```txt
Authorization: Bearer <accessToken>
```

response:

```json
{
  "ok": true
}
```

logout は bearer auth session を revoke し、端末に紐づく FCM push token も server 側で消す。端末設定解除後に、過去の録音完了通知が同じスマホへ飛ばないようにする。

## native notification endpoints

### `POST /api/teacher/native/notifications/register`

ログイン済み native app が FCM token と通知許可状態を server へ登録する。Android は Firebase 設定が入っている build のみログイン後・session restore 後・token 更新時に呼ぶ。

header:

```txt
Authorization: Bearer <accessToken>
```

request:

```json
{
  "provider": "FCM",
  "token": "fcm_registration_token",
  "permissionStatus": "granted"
}
```

`permissionStatus` は `granted`, `denied`, `unknown` のいずれか。`denied` の端末には server から通知を送らない。

response:

```json
{
  "ok": true
}
```

server は STT 完了で recording が `AWAITING_STUDENT_CONFIRMATION` になった時点で「生徒確認」通知を送る。最終失敗時はエラー通知を送る。Firebase server env が未設定の場合は通知送信だけ no-op にして、録音・upload・polling は止めない。

## recording endpoints

native app は Teacher recording endpoints を bearer token で使う。Web cookie session からの録音操作は受け付けない。

- `GET /api/teacher/recordings`
- `POST /api/teacher/recordings`
- `GET /api/teacher/recordings/:id`
- `POST /api/teacher/recordings/:id/audio`
- `GET /api/teacher/recordings/:id/progress`
- `POST /api/teacher/recordings/:id/confirm`
- `POST /api/teacher/recordings/:id/cancel`

## mutation 保護

- bearer access token の mutation は same-origin を要求しない
- Web cookie session で録音 endpoint に来た request は `410 Gone` として扱う
- upload は `Idempotency-Key` を継続利用する

## observability fields

次を DB に残す。

- `TeacherAppDevice.lastClientPlatform`
- `TeacherAppDevice.lastAppVersion`
- `TeacherAppDevice.lastBuildNumber`
- `TeacherAppDeviceAuthSession.clientPlatform`
- `TeacherAppDeviceAuthSession.appVersion`
- `TeacherAppDeviceAuthSession.buildNumber`
- `TeacherAppDeviceAuthSession.lastSeenAt`
- `TeacherAppDeviceAuthSession.lastRefreshedAt`
- `TeacherAppDeviceAuthSession.revokedAt`
- `TeacherAppDeviceAuthSession.revokeReason`
- `TeacherAppDevice.pushTokenProvider`
- `TeacherAppDevice.pushNotificationPermission`
- `TeacherAppDevice.pushTokenUpdatedAt`
- `TeacherAppDevice.lastPushSentAt`
- `TeacherAppDevice.lastPushError`
- `TeacherAppDevice.lastPushErrorAt`
