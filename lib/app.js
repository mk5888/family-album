'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { Readable } = require('node:stream');
const { fetchAlbumItems } = require('./google');

const LOGIN_WINDOW = 15 * 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const SIZES = { thumb: 'w600-h600', hd: 'w1920-h1920', orig: 'd', video: 'm22' };
const PATH_RE = /^(?:pw\/)?[A-Za-z0-9_-]{25,}$/;

function createApp(config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const { passcode, sessionSecret, cookieSecure, invites, albums } = config;
  const authEnabled = Boolean(passcode || invites.length);
  const albumCache = new Map();
  const loginAttempts = new Map();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2kb' }));
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    next();
  });

  const pruneTimer = setInterval(() => {
    const cutoff = now() - LOGIN_WINDOW;
    for (const [key, times] of loginAttempts) {
      const fresh = times.filter(t => t > cutoff);
      if (fresh.length) loginAttempts.set(key, fresh); else loginAttempts.delete(key);
    }
  }, 60_000);
  pruneTimer.unref();

  const hmac = value => crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
  const safeEqual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const parseCookies = (header = '') => Object.fromEntries(header.split(';').map(v => v.trim().split(/=(.*)/s)).filter(([k]) => k).map(([k, v]) => { try { return [k, decodeURIComponent(v || '')]; } catch { return [k, '']; } }));

  function createSession(sub, days) {
    const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(now() / 1000) + days * 86400, nonce: crypto.randomUUID() })).toString('base64url');
    return `${payload}.${hmac(`session:${payload}`)}`;
  }
  function readSession(token) {
    if (!token || !sessionSecret || !token.includes('.')) return null;
    const [payload, signature] = token.split('.', 2);
    if (!safeEqual(signature, hmac(`session:${payload}`))) return null;
    let data; try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
    if (!(data.exp > now() / 1000)) return null;
    // Removing an invite from INVITES (or the passcode) revokes its sessions.
    if (data.sub === 'passcode' ? !passcode : !invites.some(i => i.id === data.sub)) return null;
    return data;
  }
  function setSession(res, sub, days) {
    res.cookie('family_session', createSession(sub, days), { httpOnly: true, secure: cookieSecure, sameSite: 'lax', maxAge: days * 86400_000, path: '/' });
  }
  function auth(req, res, next) {
    if (!authEnabled) return next(); // Only safe if Cloudflare Access protects the whole hostname.
    if (!readSession(parseCookies(req.headers.cookie).family_session)) return res.status(401).json({ error: 'Authentication required' });
    next();
  }
  const clientKey = req => req.ip || req.socket.remoteAddress || 'unknown';
  function limited(req) { return (loginAttempts.get(clientKey(req)) || []).filter(t => now() - t < LOGIN_WINDOW).length >= LOGIN_MAX_ATTEMPTS; }
  function recordFailure(req) { const k = clientKey(req); loginAttempts.set(k, [...(loginAttempts.get(k) || []), now()]); }

  const mediaSig = (size, p) => hmac(`media:${size}:${p}`).slice(0, 22);
  function mediaUrl(size, p) { return `/m/${size}/${p}.${size === 'video' ? 'mp4' : 'jpg'}?sig=${mediaSig(size, p)}`; }

  async function loadAlbum(album, refresh) {
    const cached = albumCache.get(album.url);
    if (!refresh && cached && now() - cached.createdAt < config.cacheTtl) return cached.value;
    const result = await fetchAlbumItems(album.url, fetchImpl);
    const value = { updatedAt: new Date(now()).toISOString(), truncated: result.truncated, items: result.items };
    albumCache.set(album.url, { createdAt: now(), value });
    return value;
  }

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/api/config', (req, res) => res.set('Cache-Control', 'no-store').json({ passcode: Boolean(passcode), invites: invites.length > 0 }));

  app.get('/i/:token', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (limited(req)) return res.status(429).send('Too many attempts. Try again later.');
    const invite = invites.find(i => safeEqual(i.token, req.params.token));
    if (!invite || !sessionSecret) { recordFailure(req); return res.redirect(302, '/?invite=invalid'); }
    setSession(res, invite.id, config.inviteSessionDays);
    res.redirect(302, '/');
  });

  app.post('/api/session', (req, res) => {
    if (!passcode || !sessionSecret) return res.status(503).json({ error: 'Passcode login is not configured' });
    if (limited(req)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    if (!safeEqual(String(req.body?.passcode || ''), passcode)) { recordFailure(req); return res.status(401).json({ error: 'Invalid passcode' }); }
    loginAttempts.delete(clientKey(req));
    setSession(res, 'passcode', config.sessionDays);
    res.status(204).end();
  });
  app.delete('/api/session', (req, res) => { res.clearCookie('family_session', { httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/' }); res.status(204).end(); });

  app.get('/api/albums', auth, (req, res) => res.set('Cache-Control', 'private, no-store').json(albums.map(({ id, name }) => ({ id, name }))));
  app.get('/api/albums/:id', auth, async (req, res, next) => {
    try {
      const album = albums.find(a => a.id === req.params.id);
      if (!album) return res.status(404).json({ error: 'Album not found' });
      const data = await loadAlbum(album, req.query.refresh === '1');
      const photos = data.items.map(i => ({
        id: i.id, width: i.width, height: i.height, takenAt: i.takenAt, video: i.video, duration: i.duration,
        thumb: mediaUrl('thumb', i.path), hd: mediaUrl('hd', i.path), orig: mediaUrl('orig', i.path),
        ...(i.video ? { src: mediaUrl('video', i.path) } : {})
      }));
      res.set('Cache-Control', 'private, no-store').json({ id: album.id, name: album.name, count: photos.length, truncated: data.truncated, updatedAt: data.updatedAt, photos });
    } catch (error) { next(error); }
  });

  // Media URLs carry their own signature, so a CDN can cache them without cookies.
  app.get(/^\/m\/(thumb|hd|orig|video)\/((?:pw\/)?[A-Za-z0-9_-]{25,})\.(jpg|mp4)$/, async (req, res, next) => {
    const size = req.params[0]; const imgPath = req.params[1];
    if (!PATH_RE.test(imgPath) || !sessionSecret || !safeEqual(String(req.query.sig || ''), mediaSig(size, imgPath))) return res.status(403).send('Forbidden');
    try {
      const headers = { 'User-Agent': 'Mozilla/5.0' };
      if (size === 'video' && req.headers.range) headers.Range = req.headers.range;
      let upstream = await fetchImpl(`https://lh3.googleusercontent.com/${imgPath}=${SIZES[size]}`, { headers });
      if (size === 'video' && upstream.status === 404) upstream = await fetchImpl(`https://lh3.googleusercontent.com/${imgPath}=m18`, { headers });
      if (!(upstream.ok || upstream.status === 206) || !upstream.body) return res.status(502).send('Media unavailable');
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      if (!/^(image|video)\//.test(contentType)) return res.status(502).send('Unexpected media type');
      res.status(upstream.status);
      res.set({ 'Content-Type': contentType, 'Cache-Control': config.mediaCache === 'public' ? 'public, max-age=2592000, immutable' : 'private, no-store' });
      for (const h of ['content-length', 'content-range', 'accept-ranges']) { const v = upstream.headers.get(h); if (v) res.set(h, v); }
      if (size === 'orig') res.attachment(`family-photo-${imgPath.slice(-8)}.${contentType.startsWith('video/') ? 'mp4' : 'jpg'}`);
      Readable.fromWeb(upstream.body).on('error', next).pipe(res);
    } catch (error) { next(error); }
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), { etag: true, maxAge: '1h', index: 'index.html' }));
  app.use((error, req, res, next) => { console.error(error.message); if (!res.headersSent) res.status(502).json({ error: 'Upstream service unavailable' }); });
  return app;
}

module.exports = { createApp };
