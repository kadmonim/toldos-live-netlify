// The door to the family's documents in R2 (bucket family-tree-files). It has no idea who anyone is: it takes a
// file, hands one back, or removes one only when the address was signed by the site (netlify/functions/items.mjs,
// the shared FILES_SECRET) and has not run out. The path is the file's key; the method says what to do.
//   PUT    /<key>?exp=&sig=         store the body (up to 100 MB)
//   GET    /<key>?exp=&sig=&name=   send it (in place, or ?download=1 to save it); ranges work, for a PDF viewer or a seek
//   DELETE /<key>?exp=&sig=
// A second bucket, family-tree-files-backup, holds a copy of everything: an hourly timer (wrangler.toml) copies what
// is new, and keeps a file that was removed from the first for 90 days before letting it go, so a mistake (or a bug)
// can be put right. GET /_backup (signed like a file) says how the copy stands; PUT /_backup runs it now.
// Your site's address(es): the browser sends files here straight from these pages.
const SITES = ['https://your-family.netlify.app'];
const cors = (req) => {
  const o = req.headers.get('origin') ?? '';
  const ok = SITES.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  return { 'access-control-allow-origin': ok ? o : SITES[0], 'access-control-allow-methods': 'GET, PUT, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' };
};
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function signedBy(env, method, key, exp, sig) {
  if (!env.FILES_SECRET || !exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.FILES_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${method}\n${key}\n${exp}`)));
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

const GRACE_DAYS = 90, PER_RUN = 15;   // a run does a limited number of things (the free plan's limit): the rest wait for the next hour
async function everything(bucket) {
  const out = new Map(); let cursor;
  do {
    const l = await bucket.list({ cursor, limit: 1000 });
    for (const o of l.objects) out.set(o.key, o);
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return out;
}
async function mirror(env) {
  const [live, kept] = await Promise.all([everything(env.FILES), everything(env.BACKUP)]);
  const was = await env.BACKUP.get('_state.json');
  const state = was ? await was.json() : {};
  state.gone ??= {};   // removed from the first bucket: key -> since when
  let copied = 0, waiting = 0, removed = 0;
  for (const [key, o] of live) {
    const k = kept.get(key);
    if (k && k.size === o.size) { delete state.gone[key]; continue; }   // already there (a key is used for one upload only)
    if (copied >= PER_RUN) { waiting++; continue; }
    const obj = await env.FILES.get(key);
    if (!obj) continue;
    await env.BACKUP.put(key, obj.body, { httpMetadata: obj.httpMetadata });
    copied++; delete state.gone[key];
  }
  const now = Date.now();
  for (const key of kept.keys()) {
    if (key === '_state.json' || live.has(key)) continue;
    state.gone[key] ??= new Date(now).toISOString();
    if (removed < PER_RUN && now - Date.parse(state.gone[key]) > GRACE_DAYS * 864e5) { await env.BACKUP.delete(key); delete state.gone[key]; removed++; }
  }
  Object.assign(state, { lastRun: new Date(now).toISOString(), files: live.size, copied: live.size - waiting, waiting, removedKeptForNow: Object.keys(state.gone).length });
  await env.BACKUP.put('_state.json', JSON.stringify(state));
  return state;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(mirror(env)); },
  async fetch(req, env) {
    const url = new URL(req.url), head = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: head });
    const key = decodeURIComponent(url.pathname.slice(1));
    if (!key || !['GET', 'HEAD', 'PUT', 'DELETE'].includes(req.method)) return new Response('Not found', { status: 404, headers: head });
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (!(await signedBy(env, method, key, url.searchParams.get('exp'), url.searchParams.get('sig')))) return new Response('Forbidden', { status: 403, headers: head });

    if (key === '_backup') {   // how the copy stands, or (PUT) make it now
      if (req.method === 'PUT') return Response.json(await mirror(env), { headers: head });
      const st = await env.BACKUP.get('_state.json');
      return Response.json(st ? await st.json() : { lastRun: null }, { headers: head });
    }
    if (req.method === 'PUT') {
      const size = Number(req.headers.get('content-length')) || 0;
      if (size > 100 * 1024 * 1024) return new Response('Too large', { status: 413, headers: head });
      const obj = await env.FILES.put(key, req.body, { httpMetadata: { contentType: req.headers.get('content-type') || 'application/octet-stream' } });
      return Response.json({ ok: true, size: obj.size }, { headers: head });
    }
    if (req.method === 'DELETE') { await env.FILES.delete(key); return Response.json({ ok: true }, { headers: head }); }

    const obj = await env.FILES.get(key, { range: req.headers, onlyIf: req.headers });
    if (!obj) return new Response('Not found', { status: 404, headers: head });
    const h = new Headers(head);
    obj.writeHttpMetadata(h);
    const type = url.searchParams.get('type');
    if (type) h.set('content-type', type);
    h.set('etag', obj.httpEtag);
    h.set('accept-ranges', 'bytes');
    h.set('cache-control', 'private, max-age=3600');
    const name = url.searchParams.get('name') || 'file';
    h.set('content-disposition', `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
    if (!('body' in obj)) return new Response(null, { status: 304, headers: h });   // not changed since the browser's copy
    if (req.headers.has('range') && obj.range) {
      const start = obj.range.offset ?? (obj.size - (obj.range.suffix ?? 0)), length = obj.range.length ?? (obj.size - start);
      h.set('content-range', `bytes ${start}-${start + length - 1}/${obj.size}`);
      h.set('content-length', String(length));
      return new Response(req.method === 'HEAD' ? null : obj.body, { status: 206, headers: h });
    }
    h.set('content-length', String(obj.size));
    return new Response(req.method === 'HEAD' ? null : obj.body, { headers: h });
  },
};
