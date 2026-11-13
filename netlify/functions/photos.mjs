// Photos live in Netlify Blobs: a person's profile photo under their id, a couple's family photo
// under "couple-<id>". The browser shrinks them before uploading (a face crop to 480 px, a family
// photo to 1600 px); photo_v on the row records the upload time and busts caches.
// `?size=original` is the full-quality photo as uploaded (whole, not cropped), kept under
// "orig-<key>" for printing; it's uploaded right after the small one and, when missing, the small
// one is served instead.
import { getStore } from '@netlify/blobs';
import { sql } from '../lib/db.mjs';
import { isLoggedIn } from '../lib/auth.mjs';
import { loadScope } from '../lib/family.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ORIGINAL = 6 * 1024 * 1024; // about what a function request can carry

export default async (req, context) => {
  if (!isLoggedIn(req)) return Response.json({ error: 'login' }, { status: 401 });
  const { id } = context.params;
  if (!UUID.test(id ?? '')) return new Response('Not found', { status: 404 });
  const url = new URL(req.url);
  const family = url.pathname.startsWith('/api/family-photos/');
  const original = url.searchParams.get('size') === 'original';
  const key = family ? `couple-${id}` : id;
  const store = getStore('photos');
  // Only photos of the site's family (lib/family.mjs).
  const scope = await loadScope(req);
  if (!(family ? scope.couples.has(id) : scope.members.has(id))) return new Response('Not found', { status: 404 });

  if (req.method === 'GET') {
    const res = (original && await store.getWithMetadata(`orig-${key}`, { type: 'arrayBuffer' }))
      || await store.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!res) return new Response('Not found', { status: 404 });
    const headers = { 'content-type': res.metadata.type ?? 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' };
    if (original) headers['content-disposition'] = `attachment; filename="${family ? 'family' : 'photo'}-${id}.${(res.metadata.type ?? 'image/jpeg').split('/')[1]}"`;
    return new Response(res.data, { headers });
  }

  if (req.method === 'PUT' && original) {
    const type = req.headers.get('content-type') ?? '';
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return new Response('Unsupported image type', { status: 415 });
    const data = await req.arrayBuffer();
    if (data.byteLength > MAX_ORIGINAL) return new Response('Photo too large', { status: 413 });
    const [row] = family ? await sql`SELECT id FROM couples WHERE id = ${id}` : await sql`SELECT id FROM people WHERE id = ${id}`;
    if (!row) return new Response('Not found', { status: 404 });
    await store.set(`orig-${key}`, data, { metadata: { type, at: new Date().toISOString() } });
    return Response.json({ ok: true });
  }

  if (req.method === 'PUT') {
    const type = req.headers.get('content-type') ?? '';
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return new Response('Unsupported image type', { status: 415 });
    const data = await req.arrayBuffer();
    if (data.byteLength > MAX_BYTES) return new Response('Photo too large', { status: 413 });
    const [row] = family
      ? await sql`SELECT id, a AS person FROM couples WHERE id = ${id}`
      : await sql`SELECT id, id AS person FROM people WHERE id = ${id}`;
    if (!row) return new Response('Not found', { status: 404 });
    await store.set(key, data, { metadata: { type } });
    const v = Date.now();
    if (family) await sql`UPDATE couples SET photo_v = ${v} WHERE id = ${id}`;
    else await sql`UPDATE people SET photo_v = ${v}, updated_at = now() WHERE id = ${id}`;
    const by = req.headers.get('x-editor');
    await sql`INSERT INTO edits (by_person, person_id, field)
              VALUES (${UUID.test(by ?? '') ? by : null}, ${row.person}, ${family ? 'family_photo' : 'photo'})`;
    return Response.json({ photo_v: v });
  }

  // Removing a photo (e.g. a black shot taken by mistake): both blobs go, and photo_v is cleared so
  // the person shows their initials again and the quiz stops using them.
  if (req.method === 'DELETE') {
    const [row] = family
      ? await sql`UPDATE couples SET photo_v = NULL WHERE id = ${id} RETURNING id`
      : await sql`UPDATE people SET photo_v = NULL, updated_at = now() WHERE id = ${id} RETURNING id`;
    if (!row) return new Response('Not found', { status: 404 });
    await Promise.all([store.delete(key), store.delete(`orig-${key}`)]);
    return Response.json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405 });
};

export const config = { path: ['/api/photos/:id', '/api/family-photos/:id'] };
