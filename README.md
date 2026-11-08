🌐 [正體中文](README.zh-Hant.md) | English

# Private family album proxy

Shows one or more Google Photos **shared** albums as a private gallery for a small, trusted group, so family who can't reach Google can still browse photos and videos (including inside the WeChat browser).

## Features

- **Per-person invite links**: each family member gets their own link and never types a password. Remove a line from `INVITES` to revoke that person.
- Optional shared passcode login.
- Masonry gallery, lightbox with swipe, video playback, download originals.
- Large albums: follows Google's "load more" pages beyond the first ~300 items.
- **CDN-friendly media**: photo and video URLs are HMAC-signed, so Cloudflare can cache them (fast loads, less VPS traffic) while album lists stay behind login.

## Security model

- Keep `.env` only on the VPS. Shared-album links, invite tokens and `SESSION_SECRET` are secrets.
- Sessions use a signed, HttpOnly, SameSite=Lax cookie (Lax so links opened from chat apps work).
- Invite and passcode attempts are rate-limited per IP.
- Album lists are `private, no-store`. Media URLs can't be guessed without `SESSION_SECRET`; anyone who already has one can open that one file. Set `MEDIA_CACHE=private` to disable caching entirely. Rotating `SESSION_SECRET` signs everyone out and invalidates all media URLs.
- Run behind HTTPS with `COOKIE_SECURE=true`.

## Deploy

1. Copy `.env.example` to `.env` on the VPS, set `SESSION_SECRET` (`openssl rand -hex 32`) and `ALBUMS`.
2. Create an invite per person: `npm run invite -- Mom https://album.example.com`, add the printed `name|token` to `INVITES`, and send them the printed link.
3. Run `docker compose up -d --build`.
4. Put Caddy, Nginx, or Cloudflare Tunnel in front of `127.0.0.1:3000` with HTTPS.
5. Optional, Cloudflare: add a Cache Rule for `URI Path starts with /m/` → eligible for cache, respect origin TTL. Do **not** cache `/api/*` or `/i/*`.
6. `GET /healthz` is unauthenticated and used by the Docker `HEALTHCHECK`.

## Develop

`npm install`, then `npm test`.

Do not commit `.env`, screenshots, real album URLs, invite tokens, passwords, or Cloudflare credentials.
