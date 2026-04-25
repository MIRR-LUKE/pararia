# Teacher App Native Auth Contract

更新日: `2026-04-19`

## 目的

Teacher 録音 native app が backend に入るための auth / recording 契約を、web 導線と分けて明文化する。

## 認証モデル

- native app は **bearer access token + stateful refresh token** を使う
- access token は短命で、署名付き token
- refresh token は opaque token で、server 側に hash を保存する
- refresh token は rotate する
- logout で auth session を revoke する
- 既存 web `/teacher` は cookie session を継続利用する

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

## recording endpoints

native app は既存 Teacher recording endpoints を bearer token で使う。

- `GET /api/teacher/recordings`
- `POST /api/teacher/recordings`
- `GET /api/teacher/recordings/:id`
- `POST /api/teacher/recordings/:id/audio`
- `GET /api/teacher/recordings/:id/progress`
- `POST /api/teacher/recordings/:id/confirm`
- `POST /api/teacher/recordings/:id/cancel`

## mutation 保護

- cookie session の mutation は same-origin check を継続する
- bearer access token の mutation は same-origin を要求しない
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
