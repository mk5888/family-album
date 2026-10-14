🌐 [English](README.md) | 正體中文

# 私人家庭相冊代理

本服務透過私人畫廊代理 Google Photos **共享**相冊，適用於小規模、可信任的群體。

## 安全模型

- `.env` 只保存在 VPS 上，共享相冊連結本身即是密鑰，請妥善保管。
- 應用使用短期有效的簽名 HttpOnly、Secure、SameSite Cookie，通行碼絕不會出現在網址或瀏覽器儲存中。
- 登入嘗試有記憶體級限流，建議在主機名稱前加上 Cloudflare Access，只允許指定的家庭電子郵件地址存取。
- 圖片與 API 回應預設為 `private, no-store`，不要為 `/api/img` 建立公開的 CDN 快取規則。
- 務必使用 HTTPS 運行，正式環境保持 `COOKIE_SECURE=true`。

## 部署

1. 在 VPS 上把 `.env.example` 複製為 `.env`，並替換所有範例值。
2. 執行 `docker compose up -d --build`。
3. 在 `127.0.0.1:3000` 前加上 Caddy、Nginx 或 Cloudflare Tunnel，並啟用 HTTPS。
4. 在 Cloudflare Zero Trust 為該主機名稱建立 Access 應用，只允許家庭成員的確切電子郵件地址使用一次性 PIN 登入。
5. `GET /healthz` 無需登入，供 Docker `HEALTHCHECK` 使用。

不要提交 `.env`、截圖、真實相冊連結、密碼或 Cloudflare 憑證。
