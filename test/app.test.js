'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../lib/app');
const { readConfig } = require('../lib/config');
const { parsePage, parseBatchResponse } = require('../lib/google');

const P1 = 'pw/AP1GczPHOTOAAAAAAAAAAAAAAAAAAAAAAAA';
const V1 = 'pw/AP1GczVIDEOBBBBBBBBBBBBBBBBBBBBBBBB';
const P2 = 'pw/AP1GczPAGETWOCCCCCCCCCCCCCCCCCCCCCC';
const item = (path, video) => [path.slice(3, 20), [`https://lh3.googleusercontent.com/${path}`, 1600, 1200], 1700000000000, 'x', 0, 0, video ? { 76647426: [9833, null, 1920, 1080] } : { 15: 1 }];
const HTML = `<html><title>Family - Google Photos</title><script>"FdrFJe":"-123"boq_photosuiserver_20261106.05_p0</script><script>AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify([null, [item(P1), item(V1, true)], 'CURSOR1'])}, sideChannel: {}});</script></html>`;
const BATCH = `)]}'\n\n123\n${JSON.stringify([['wrb.fr', 'snAcKc', JSON.stringify([null, [item(P2)], null])]])}\n`;

function fakeFetch(calls = []) {
  return async (url, opt = {}) => {
    calls.push(url);
    if (url.startsWith('https://photos.app.goo.gl/')) return { ok: true, status: 200, url: 'https://photos.google.com/share/ALBUMID?key=KEY', text: async () => HTML };
    if (url.includes('batchexecute')) return { ok: true, status: 200, text: async () => BATCH };
    if (url.startsWith('https://lh3.googleusercontent.com/')) {
      const video = /=m(22|18)$/.test(url);
      return new Response(video ? 'VID' : 'IMG', { status: opt.headers?.Range ? 206 : 200, headers: { 'content-type': video ? 'video/mp4' : 'image/jpeg', ...(opt.headers?.Range ? { 'content-range': 'bytes 0-2/3' } : {}) } });
    }
    throw new Error('unexpected ' + url);
  };
}

const TOKEN = 'tok_' + 'a'.repeat(30);
function makeConfig(extra = {}) {
  return readConfig({ SESSION_SECRET: 's'.repeat(64), COOKIE_SECURE: 'false', ALBUMS: 'Family|https://photos.app.goo.gl/abc', INVITES: `Mom|${TOKEN}`, PASSCODE: 'letmein-please', ...extra });
}
async function withServer(config, fn, calls) {
  const server = createApp(config, { fetchImpl: fakeFetch(calls) }).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];

test('parses photos, videos and the next-page cursor', () => {
  const page = parsePage(HTML);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[1].video, true);
  assert.equal(page.items[1].duration, 9833);
  assert.equal(page.cursor, 'CURSOR1');
  assert.equal(page.title, 'Family');
  assert.equal(parseBatchResponse(BATCH).items[0].path, P2);
});

test('albums need a session', async () => {
  await withServer(makeConfig(), async base => {
    assert.equal((await fetch(`${base}/api/albums`)).status, 401);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  });
});

test('invite link signs in and follows album pages', async () => {
  const calls = [];
  await withServer(makeConfig(), async base => {
    const inv = await fetch(`${base}/i/${TOKEN}`, { redirect: 'manual' });
    assert.equal(inv.status, 302);
    assert.equal(inv.headers.get('location'), '/');
    const cookie = cookieOf(inv);
    assert.match(inv.headers.get('set-cookie'), /SameSite=Lax/);
    const album = await (await fetch(`${base}/api/albums/album_0`, { headers: { cookie } })).json();
    assert.equal(album.count, 3);
    assert.equal(album.truncated, false);
    assert.ok(calls.some(u => u.includes('batchexecute')));
    const video = album.photos.find(p => p.video);
    assert.match(video.src, /^\/m\/video\/.+\.mp4\?sig=/);
    // media URLs work without a cookie (CDN-cacheable) but not with a bad signature
    const img = await fetch(base + album.photos[0].thumb);
    assert.equal(img.status, 200);
    assert.match(img.headers.get('cache-control'), /public/);
    assert.equal((await fetch(base + album.photos[0].thumb.replace(/sig=.{4}/, 'sig=XXXX'))).status, 403);
    assert.equal((await fetch(base + album.photos[0].thumb.replace('/m/thumb/', '/m/orig/'))).status, 403);
    const vid = await fetch(base + video.src, { headers: { Range: 'bytes=0-2' } });
    assert.equal(vid.status, 206);
    assert.equal(vid.headers.get('content-type'), 'video/mp4');
  }, calls);
});

test('bad invite redirects and is rate limited', async () => {
  await withServer(makeConfig(), async base => {
    const bad = await fetch(`${base}/i/${'b'.repeat(34)}`, { redirect: 'manual' });
    assert.equal(bad.headers.get('location'), '/?invite=invalid');
    for (let i = 0; i < 4; i++) await fetch(`${base}/i/x${i}`, { redirect: 'manual' });
    assert.equal((await fetch(`${base}/i/${TOKEN}`, { redirect: 'manual' })).status, 429);
  });
});

test('removing an invite revokes its sessions', async () => {
  let cookie;
  await withServer(makeConfig(), async base => { cookie = cookieOf(await fetch(`${base}/i/${TOKEN}`, { redirect: 'manual' })); });
  await withServer(makeConfig({ INVITES: '' }), async base => {
    assert.equal((await fetch(`${base}/api/albums`, { headers: { cookie } })).status, 401);
  });
});

test('passcode login still works', async () => {
  await withServer(makeConfig(), async base => {
    const post = pass => fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: pass }) });
    assert.equal((await post('wrong')).status, 401);
    const ok = await post('letmein-please');
    assert.equal(ok.status, 204);
    assert.equal((await fetch(`${base}/api/albums`, { headers: { cookie: cookieOf(ok) } })).status, 200);
  });
});

test('private media cache mode', async () => {
  await withServer(makeConfig({ MEDIA_CACHE: 'private' }), async base => {
    const cookie = cookieOf(await fetch(`${base}/i/${TOKEN}`, { redirect: 'manual' }));
    const album = await (await fetch(`${base}/api/albums/album_0`, { headers: { cookie } })).json();
    assert.match((await fetch(base + album.photos[0].thumb)).headers.get('cache-control'), /no-store/);
  });
});
