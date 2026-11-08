🌐 [English](README.md) | 正體中文

# 私人家庭相冊代理

把一個或多個 Google 相簿**共享**相冊變成私人畫廊，給小範圍、可信任的家人使用。連不上 Google 的家人也能看照片和影片，微信內建瀏覽器也可以。

## 功能

- **每人專屬連結**：每位家人一條自己的連結，點開就能看，不用輸入密碼。從 `INVITES` 刪掉那一行即可撤銷。
- 可選的共用通行碼登入。
- 瀑布流畫廊、燈箱左右滑動、影片播放、下載原檔。
- 大相冊：超過約 300 張時，會繼續讀取 Google 的「載入更多」分頁。
- **可走 CDN 快取**：照片與影片網址帶 HMAC 簽名，Cloudflare 可以快取（開得快、省 VPS 流量），相冊清單仍需登入。

## 安全模型

- `.env` 只放在 VPS 上。共享相冊連結、邀請碼與 `SESSION_SECRET` 都是密鑰。
- 工作階段使用簽名的 HttpOnly、SameSite=Lax Cookie（Lax 讓從聊天軟體點開的連結也能登入）。
- 邀請連結與通行碼嘗試依 IP 限流。
- 相冊清單為 `private, no-store`。沒有 `SESSION_SECRET` 無法猜出媒體網址；已拿到某個網址的人只能開那一個檔案。設 `MEDIA_CACHE=private` 可完全不快取。更換 `SESSION_SECRET` 會讓所有人登出，舊媒體網址全部失效。
- 務必在 HTTPS 後面運行，並保持 `COOKIE_SECURE=true`。

## 部署

1. 在 VPS 上把 `.env.example` 複製為 `.env`，設定 `SESSION_SECRET`（`openssl rand -hex 32`）與 `ALBUMS`。
2. 為每位家人建立連結：`npm run invite -- 媽媽 https://album.example.com`，把印出的 `名稱|token` 加進 `INVITES`，再把印出的連結傳給對方。
3. 執行 `docker compose up -d --build`。
4. 在 `127.0.0.1:3000` 前加上 Caddy、Nginx 或 Cloudflare Tunnel，並啟用 HTTPS。
5. 可選（Cloudflare）：新增快取規則「URI 路徑開頭為 `/m/`」→ 可快取、沿用來源 TTL。**不要**快取 `/api/*` 或 `/i/*`。
6. `GET /healthz` 無需登入，供 Docker `HEALTHCHECK` 使用。

## 開發

`npm install`，然後 `npm test`。

不要提交 `.env`、截圖、真實相冊連結、邀請碼、密碼或 Cloudflare 憑證。
