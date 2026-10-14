# Private family album proxy

This service proxies a Google Photos **shared** album through a private gallery. It is intended for a small, trusted group.

## Security model

- Keep `.env` only on the VPS. Shared-album URLs are bearer-style secrets.
- The app uses a short-lived signed, HttpOnly, Secure, SameSite cookie. It never places a passcode in URLs or browser storage.
- Login attempts are rate-limited in memory. Put Cloudflare Access in front of the hostname and allow only named family email addresses.
- Image and API responses default to `private, no-store`. Do not create a public CDN cache rule for `/api/img`.
- Run behind HTTPS. Keep `COOKIE_SECURE=true` in production.

## Deploy

1. Copy `.env.example` to `.env` on the VPS and replace every example value.
2. Run `docker compose up -d --build`.
3. Put Caddy, Nginx, or Cloudflare Tunnel in front of `127.0.0.1:3000` with HTTPS.
4. In Cloudflare Zero Trust, create an Access application for the hostname and allow only the exact family email addresses using One-time PIN.
5. `GET /healthz` is unauthenticated and used by the Docker `HEALTHCHECK`.

Do not commit `.env`, screenshots, real album URLs, passwords, or Cloudflare credentials.
