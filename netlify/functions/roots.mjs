// The site's earlier roots (the wider family around its top couple: cousins, ancestors and their
// families). Loaded once from a file (Geni, a GEDCOM; migrations 0003, 0004); since then the database
// is the master copy.
//   GET  /api/roots      this site's members, their couples, and the spelling groups for search
//   GET/PUT/DELETE /api/roots/:id/photo  a photo (?size=original: the full-quality one, for printing)
//   PUT  /api/roots/:id  edit a person's names, dates/places/note, or Hebrew yahrzeit (anyone logged in, as on the tree). The old
//                        names become aliases, so the person is still found by them; every change is logged
//                        in roots_edits with what it replaced.
// A site without roots gets empty lists, and so does a database where the tables don't exist yet.
import { getStore } from '@netlify/blobs';
import { sql } from '../lib/db.mjs';
import { isLoggedIn } from '../lib/auth.mjs';
import { keepAside } from '../lib/archive.mjs';
import { familyOf, FAMILIES } from '../lib/families.mjs';
import { familyScope } from '../lib/scope.mjs';
import { kinTops } from '../lib/family.mjs';

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMES = ['he_first', 'he_last', 'en_first', 'en_last'];
const text = (v) => String(v ?? '').trim().slice(0, 120) || null;

/** A sister family's tree, shown here as part of the extended family (families.mjs: kin). Nothing is copied:
 *  its people are read from its tree as it stands now and sent in the extended family's shape, under ids
 *  "tree-<their id>" (couples "tree-fam-<id>"), with names, sex and years only, and they can't be changed from
 *  here (kind 'kin'). Its top couple are in the pool already (their main_person), so the two join there. */
async function addKin(key, people, couples) {
  const fam = FAMILIES.find((f) => f.key === key);
  if (!fam) return;
  const [tp, tc] = await Promise.all([
    sql`SELECT id, he_first, he_last, en_first, en_last, sex, h_year, deceased, d_year, parents, photo_v FROM people WHERE archived_at IS NULL`,
    sql`SELECT id, a, b, is_root AS root FROM couples`,
  ]);
  const scope = familyScope(tp, tc, fam.root ?? tc.find((c) => c.root)?.id);
  const inPool = new Map(people.filter((p) => p.main_person).map((p) => [p.main_person, p.id]));
  const rid = (id) => (id ? inPool.get(id) ?? `tree-${id}` : null);
  const have = new Map(couples.flatMap((c) => [[`${c.a}|${c.b}`, c.id], [`${c.b}|${c.a}`, c.id]]));
  const live = new Set(tp.map((p) => p.id));
  const cid = new Map();
  for (const c of tc) {
    if (!scope.couples.has(c.id)) continue;
    const a = live.has(c.a) ? rid(c.a) : null, b = c.b && live.has(c.b) ? rid(c.b) : null;
    const known = have.get(`${a}|${b}`);
    cid.set(c.id, known ?? `tree-fam-${c.id}`);
    if (!known && (a || b)) couples.push({ id: `tree-fam-${c.id}`, a: a ?? b, b: a ? b : null });
  }
  const year = (h) => (h ? { y: h - 3760 } : null);
  for (const p of tp) {
    if (!scope.members.has(p.id) || inPool.has(p.id)) continue;
    people.push({ id: `tree-${p.id}`, he_first: p.he_first, he_last: p.he_last, en_first: p.en_first, en_last: p.en_last, aliases: [],
      sex: p.sex ? p.sex.toUpperCase() : null, born: year(p.h_year), died: p.deceased ? year(p.d_year) ?? {} : null,
      parents: p.parents ? cid.get(p.parents) ?? null : null, kohen: false, tribe: null, hidden: false, hyd: false, main_person: null, photo_v: p.photo_v, kind: 'kin' });
  }
}

export default async (req, context) => {
  if (!isLoggedIn(req)) return json({ error: 'login' }, 401);
  const family = familyOf(req).key;
  try {
    if (req.method === 'GET' && new URL(req.url).pathname === '/api/roots') {
      const people = await sql`
        SELECT p.id, p.he_first, p.he_last, p.en_first, p.en_last, p.aliases, p.sex, p.born, p.died, p.parents,
               p.kohen, p.tribe, p.title_he, p.title_en, p.known_he, p.known_en, p.hidden, p.hyd, p.main_person, p.note, p.about, p.burial, p.notable_he, p.notable_en, p.parents_note, p.photo_v, m.kind
        FROM roots_members m JOIN roots_people p ON p.id = m.person
        WHERE m.family = ${family} AND m.kind <> 'hidden'`;
      const ids = new Set(people.map((p) => p.id));
      const couples = (await sql`
        SELECT c.id, c.a, c.b FROM roots_couples c
        WHERE c.a IN (SELECT person FROM roots_members WHERE family = ${family})`).filter((c) => ids.has(c.a));
      for (const key of familyOf(req).kin ?? []) await addKin(key, people, couples);
      // A sister family's top couple (the brother or sister of this family's own): their entry here carries their
      // tree profile too (kin_tree), so its picture, more pictures and documents show here, to see and not to change.
      const tops = await kinTops(req);
      let kin_photos = [];
      if (tops.size) {
        const list = [...tops];
        const tp = await sql`SELECT id, photo_v, h_day, h_month, h_year, d_day, d_month, d_year, burial FROM people WHERE id = ANY(${list}::uuid[])`;
        for (const p of people) {
          const tpx = p.main_person && tp.find((x) => x.id === p.main_person);
          if (!tpx) continue;
          Object.assign(p, { kin_tree: tpx.id, tree_photo_v: tpx.photo_v, burial: p.burial ?? tpx.burial });
          if (tpx.h_day && !p.born?.h) p.born = { ...(p.born ?? {}), h: { h_day: tpx.h_day, h_month: tpx.h_month, h_year: tpx.h_year } };
          if (tpx.d_day && !p.died?.h) p.died = { ...(p.died ?? {}), h: { h_day: tpx.d_day, h_month: tpx.d_month, h_year: tpx.d_year } };
        }
        kin_photos = await sql`SELECT id, person_id AS person, kind FROM photos WHERE person_id = ANY(${list}::uuid[]) AND archived_at IS NULL ORDER BY created_at`;
      }
      const spellings = people.length ? (await sql`SELECT kind, names FROM roots_spellings`).map((s) => s.names) : [];
      const photos = people.length ? (await sql`SELECT id, person, caption, kind FROM roots_photos WHERE archived_at IS NULL ORDER BY created_at`).filter((g) => ids.has(g.person)) : [];
      return json({ people, couples, spellings, photos, kin_photos }, 200, { 'cache-control': 'private, no-cache' });
    }

    // More photos (roots_photos): POST /api/roots/:id/gallery adds one; /api/roots-gallery/:gid gets (?size=original),
    // keeps the original (PUT ?size=original) or removes (DELETE) one. Only this site's members.
    const path = new URL(req.url).pathname;
    if (path.endsWith('/gallery') || path.startsWith('/api/roots-gallery/')) {
      const store = getStore({ name: 'photos', consistency: 'strong' });
      const original = new URL(req.url).searchParams.get('size') === 'original';
      const IMAGE = /^image\/(jpeg|png|webp)$/;
      const member = async (pid) => (await sql`SELECT 1 FROM roots_members m JOIN roots_people p ON p.id = m.person
                                              WHERE m.person = ${pid} AND m.family = ${family} AND m.kind <> 'hidden' AND NOT p.hidden`).length > 0;
      if (path.endsWith('/gallery') && req.method === 'POST') {
        const pid = context.params.id;
        if (!(await member(pid))) return new Response('Not found', { status: 404 });
        const type = req.headers.get('content-type') ?? '';
        if (!IMAGE.test(type)) return new Response('Unsupported image type', { status: 415 });
        const data = await req.arrayBuffer();
        if (data.byteLength > 2 * 1024 * 1024) return new Response('Photo too large', { status: 413 });
        const by = UUID.test(req.headers.get('x-editor') ?? '') ? req.headers.get('x-editor') : null;
        const caption = text(new URL(req.url).searchParams.get('caption'));
        const kind = ['matzeiva', 'book'].find((k) => k === new URL(req.url).searchParams.get('kind')) ?? null;   // the headstone, or a page of a book they wrote
        const [row] = await sql`INSERT INTO roots_photos (person, caption, by_person, kind) VALUES (${pid}, ${caption}, ${by}, ${kind}) RETURNING id, person, caption, kind`;
        await store.set(`roots-gallery-${row.id}`, data, { metadata: { type } });
        if (kind) {   // one headstone photo, one book page: a new one replaces the old
          await sql`UPDATE roots_photos SET archived_at = now(), archived_by = ${by} WHERE person = ${pid} AND kind = ${kind} AND id <> ${row.id} AND archived_at IS NULL`;   // archived: the row and the file stay
        }
        await sql`INSERT INTO roots_edits (family, person, field, old, new, by_person)
                  VALUES (${family}, ${pid}, 'gallery', null, ${JSON.stringify({ added: row.id })}::jsonb, ${by})`;
        return json(row, 201);
      }
      const gid = context.params.gid;
      if (!/^\d+$/.test(gid ?? '')) return new Response('Not found', { status: 404 });
      const [g] = await sql`SELECT id, person FROM roots_photos WHERE id = ${gid} AND archived_at IS NULL`;
      if (!g || !(await member(g.person))) return new Response('Not found', { status: 404 });
      const key = `roots-gallery-${g.id}`;
      if (req.method === 'GET') {
        const res = (original && await store.getWithMetadata(`orig-${key}`, { type: 'arrayBuffer' })) || await store.getWithMetadata(key, { type: 'arrayBuffer' });
        if (!res) return new Response('Not found', { status: 404 });
        const headers = { 'content-type': res.metadata.type ?? 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' };
        if (original) headers['content-disposition'] = `attachment; filename="photo-${g.id}.${(res.metadata.type ?? 'image/jpeg').split('/')[1]}"`;
        return new Response(res.data, { headers });
      }
      if (req.method === 'PUT' && original) {
        const type = req.headers.get('content-type') ?? '';
        if (!IMAGE.test(type)) return new Response('Unsupported image type', { status: 415 });
        const data = await req.arrayBuffer();
        if (data.byteLength > 6 * 1024 * 1024) return new Response('Photo too large', { status: 413 });
        await store.set(`orig-${key}`, data, { metadata: { type, at: new Date().toISOString() } });
        return json({ ok: true });
      }
      if (req.method === 'DELETE') {
        // Archived, not deleted: it leaves the page; the row and the file stay.
        await sql`UPDATE roots_photos SET archived_at = now(), archived_by = ${UUID.test(req.headers.get('x-editor') ?? '') ? req.headers.get('x-editor') : null} WHERE id = ${g.id}`;
        await sql`INSERT INTO roots_edits (family, person, field, old, new) VALUES (${family}, ${g.person}, 'gallery', ${JSON.stringify({ removed: g.id })}::jsonb, null)`;
        return json({ ok: true });
      }
      return new Response('Method not allowed', { status: 405 });
    }

    // Photos, kept like the tree's profile photos: the small (cropped) one under "roots-<id>", the original
    // under "orig-roots-<id>".
    if (context.params.id && new URL(req.url).pathname.endsWith('/photo')) {
      const id = context.params.id;
      const [p] = await sql`SELECT p.id FROM roots_people p JOIN roots_members m ON m.person = p.id
                            WHERE p.id = ${id} AND m.family = ${family} AND m.kind <> 'hidden' AND NOT p.hidden`;
      if (!p) return new Response('Not found', { status: 404 });
      const store = getStore({ name: 'photos', consistency: 'strong' });
      const original = new URL(req.url).searchParams.get('size') === 'original';
      const key = `roots-${id}`;
      if (req.method === 'GET') {
        const res = (original && await store.getWithMetadata(`orig-${key}`, { type: 'arrayBuffer' })) || await store.getWithMetadata(key, { type: 'arrayBuffer' });
        if (!res) return new Response('Not found', { status: 404 });
        const headers = { 'content-type': res.metadata.type ?? 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' };
        if (original) headers['content-disposition'] = `attachment; filename="photo-${id}.${(res.metadata.type ?? 'image/jpeg').split('/')[1]}"`;
        return new Response(res.data, { headers });
      }
      if (req.method === 'PUT') {
        const type = req.headers.get('content-type') ?? '';
        if (!/^image\/(jpeg|png|webp)$/.test(type)) return new Response('Unsupported image type', { status: 415 });
        const data = await req.arrayBuffer();
        if (data.byteLength > (original ? 6 : 2) * 1024 * 1024) return new Response('Photo too large', { status: 413 });
        await keepAside(store, original ? `orig-${key}` : key);   // the one before stays, under archived/
        if (original) { await store.set(`orig-${key}`, data, { metadata: { type, at: new Date().toISOString() } }); return json({ ok: true }); }
        await store.set(key, data, { metadata: { type } });
        const v = Date.now();
        const [old] = await sql`SELECT photo_v FROM roots_people WHERE id = ${id}`;
        await sql`UPDATE roots_people SET photo_v = ${v}, updated_at = now() WHERE id = ${id}`;
        let by = UUID.test(req.headers.get('x-editor') ?? '') ? req.headers.get('x-editor') : null;
        await sql`INSERT INTO roots_edits (family, person, field, old, new, by_person)
                  VALUES (${family}, ${id}, 'photo', ${JSON.stringify({ photo_v: old?.photo_v ?? null })}::jsonb, ${JSON.stringify({ photo_v: v })}::jsonb, ${by})`;
        return json({ photo_v: v });
      }
      if (req.method === 'DELETE') {
        await sql`UPDATE roots_people SET photo_v = NULL, updated_at = now() WHERE id = ${id}`;
        await keepAside(store, key, `orig-${key}`);   // kept under archived/ before leaving their place
        await Promise.all([store.delete(key), store.delete(`orig-${key}`)]);
        return json({ ok: true });
      }
      return new Response('Method not allowed', { status: 405 });
    }

    if (req.method === 'PUT' && context.params.id) {
      const id = context.params.id;
      const [p] = await sql`
        SELECT p.* FROM roots_people p JOIN roots_members m ON m.person = p.id
        WHERE p.id = ${id} AND m.family = ${family} AND m.kind <> 'hidden' AND NOT p.hidden`;
      if (!p) return json({ error: 'not found' }, 404);
      // Credited to the editor's own person id, as on the tree; never to someone who passed away.
      let by = UUID.test(req.headers.get('x-editor') ?? '') ? req.headers.get('x-editor') : null;
      if (by) { const [e] = await sql`SELECT deceased FROM people WHERE id = ${by}`; if (!e || e.deceased) by = null; }
      const body = await req.json().catch(() => ({}));

      if (body.field === 'names') {
        const next = Object.fromEntries(NAMES.map((k) => [k, text(body[k])]));
        if (!next.he_first && !next.en_first) return json({ error: 'a first name is needed' }, 400);
        const old = Object.fromEntries(NAMES.map((k) => [k, p[k]]));
        const hyd = typeof body.hyd === 'boolean' ? body.hyd : p.hyd;
        // A title before the name (ר׳, הרב, הרבנית) and הכהן / הלוי: sent by the names sheet; left as they are when not sent.
        const extra = { known_he: 'known_he' in body ? text(body.known_he) : p.known_he, known_en: 'known_en' in body ? text(body.known_en) : p.known_en,
          title_he: 'title_he' in body ? text(body.title_he) : p.title_he, title_en: 'title_en' in body ? text(body.title_en) : p.title_en,
          tribe: 'tribe' in body ? (['levi', 'kohen'].includes(body.tribe) ? body.tribe : null) : p.tribe };
        const sameExtra = ['known_he', 'known_en', 'title_he', 'title_en', 'tribe'].every((k) => extra[k] === p[k]);
        if (NAMES.every((k) => old[k] === next[k]) && hyd === p.hyd && sameExtra) return json(p);
        // The names it had stay as aliases, so a search for them still finds this person.
        const was = [old.he_first, old.en_first, old.he_last, old.en_last, [old.he_first, old.he_last].filter(Boolean).join(' '), [old.en_first, old.en_last].filter(Boolean).join(' ')];
        // ...and what they are known as finds them too.
        const aliases = [...new Set([...(p.aliases ?? []), ...was.filter((x) => x && !Object.values(next).includes(x)), ...[extra.known_he, extra.known_en].filter(Boolean)])];
        const [saved] = await sql`
          UPDATE roots_people SET he_first = ${next.he_first}, he_last = ${next.he_last}, en_first = ${next.en_first}, en_last = ${next.en_last},
                 aliases = ${aliases}, hyd = ${hyd}, known_he = ${extra.known_he}, known_en = ${extra.known_en}, title_he = ${extra.title_he}, title_en = ${extra.title_en}, tribe = ${extra.tribe}, kohen = ${extra.tribe === 'kohen'},
                 updated_at = now() WHERE id = ${id} RETURNING *`;
        await sql`INSERT INTO roots_edits (family, person, field, old, new, by_person)
                  VALUES (${family}, ${id}, 'names', ${JSON.stringify({ ...old, aliases: p.aliases, hyd: p.hyd, known_he: p.known_he, known_en: p.known_en, title_he: p.title_he, title_en: p.title_en, tribe: p.tribe })}::jsonb, ${JSON.stringify({ ...next, aliases, hyd, ...extra })}::jsonb, ${by})`;
        return json(saved);
      }

      if (body.field === 'yahrzeit') {
        const d = Number(body.h_day), m = Number(body.h_month), y = body.h_year ? Number(body.h_year) : null;
        const h = d >= 1 && d <= 30 && m >= 1 && m <= 14 && (!y || (y >= 5000 && y <= 6100)) ? { h_day: d, h_month: m, h_year: y } : null;
        if (!h && !body.clear) return json({ error: 'a day and a month are needed' }, 400);
        const died = { ...(p.died ?? {}) };
        if (h) died.h = h; else delete died.h;
        const [saved] = await sql`UPDATE roots_people SET died = ${JSON.stringify(died)}::jsonb, updated_at = now() WHERE id = ${id} RETURNING *`;
        await sql`INSERT INTO roots_edits (family, person, field, old, new, by_person)
                  VALUES (${family}, ${id}, 'yahrzeit', ${JSON.stringify({ died: p.died })}::jsonb, ${JSON.stringify({ died })}::jsonb, ${by})`;
        return json(saved);
      }
      if (body.field === 'burial') {
        const burial = String(body.burial ?? '').trim().slice(0, 250) || null;
        if ((burial ?? null) === (p.burial ?? null)) return json(p);
        const [saved] = await sql`UPDATE roots_people SET burial = ${burial}, updated_at = now() WHERE id = ${id} RETURNING *`;
        await sql`INSERT INTO roots_edits (family, person, field, old, new, by_person)
                  VALUES (${family}, ${id}, 'burial', ${JSON.stringify({ burial: p.burial })}::jsonb, ${JSON.stringify({ burial })}::jsonb, ${by})`;
        return json(saved);
      }

      if (body.field === 'notable') {
        // The few words on a well-known figure (the line on the "Famous in the family" list), in each language.
        const he = String(body.notable_he ?? '').trim().slice(0, 200) || null, en = String(body.notable_en ?? '').trim().slice(0, 200) || null;
        if (he === (p.notable_he ?? null) && en === (p.notable_en ?? null)) return json(p);
        const [saved] = await sql`UPDATE roots_people SET notable_he = ${he}, notable_en = ${en}, updated_at = now() WHERE id = ${id} RETURNING *`;
        await sql`INSERT INTO roots_edits (family, person, field, old, new, by_person)
                  VALUES (${family}, ${id}, 'notable', ${JSON.stringify({ notable_he: p.notable_he, notable_en: p.notable_en })}::jsonb, ${JSON.stringify({ notable_he: he, notable_en: en })}::jsonb, ${by})`;
        return json(saved);
      }

      if (body.field === 'about') {
        const about = String(body.about ?? '').trim().slice(0, 8000) || null;
        if ((about ?? null) === (p.about ?? null)) return json(p);
        const [saved] = await sql`UPDATE roots_people SET about = ${about}, updated_at = now() WHERE id = ${id} RETURNING *`;
        await sql`INSERT INTO roots_edits (family, person, field, old, new, by_person)
                  VALUES (${family}, ${id}, 'about', ${JSON.stringify({ about: p.about })}::jsonb, ${JSON.stringify({ about })}::jsonb, ${by})`;
        return json(saved);
      }

      if (body.field === 'parents_note') {
        // The link to the parents is not certain: the notes on it (other options, sources). Empty = certain again.
        const parents_note = String(body.parents_note ?? '').trim().slice(0, 8000) || null;
        if ((parents_note ?? null) === (p.parents_note ?? null)) return json(p);
        const [saved] = await sql`UPDATE roots_people SET parents_note = ${parents_note}, updated_at = now() WHERE id = ${id} RETURNING *`;
        await sql`INSERT INTO roots_edits (family, person, field, old, new, by_person)
                  VALUES (${family}, ${id}, 'parents_note', ${JSON.stringify({ parents_note: p.parents_note })}::jsonb, ${JSON.stringify({ parents_note })}::jsonb, ${by})`;
        return json(saved);
      }

      if (body.field === 'dates') {
        // Born and passed away as calendar dates (any of day, month, year), with a place; "living" clears
        // the death and its yahrzeit; a short free-text note.
        // A Hebrew date (h: day, month, year if known) can go with either; the Hebrew date of passing is the yahrzeit.
        const heb = (h) => {
          if (!h || (!h.h_day && !h.h_month)) return null;
          const d = Number(h.h_day), m = Number(h.h_month), y = h.h_year ? Number(h.h_year) : null;
          return d >= 1 && d <= 30 && m >= 1 && m <= 14 && (!y || (y >= 5000 && y <= 6100)) ? { h_day: d, h_month: m, h_year: y } : 'bad';
        };
        const date = (x) => {
          if (!x) return null;
          const y = Number(x.y) || null, m = Number(x.m) || null, d = Number(x.d) || null, place = text(x.place), h = heb(x.h);
          if ((y && (y < 1000 || y > 2100)) || (m && (m < 1 || m > 12)) || (d && (d < 1 || d > 31)) || (d && !m) || h === 'bad') return 'bad';
          const out = { ...(y && { y }), ...(m && { m }), ...(d && { d }), ...(x.approx && y && { approx: 'בערך' }), ...(place && { place }), ...(h && { h }) };
          return Object.keys(out).length ? out : null;
        };
        const born = date(body.born), died = body.living ? null : date(body.died);
        if (born === 'bad' || died === 'bad') return json({ error: 'a date is not valid' }, 400);
        const note = String(body.note ?? '').trim().slice(0, 300) || null;
        const [saved] = await sql`
          UPDATE roots_people SET born = ${born && JSON.stringify(born)}::jsonb, died = ${died && JSON.stringify(died)}::jsonb, note = ${note}, updated_at = now()
          WHERE id = ${id} RETURNING *`;
        await sql`INSERT INTO roots_edits (family, person, field, old, new, by_person)
                  VALUES (${family}, ${id}, 'dates', ${JSON.stringify({ born: p.born, died: p.died, note: p.note })}::jsonb,
                          ${JSON.stringify({ born, died, note })}::jsonb, ${by})`;
        return json(saved);
      }
      return json({ error: 'nothing to change' }, 400);
    }
    return json({ error: 'not found' }, 404);
  } catch (e) {
    if (/roots_\w+" does not exist/.test(e.message)) return req.method === 'GET' ? json({ people: [], couples: [], spellings: [], photos: [] }) : json({ error: 'no roots here' }, 404);
    throw e;
  }
};

export const config = { path: ['/api/roots', '/api/roots/:id', '/api/roots/:id/photo', '/api/roots/:id/gallery', '/api/roots-gallery/:gid'] };
