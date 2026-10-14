const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

function loadEnv() {
  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (process.env[key] === undefined) process.env[key] = line.slice(separator + 1).trim();
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 3000);
const PASSCODE = process.env.PASSCODE || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';
const CACHE_TTL = Math.max(1, Number(process.env.CACHE_MINUTES || 10)) * 60_000;
const SESSION_TTL = 7 * 24 * 60 * 60;
const LOGIN_WINDOW = 15 * 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const albumCache = new Map();
const loginAttempts = new Map();
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2kb' }));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  next();
});

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(v => v.trim().split(/=(.*)/s)).filter(([k]) => k).map(([k, v]) => [k, decodeURIComponent(v || '')]));
}
function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url'); }
function createSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL, nonce: crypto.randomUUID() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function validSession(token) {
  if (!token || !SESSION_SECRET || !token.includes('.')) return false;
  const [payload, signature] = token.split('.', 2);
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now() / 1000; } catch { return false; }
}
function auth(req, res, next) {
  if (!PASSCODE) return next(); // Only safe if Cloudflare Access protects the whole hostname.
  if (!validSession(parseCookies(req.headers.cookie).family_session)) return res.status(401).json({ error: 'Authentication required' });
  next();
}
function clientKey(req) { return req.ip || req.socket.remoteAddress || 'unknown'; }
function checkLoginLimit(req, res, next) {
  const key = clientKey(req); const now = Date.now(); const attempts = (loginAttempts.get(key) || []).filter(t => now - t < LOGIN_WINDOW);
  if (attempts.length >= LOGIN_MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  req.loginAttempts = attempts; next();
}
function albums() {
  return (process.env.ALBUMS || '').split(',').map((entry, index) => {
    const [name, url] = entry.split('|').map(value => value?.trim());
    return { id: `album_${index}`, name: name || `Album ${index + 1}`, url };
  }).filter(album => /^https:\/\/photos\.app\.goo\.gl\//.test(album.url || ''));
}
async function fetchAlbum(albumUrl, refresh = false) {
  const cached = albumCache.get(albumUrl);
  if (!refresh && cached && Date.now() - cached.createdAt < CACHE_TTL) return cached.value;
  const upstream = await fetch(albumUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-TW,zh;q=0.9' } });
  if (!upstream.ok) throw new Error(`Album response ${upstream.status}`);
  const html = await upstream.text();
  const found = new Map();
  const regex = /\["https:\/\/lh3\.googleusercontent\.com\/((?:pw\/)?[A-Za-z0-9_-]{25,})",(\d+),(\d+)/g;
  for (let match; (match = regex.exec(html));) {
    const width = Number(match[2]); const height = Number(match[3]);
    if (width > 150 && height > 150) found.set(match[1], { path: match[1], width, height });
  }
  const value = { updatedAt: new Date().toISOString(), photos: [...found.values()] };
  albumCache.set(albumUrl, { createdAt: Date.now(), value });
  return value;
}

app.post('/api/session', checkLoginLimit, (req, res) => {
  if (!PASSCODE || !SESSION_SECRET) return res.status(503).json({ error: 'Authentication is not configured' });
  const supplied = String(req.body?.passcode || '');
  if (supplied.length !== PASSCODE.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(PASSCODE))) {
    loginAttempts.set(clientKey(req), [...req.loginAttempts, Date.now()]);
    return res.status(401).json({ error: 'Invalid passcode' });
  }
  loginAttempts.delete(clientKey(req));
  res.cookie('family_session', createSession(), { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'strict', maxAge: SESSION_TTL * 1000, path: '/' });
  res.status(204).end();
});
app.delete('/api/session', (req, res) => { res.clearCookie('family_session', { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'strict', path: '/' }); res.status(204).end(); });
app.get('/api/albums', auth, (req, res) => { res.set('Cache-Control', 'private, no-store').json(albums().map(({ id, name }) => ({ id, name }))); });
app.get('/api/albums/:id', auth, async (req, res, next) => {
  try {
    const album = albums().find(item => item.id === req.params.id);
    if (!album) return res.status(404).json({ error: 'Album not found' });
    const data = await fetchAlbum(album.url, req.query.refresh === '1');
    res.set('Cache-Control', 'private, no-store').json({ id: album.id, name: album.name, count: data.photos.length, ...data });
  } catch (error) { next(error); }
});
app.get('/api/img', auth, async (req, res, next) => {
  const imgPath = String(req.query.path || ''); const size = String(req.query.s || 'thumb');
  if (!/^(?:pw\/)?[A-Za-z0-9_-]{25,}$/.test(imgPath)) return res.status(400).send('Invalid image path');
  const parameters = { thumb: 'w600', hd: 'w1920-h1920', orig: 'd' }; if (!parameters[size]) return res.status(400).send('Invalid image size');
  try {
    const upstream = await fetch(`https://lh3.googleusercontent.com/${imgPath}=${parameters[size]}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!upstream.ok || !upstream.body) return res.status(502).send('Image unavailable');
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) return res.status(502).send('Unexpected image type');
    res.set({ 'Content-Type': contentType, 'Cache-Control': 'private, no-store' });
    if (size === 'orig') res.attachment(`family-photo-${Date.now()}.jpg`);
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) { next(error); }
});
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: '1h', index: 'index.html' }));
app.use((error, req, res, next) => { console.error(error.message); if (!res.headersSent) res.status(502).json({ error: 'Upstream service unavailable' }); });
app.listen(PORT, () => console.log(`Family album listening on port ${PORT}`));
