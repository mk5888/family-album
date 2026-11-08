'use strict';
// Parse a Google Photos shared-album page and follow its "load more" pages.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const PATH_RE = /^https:\/\/lh3\.googleusercontent\.com\/((?:pw\/)?[A-Za-z0-9_-]{25,})$/;
const VIDEO_KEY = '76647426';
const MAX_PAGES = 100;

function extractInitData(html, key) {
  const marker = `AF_initDataCallback({key: '${key}'`;
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const dataAt = html.indexOf('data:', start);
  const end = html.indexOf(', sideChannel:', dataAt);
  if (dataAt === -1 || end === -1) return null;
  try { return JSON.parse(html.slice(dataAt + 5, end)); } catch { return null; }
}

function parseItem(item) {
  if (!Array.isArray(item) || !Array.isArray(item[1])) return null;
  const [url, width, height] = item[1];
  const match = PATH_RE.exec(String(url || ''));
  if (!match || !(width > 150 && height > 150)) return null;
  const meta = item.find(v => v && typeof v === 'object' && !Array.isArray(v)) || {};
  const video = Array.isArray(meta[VIDEO_KEY]);
  return { id: String(item[0] || match[1]), path: match[1], width, height, takenAt: Number(item[2]) || null, video, duration: video ? Number(meta[VIDEO_KEY][0]) || null : null };
}

function parseItems(list) { return (Array.isArray(list) ? list : []).map(parseItem).filter(Boolean); }

// Fallback for layout changes: plain regex over the HTML (photos only, first page).
function regexItems(html) {
  const found = new Map();
  const regex = /\["https:\/\/lh3\.googleusercontent\.com\/((?:pw\/)?[A-Za-z0-9_-]{25,})",(\d+),(\d+)/g;
  for (let m; (m = regex.exec(html));) {
    const width = Number(m[2]); const height = Number(m[3]);
    if (width > 150 && height > 150 && !found.has(m[1])) found.set(m[1], { id: m[1], path: m[1], width, height, takenAt: null, video: false, duration: null });
  }
  return [...found.values()];
}

function parsePage(html) {
  const data = extractInitData(html, 'ds:1');
  const items = data ? parseItems(data[1]) : [];
  return {
    items: items.length ? items : regexItems(html),
    cursor: data && typeof data[2] === 'string' && data[2] ? data[2] : null,
    fsid: (/"FdrFJe":"(-?\d+)"/.exec(html) || [])[1] || null,
    bl: (/(boq_photosuiserver_[0-9._a-zA-Z]+)/.exec(html) || [])[1] || null,
    title: ((/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').replace(/\s*-\s*Google (Photos|相簿)\s*$/, '').trim()
  };
}

function parseBatchResponse(text) {
  const at = text.indexOf('[["wrb.fr"');
  if (at === -1) return { items: [], cursor: null };
  const line = text.slice(at, text.indexOf('\n', at) === -1 ? undefined : text.indexOf('\n', at));
  const outer = JSON.parse(line);
  const payload = JSON.parse(outer[0][2]);
  return { items: parseItems(payload[1]), cursor: typeof payload[2] === 'string' && payload[2] ? payload[2] : null };
}

async function fetchNextPage({ albumId, key, fsid, bl, cursor, reqid, fetchImpl }) {
  const freq = JSON.stringify([[['snAcKc', JSON.stringify([albumId, cursor, null, key]), null, 'generic']]]);
  const qs = new URLSearchParams({ rpcids: 'snAcKc', 'source-path': `/share/${albumId}`, 'f.sid': fsid, bl, hl: 'en-US', 'soc-app': '165', 'soc-platform': '1', 'soc-device': '1', _reqid: String(reqid), rt: 'c' });
  const res = await fetchImpl(`https://photos.google.com/_/PhotosUi/data/batchexecute?${qs}`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1', Origin: 'https://photos.google.com', Referer: 'https://photos.google.com/' },
    body: new URLSearchParams({ 'f.req': freq }).toString()
  });
  if (!res.ok) throw new Error(`Next page response ${res.status}`);
  return parseBatchResponse(await res.text());
}

async function fetchAlbumItems(shareUrl, fetchImpl = fetch) {
  // A minimal UA keeps goo.gl short links on a plain redirect.
  const res = await fetchImpl(shareUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' } });
  if (!res.ok) throw new Error(`Album response ${res.status}`);
  const html = await res.text();
  const page = parsePage(html);
  const items = new Map(page.items.map(i => [i.path, i]));
  let truncated = false;
  const finalUrl = new URL(res.url || shareUrl);
  const albumId = finalUrl.pathname.split('/').pop();
  const key = finalUrl.searchParams.get('key') || '';
  let cursor = page.cursor;
  if (cursor && !(page.fsid && page.bl && key)) { truncated = true; cursor = null; }
  for (let n = 0, reqid = 100000; cursor; n++, reqid++) {
    if (n >= MAX_PAGES) { truncated = true; break; }
    try {
      const next = await fetchNextPage({ albumId, key, fsid: page.fsid, bl: page.bl, cursor, reqid, fetchImpl });
      for (const item of next.items) if (!items.has(item.path)) items.set(item.path, item);
      if (!next.items.length) break;
      cursor = next.cursor;
    } catch (error) { console.error(error.message); truncated = true; break; }
  }
  return { title: page.title, items: [...items.values()], truncated };
}

module.exports = { parsePage, parseItem, parseBatchResponse, fetchAlbumItems, regexItems };
