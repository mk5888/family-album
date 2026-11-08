'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (process.env[key] === undefined) process.env[key] = line.slice(separator + 1).trim();
  }
}

function list(value) { return String(value || '').split(',').map(v => v.trim()).filter(Boolean); }
function inviteId(token) { return crypto.createHash('sha256').update(token).digest('base64url').slice(0, 12); }

function readConfig(env = process.env) {
  const albums = list(env.ALBUMS).map((entry, index) => {
    const [name, url] = entry.split('|').map(v => v?.trim());
    return { id: `album_${index}`, name: name || `Album ${index + 1}`, url };
  }).filter(a => /^https:\/\/(photos\.app\.goo\.gl|photos\.google\.com\/share)\//.test(a.url || ''));
  const invites = list(env.INVITES).map(entry => {
    const [name, token] = entry.split('|').map(v => v?.trim());
    return { name: name || 'family', token: token || '' };
  }).filter(i => i.token.length >= 24).map(i => ({ ...i, id: inviteId(i.token) }));
  const mediaCache = env.MEDIA_CACHE === 'private' ? 'private' : 'public';
  return {
    port: Number(env.PORT || 3000),
    passcode: env.PASSCODE || '',
    sessionSecret: env.SESSION_SECRET || '',
    cookieSecure: env.COOKIE_SECURE !== 'false',
    cacheTtl: Math.max(1, Number(env.CACHE_MINUTES || 10)) * 60_000,
    sessionDays: Math.max(1, Number(env.SESSION_DAYS || 7)),
    inviteSessionDays: Math.max(1, Number(env.INVITE_SESSION_DAYS || 180)),
    mediaCache,
    albums,
    invites
  };
}

module.exports = { loadEnvFile, readConfig, inviteId };
