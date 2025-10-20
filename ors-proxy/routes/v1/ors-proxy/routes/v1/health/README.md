# /v1/health (scaffold)

目的: 稼働確認・CI用プローブ

受入条件:
- [ ] `GET /v1/health` が **200 OK**
- [ ] JSON: `{ "status":"ok", "revision":"<sha>", "buildTime":"<iso8601>" }`
- [ ] CORS: `GET` 許可, `no-store` 相当の短期キャッシュ方針
- [ ] ログ: IP/UA は匿名化
