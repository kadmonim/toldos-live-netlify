// What is kept on a profile beyond the pictures (table profile_items): documents, Vimeo and YouTube videos and links, any
// number per person, in the order the family sets. The person is a tree person (uuid) or someone in the extended
// family (roots id). A file itself lives in Cloudflare R2: the browser sends it straight there, to a small Worker
// (cloudflare/files) that takes it only with a short-lived address signed here (FILES_SECRET), and reads it back
// the same way, so nothing is reachable without being signed in to the site.
//   GET    /api/items/:person            the list, in order
//   POST   /api/items/:person            add: { kind: 'link' | 'video', title, note, url }, or after an upload
//                                        { kind: 'file', title, note, key, name, type, size }
//   POST   /api/items/:person/upload     { name, type, size } -> { url, key }: where to PUT the file
//   PUT    /api/item/:id                 { title, note } or { move: 'up' | 'down' }
//   DELETE /api/item/:id                 archive it: off the profile, but the row and the file stay (nothing is deleted)
//   GET    /api/item/:id/file            the file: sends the browser on to a signed address (?download=1 to save it)
//   GET    /api/item/:id/thumb           its small preview picture, the same way
//   POST   /api/item/:id/thumb           a link: look for the page's preview picture now. A file: { size } ->
//                                        { url, key } where the browser PUTs the picture it drew (then PUT
//                                        /api/item/:id { thumb_key }), or { none: true }: it can't be drawn
import { createHmac, randomUUID } from 'node:crypto';
import { sql } from '../lib/db.mjs';
import { isLoggedIn } from '../lib/auth.mjs';
import { loadScope, kinTops } from '../lib/family.mjs';
import { familyOf } from '../lib/families.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE = 100 * 1024 * 1024;   // one upload to a Worker, on Cloudflare's free plan
const json = (data, status = 200) => Response.json(data, { status });
const text = (v, max) => String(v ?? '').trim().slice(0, max) || null;
const WORKER = (process.env.FILES_WORKER_URL ?? '').replace(/\/$/, '');
const sign = (method, key, exp) => createHmac('sha256', process.env.FILES_SECRET ?? '').update(`${method}\n${key}\n${exp}`).digest('hex');
/** A signed address at the Worker, good for `seconds`. */
function signed(method, key, seconds, extra = {}) {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  const q = new URLSearchParams({ exp, sig: sign(method, key, exp), ...extra });
  return `${WORKER}/${key.split('/').map(encodeURIComponent).join('/')}?${q}`;
}

/** Is this person the site's own: in its tree, or in its extended family? */
async function ours(req, person) {
  if (UUID.test(person)) return (await loadScope(req)).members.has(person);
  const [r] = await sql`SELECT 1 FROM roots_members m JOIN roots_people p ON p.id = m.person
                        WHERE m.person = ${person} AND m.family = ${familyOf(req).key} AND m.kind <> 'hidden' AND NOT p.hidden`;
  return Boolean(r);
}
/** Logged with the other edits: the tree's own log for a tree person, the extended family's for the others. */
async function log(req, person, by, old, next) {
  if (UUID.test(person)) await sql`INSERT INTO edits (by_person, person_id, field, old, new) VALUES (${by}, ${person}, 'item', ${old && JSON.stringify(old)}::jsonb, ${next && JSON.stringify(next)}::jsonb)`;
  else await sql`INSERT INTO roots_edits (family, person, field, old, new, by_person) VALUES (${familyOf(req).key}, ${person}, 'item', ${old && JSON.stringify(old)}::jsonb, ${next && JSON.stringify(next)}::jsonb, ${by})`;
}
const vimeo = (u) => /^https:\/\/(www\.|player\.)?vimeo\.com\/(video\/)?\d+/i.test(u ?? '')
  || /^https:\/\/((www\.|m\.)?youtube\.com\/(watch\?|embed\/|shorts\/|live\/)|youtu\.be\/[\w-]{11})/i.test(u ?? '');   // a Vimeo or YouTube link

// ---- preview pictures (thumb_key): thumbs/<item id>/<random>, in the same storage as the files
const THUMB_MAX = 3 * 1024 * 1024;
/** Only a public web address is fetched from here: no local names, no bare IP addresses. */
const publicWeb = (u) => { try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) && x.hostname.includes('.') && !/^(\d+\.){3}\d+$/.test(x.hostname) && !x.hostname.includes(':') && !/\.(local|internal|lan)$/i.test(x.hostname); } catch { return false; } };
/** The picture a page offers for previews (og:image, twitter:image), as { data, type }, or null. */
async function linkPicture(pageUrl) {
  if (!publicWeb(pageUrl)) return null;
  const ua = { 'user-agent': 'LinkPreviewFetcher/1.0' };
  const res = await fetch(pageUrl, { headers: { ...ua, accept: 'text/html,*/*;q=0.5' }, signal: AbortSignal.timeout(5000) });
  if (!res.ok || !/html/i.test(res.headers.get('content-type') ?? '')) return null;
  const html = (await res.text()).slice(0, 2000000);
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  let src = null;
  for (const want of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
    const tag = metas.find((x) => new RegExp(`(?:property|name)\\s*=\\s*["']${want}["']`, 'i').test(x));
    src = tag && (tag.match(/content\s*=\s*"([^"]+)"/i)?.[1] ?? tag.match(/content\s*=\s*'([^']+)'/i)?.[1]);
    if (src) break;
  }
  if (!src) return null;
  const at = new URL(src.replace(/&amp;/g, '&'), res.url).href;
  if (!publicWeb(at)) return null;
  // Some sites (Wikipedia's pictures) give a picture to a person's browser but not to a server: then only its
  // address is kept, and the browser gets it from there.
  const img = await fetch(at, { headers: ua, signal: AbortSignal.timeout(5000) }).catch(() => null);
  const type = (img?.headers.get('content-type') ?? '').split(';')[0];
  if (!img?.ok) return at.startsWith('https://') ? { at } : null;
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(type)) return null;
  const data = await img.arrayBuffer();
  return data.byteLength && data.byteLength <= THUMB_MAX ? { data, type } : null;
}
const dropThumb = (key) => (key?.startsWith('thumbs/') && WORKER ? fetch(signed('DELETE', key, 300), { method: 'DELETE' }).catch(() => {}) : null);
/** Looks for a link's preview picture and keeps it; 'none' when the page has none (so it isn't asked again). */
async function linkThumb(it) {
  if (!WORKER || !process.env.FILES_SECRET) return it;
  let key = 'none';
  try {
    const pic = await linkPicture(it.url);
    if (pic?.at) key = `url:${pic.at}`.slice(0, 900);
    else if (pic) {
      const k = `thumbs/${it.id}/${randomUUID()}`;
      const put = await fetch(signed('PUT', k, 300, { size: pic.data.byteLength }), { method: 'PUT', headers: { 'content-type': pic.type }, body: pic.data });
      if (put.ok) key = k;
    }
  } catch { /* the page didn't answer: no picture */ }
  const [row] = await sql`UPDATE profile_items SET thumb_key = ${key} WHERE id = ${it.id} RETURNING id, person, kind, title, note, url, file_name, file_type, file_size, thumb_key, position, by_person, created_at`;
  return row ?? it;
}
const web = (u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } };

export default async (req, context) => {
  if (!isLoggedIn(req)) return json({ error: 'login' }, 401);
  const url = new URL(req.url);
  const by = UUID.test(req.headers.get('x-editor') ?? '') ? req.headers.get('x-editor') : null;
  try {
    // ---- one person's list
    if (url.pathname.startsWith('/api/items/')) {
      const person = decodeURIComponent(context.params.person ?? '');
      // a sister family's top couple: their documents can be seen here (not added to or changed)
      const seeOnly = person && !(await ours(req, person)) && req.method === 'GET' && (await kinTops(req)).has(person);
      if (!person || !(seeOnly || await ours(req, person))) return json({ error: 'not found' }, 404);
      if (req.method === 'GET') return json(await sql`SELECT id, person, kind, title, note, url, file_name, file_type, file_size, thumb_key, position, by_person, created_at FROM profile_items WHERE person = ${person} AND archived_at IS NULL ORDER BY position, id`);
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      const body = await req.json().catch(() => ({}));
      if (url.pathname.endsWith('/upload')) {
        if (!WORKER || !process.env.FILES_SECRET) return json({ error: 'files are not set up' }, 503);
        const size = Number(body.size) || 0;
        if (!size || size > MAX_FILE) return json({ error: 'too large', max: MAX_FILE }, 413);
        const name = (text(body.name, 150) ?? 'file').replace(/[^\p{L}\p{N}._ -]+/gu, '_');
        const key = `${person}/${randomUUID()}/${name}`;
        return json({ key, url: signed('PUT', key, 3600, { size }) });
      }
      const kind = ['link', 'video', 'file'].includes(body.kind) ? body.kind : null;
      if (!kind) return json({ error: 'kind' }, 400);
      let item = { title: text(body.title, 200), note: text(body.note, 1000), url: null, key: null, name: null, type: null, size: null };
      if (kind === 'file') {
        const key = String(body.key ?? '');
        if (!key.startsWith(`${person}/`)) return json({ error: 'key' }, 400);
        item = { ...item, key, name: text(body.name, 150), type: text(body.type, 100), size: Number(body.size) || null };
        item.title ??= item.name;
      } else {
        const u = text(body.url, 600);
        if (!web(u) || (kind === 'video' && !vimeo(u))) return json({ error: kind === 'video' ? 'a Vimeo or YouTube link is needed' : 'a web address is needed' }, 400);
        item.url = u;
      }
      const [row] = await sql`
        INSERT INTO profile_items (person, kind, title, note, url, file_key, file_name, file_type, file_size, by_person, position)
        VALUES (${person}, ${kind}, ${item.title}, ${item.note}, ${item.url}, ${item.key}, ${item.name}, ${item.type}, ${item.size}, ${by},
                (SELECT coalesce(max(position), 0) + 1 FROM profile_items WHERE person = ${person}))
        RETURNING id, person, kind, title, note, url, file_name, file_type, file_size, thumb_key, position, by_person, created_at`;
      await log(req, person, by, null, { added: row.id, kind, title: row.title });
      return json(kind === 'link' ? await linkThumb(row) : row, 201);
    }

    // ---- one item
    const id = context.params.id;
    if (!/^\d+$/.test(id ?? '')) return json({ error: 'not found' }, 404);
    const [it] = await sql`SELECT * FROM profile_items WHERE id = ${id} AND archived_at IS NULL`;
    if (!it) return json({ error: 'not found' }, 404);
    if (!(await ours(req, it.person)) && !(req.method === 'GET' && (await kinTops(req)).has(it.person))) return json({ error: 'not found' }, 404);
    if (url.pathname.endsWith('/file')) {
      if (it.kind !== 'file' || !it.file_key) return json({ error: 'not found' }, 404);
      return Response.redirect(signed('GET', it.file_key, 3600, { name: it.file_name ?? 'file', type: it.file_type ?? '', ...(url.searchParams.has('download') && { download: 1 }) }), 302);
    }
    if (url.pathname.endsWith('/thumb')) {
      if (req.method === 'GET') {
        if (!it.thumb_key || it.thumb_key === 'none') return json({ error: 'not found' }, 404);
        return new Response(null, { status: 302, headers: { location: it.thumb_key.startsWith('url:') ? it.thumb_key.slice(4) : signed('GET', it.thumb_key, 86400, { name: 'preview' }), 'cache-control': 'private, max-age=80000' } });
      }
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      if (!WORKER || !process.env.FILES_SECRET) return json({ error: 'files are not set up' }, 503);
      const body = await req.json().catch(() => ({}));
      const { file_key: _k, ...plain } = it;
      if (it.kind === 'link') return json(it.thumb_key ? plain : await linkThumb(it));
      if (it.kind !== 'file') return json({ error: 'kind' }, 400);
      if (body.none) {
        const [row] = await sql`UPDATE profile_items SET thumb_key = 'none' WHERE id = ${it.id} AND thumb_key IS NULL RETURNING id, person, kind, title, note, url, file_name, file_type, file_size, thumb_key, position, by_person, created_at`;
        return json(row ?? plain);
      }
      const size = Number(body.size) || 0;
      if (!size || size > THUMB_MAX) return json({ error: 'too large' }, 413);
      const key = `thumbs/${it.id}/${randomUUID()}`;
      return json({ key, url: signed('PUT', key, 600, { size }) });
    }
    if (req.method === 'PUT') {
      const body = await req.json().catch(() => ({}));
      if (typeof body.thumb_key === 'string') {   // the browser drew the preview and sent it to the storage
        if (!body.thumb_key.startsWith(`thumbs/${it.id}/`)) return json({ error: 'key' }, 400);
        const [row] = await sql`UPDATE profile_items SET thumb_key = ${body.thumb_key} WHERE id = ${it.id} RETURNING id, person, kind, title, note, url, file_name, file_type, file_size, thumb_key, position, by_person, created_at`;
        if (it.thumb_key !== body.thumb_key) await dropThumb(it.thumb_key);
        return json(row);
      }
      if (body.move === 'up' || body.move === 'down') {
        // change places with the one before (or after) it
        const list = await sql`SELECT id, position FROM profile_items WHERE person = ${it.person} AND archived_at IS NULL ORDER BY position, id`;
        const i = list.findIndex((x) => String(x.id) === String(it.id)), j = body.move === 'up' ? i - 1 : i + 1;
        if (j >= 0 && j < list.length) {
          const order = list.map((x) => x.id); [order[i], order[j]] = [order[j], order[i]];
          await sql`UPDATE profile_items p SET position = o.n FROM (SELECT * FROM unnest(${order}::bigint[]) WITH ORDINALITY AS t(id, n)) o WHERE p.id = o.id`;
        }
        return json(await sql`SELECT id, person, kind, title, note, url, file_name, file_type, file_size, thumb_key, position, by_person, created_at FROM profile_items WHERE person = ${it.person} AND archived_at IS NULL ORDER BY position, id`);
      }
      const title = text(body.title, 200), note = text(body.note, 1000);
      const [row] = await sql`UPDATE profile_items SET title = ${title}, note = ${note} WHERE id = ${it.id} RETURNING id, person, kind, title, note, url, file_name, file_type, file_size, thumb_key, position, by_person, created_at`;
      await log(req, it.person, by, { item: it.id, title: it.title, note: it.note }, { item: it.id, title, note });
      return json(row);
    }
    if (req.method === 'DELETE') {
      // Archived, not deleted: it leaves the profile; the row, the file and its preview stay.
      await sql`UPDATE profile_items SET archived_at = now(), archived_by = ${by} WHERE id = ${it.id}`;
      await log(req, it.person, by, { removed: it.id, kind: it.kind, title: it.title, url: it.url, file_name: it.file_name }, null);
      return json({ ok: true });
    }
    return json({ error: 'method' }, 405);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

export const config = { path: ['/api/items/:person', '/api/items/:person/upload', '/api/item/:id', '/api/item/:id/file', '/api/item/:id/thumb'] };
