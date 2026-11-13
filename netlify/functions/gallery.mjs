// A person's extra pictures (beyond the profile photo), listed in the `photos` table and kept in
// Netlify Blobs: "gallery-<id>" is the picture shrunk in the browser (whole, up to 1600 px) and
// "orig-gallery-<id>" the full-quality copy for printing, uploaded right after and optional.
//   POST   /api/people/:id/gallery          add a picture (body: the image) -> { id, person, at }
//   GET    /api/gallery/:id[?size=original] the picture
//   PUT    /api/gallery/:id?size=original   keep the full-quality copy
//   DELETE /api/gallery/:id                 remove it
import { getStore } from '@netlify/blobs';
import { sql } from '../lib/db.mjs';
import { isLoggedIn } from '../lib/auth.mjs';
import { loadScope } from '../lib/family.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ORIGINAL = 6 * 1024 * 1024;
const IMAGE = /^image\/(jpeg|png|webp)$/;

export default async (req, context) => {
  if (!isLoggedIn(req)) return Response.json({ error: 'login' }, { status: 401 });
  const { id } = context.params;
  if (!UUID.test(id ?? '')) return new Response('Not found', { status: 404 });
  const url = new URL(req.url);
  const adding = url.pathname.startsWith('/api/people/');
  const original = url.searchParams.get('size') === 'original';
  const store = getStore('photos');
  const by = req.headers.get('x-editor');
  // Only pictures of the site's family (lib/family.mjs): `id` is the person when adding, else the picture.
  const scope = await loadScope(req);
  const [owner] = adding ? [{ person: id }] : await sql`SELECT person_id AS person FROM photos WHERE id = ${id}`;
  if (!owner || !scope.members.has(owner.person)) return new Response('Not found', { status: 404 });

  if (req.method === 'POST' && adding) {
    const type = req.headers.get('content-type') ?? '';
    if (!IMAGE.test(type)) return new Response('Unsupported image type', { status: 415 });
    const data = await req.arrayBuffer();
    if (data.byteLength > MAX_BYTES) return new Response('Photo too large', { status: 413 });
    const [person] = await sql`SELECT id FROM people WHERE id = ${id}`;
    if (!person) return new Response('Not found', { status: 404 });
    const [row] = await sql`INSERT INTO photos (person_id, by_person) VALUES (${id}, ${UUID.test(by ?? '') ? by : null})
                            RETURNING id, person_id AS person, created_at AS at`;
    await store.set(`gallery-${row.id}`, data, { metadata: { type } });
    await sql`INSERT INTO edits (by_person, person_id, field) VALUES (${UUID.test(by ?? '') ? by : null}, ${id}, 'gallery')`;
    return Response.json(row, { status: 201 });
  }
  if (adding) return new Response('Method not allowed', { status: 405 });

  if (req.method === 'GET') {
    const res = (original && await store.getWithMetadata(`orig-gallery-${id}`, { type: 'arrayBuffer' }))
      || await store.getWithMetadata(`gallery-${id}`, { type: 'arrayBuffer' });
    if (!res) return new Response('Not found', { status: 404 });
    const type = res.metadata.type ?? 'image/jpeg';
    const headers = { 'content-type': type, 'cache-control': 'private, max-age=31536000, immutable' };
    if (original) headers['content-disposition'] = `attachment; filename="photo-${id}.${type.split('/')[1]}"`;
    return new Response(res.data, { headers });
  }

  if (req.method === 'PUT' && original) {
    const type = req.headers.get('content-type') ?? '';
    if (!IMAGE.test(type)) return new Response('Unsupported image type', { status: 415 });
    const data = await req.arrayBuffer();
    if (data.byteLength > MAX_ORIGINAL) return new Response('Photo too large', { status: 413 });
    const [row] = await sql`SELECT id FROM photos WHERE id = ${id}`;
    if (!row) return new Response('Not found', { status: 404 });
    await store.set(`orig-gallery-${id}`, data, { metadata: { type, at: new Date().toISOString() } });
    return Response.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const [row] = await sql`DELETE FROM photos WHERE id = ${id} RETURNING id`;
    if (!row) return Response.json({ error: 'not found' }, { status: 404 });
    await Promise.all([store.delete(`gallery-${id}`), store.delete(`orig-gallery-${id}`)]);
    return Response.json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405 });
};

export const config = { path: ['/api/gallery/:id', '/api/people/:id/gallery'] };
