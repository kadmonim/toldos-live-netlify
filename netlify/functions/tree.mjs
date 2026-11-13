// The whole tree in one request (it's one family, a few hundred people at most), plus adding and
// editing people and couples. Every change is logged in `edits` under the editor's own person id
// (the `x-editor` header), which feeds the leaderboard and badges. Only the site's family is sent or
// can be changed (lib/family.mjs): people of other families are neither shown nor editable here.
import { getStore } from '@netlify/blobs';
import { sql } from '../lib/db.mjs';
import { isLoggedIn } from '../lib/auth.mjs';
import { familyScope, loadScope, rootOf, view } from '../lib/family.mjs';

const json = (body, status = 200) => Response.json(body, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v) => (typeof v === 'string' && UUID.test(v) ? v : null);

const TEXT = ['he_first', 'he_full', 'en_first', 'he_last', 'en_last', 'city', 'address', 'phone', 'email', 'hobby', 'occupation', 'maiden', 'father_name', 'mother_name'];
// Changed columns are logged as one edit per group.
const GROUPS = {
  names: ['he_first', 'he_full', 'en_first', 'he_last', 'en_last', 'maiden', 'father_name', 'mother_name'],
  birthday: ['h_day', 'h_month', 'h_year'],
  yahrzeit: ['d_day', 'd_month', 'd_year'],
  city: ['city'], address: ['address'], phone: ['phone'], email: ['email'], hobby: ['hobby'], occupation: ['occupation'], parents: ['parents'],
};

// hebcal's month numbers, plus 14 = plain Adar for a date without a year (see src/hebrew.js).
const isLeap = (y) => (7 * y + 1) % 19 < 7;
const realMonth = (m, y) => (m === 14 && y ? (isLeap(y) ? 13 : 12) : m);

function clean(body) {
  const p = {};
  // The full mailing address (for invitations) is longer than the rest; `city` stays the short form.
  for (const k of TEXT) p[k] = String(body[k] ?? '').trim().slice(0, k === 'address' ? 250 : 120) || null;
  p.he_full ??= p.he_first;   // the full Hebrew name starts out as the everyday one
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  p.h_day = int(body.h_day, 1, 30);
  p.h_month = int(body.h_month, 1, 14);
  p.h_year = p.h_day && p.h_month ? int(body.h_year, 5500, 6100) : null;
  p.h_month = realMonth(p.h_month, p.h_year);
  if (!p.h_day || !p.h_month) p.h_day = p.h_month = null;
  p.birth_order = p.h_day ? int(body.birth_order, 1, 9) : null;   // among twins: 1 = born first
  // The date of passing (for the yahrzeit), same rules as the birthday; the year may be unknown.
  p.d_day = int(body.d_day, 1, 30);
  p.d_month = int(body.d_month, 1, 14);
  p.d_year = p.d_day && p.d_month ? int(body.d_year, 5500, 6100) : null;
  p.d_month = realMonth(p.d_month, p.d_year);
  if (!p.d_day || !p.d_month) p.d_day = p.d_month = null;
  p.deceased = Boolean(body.deceased);
  p.sex = body.sex === 'm' || body.sex === 'f' ? body.sex : null;
  p.parents = uuidOrNull(body.parents);
  return p.he_first || p.en_first ? p : null;
}

// What an edit keeps so it can be undone (scripts/undo.mjs, straight on the database; the site itself
// has no undo): its group's columns before and after (a twin's place goes with the birthday). A couple's edit ("anniversary") keeps the wedding date, engaged and the venue.
const UNDO = { ...GROUPS, birthday: [...GROUPS.birthday, 'birth_order'] };
const WEDDING = ['w_day', 'w_month', 'w_year', 'engaged', 'venue'];
const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
const same = (a, b) => Object.keys(b).every((k) => (a[k] ?? null) === (b[k] ?? null));

/** Logs one edit per field. `was` and `now` (the row before and after) make it undoable. */
async function log(by, personId, fields, was = null, now = null, cols = UNDO) {
  for (const field of fields) {
    const keep = was && now && cols[field];
    const old = keep ? JSON.stringify(pick(was, cols[field])) : null;
    const next = keep ? JSON.stringify(pick(now, cols[field])) : null;
    await sql`INSERT INTO edits (by_person, person_id, field, old, new) VALUES (${by}, ${personId}, ${field}, ${old}::jsonb, ${next}::jsonb)`;
  }
}

export default async (req, context) => {
  if (!isLoggedIn(req)) return json({ error: 'login' }, 401);
  const url = new URL(req.url);
  let by = uuidOrNull(req.headers.get('x-editor'));
  // An edit is never credited to someone who has passed away (a page from before that was blocked).
  if (by && req.method !== 'GET') {
    const [editor] = await sql`SELECT deceased FROM people WHERE id = ${by}`;
    if (!editor || editor.deceased) by = null;
  }
  const id = uuidOrNull(context.params.id);

  if (req.method === 'GET' && url.pathname === '/api/tree') {
    const [people, couples, edits, recent, photos] = await Promise.all([
      sql`SELECT id, he_first, he_full, en_first, he_last, en_last, h_day, h_month, h_year, city, address, phone, email, hobby, occupation, deceased, parents, photo_v, birth_order,
                  maiden, father_name, mother_name, nickname, d_day, d_month, d_year, created_at, sex, archived_at FROM people ORDER BY created_at`,
      sql`SELECT id, a, b, is_root AS root, w_day, w_month, w_year, photo_v, apart, engaged, venue FROM couples`,
      sql`SELECT by_person AS by, field, count(*)::int AS n FROM edits WHERE by_person IS NOT NULL AND undone_at IS NULL GROUP BY 1, 2`,
      // The latest activity, for the home screen's "What's new": recent edits of every family, so this
      // family's 40 latest can be picked out below (busy days on one site mustn't crowd out another's).
      sql`SELECT by_person AS by, person_id AS person, field, at FROM edits WHERE undone_at IS NULL ORDER BY at DESC LIMIT 3000`,
      // Everyone's extra pictures (see gallery.mjs).
      sql`SELECT id, person_id AS person, created_at AS at FROM photos ORDER BY created_at`,
    ]);
    // The page treats this family's top couple as "the root" (it only ever sees one family).
    const root = rootOf(req, couples);
    const scope = familyScope(people, couples, root);
    const mine = (pid) => scope.members.has(pid);
    return json({
      people: people.filter((p) => mine(p.id)).map((p) => view(scope, p)),
      couples: couples.filter((c) => scope.couples.has(c.id)).map((c) => ({ ...c, root: c.id === root })),
      edits: edits.filter((e) => mine(e.by)),
      recent: recent.filter((e) => mine(e.person)).slice(0, 40).map((e) => (mine(e.by) ? e : { ...e, by: null })),
      photos: photos.filter((g) => mine(g.person)),
    });
  }

  // Changes are limited to the site's family (and to someone just added who isn't attached yet).
  const scope = await loadScope(req);
  const reachable = (pid) => scope.members.has(pid) || scope.unattached(pid);

  if (url.pathname.startsWith('/api/people')) {
    if (id && !reachable(id)) return json({ error: 'not found' }, 404);
    // Archiving (or restoring) a person: they stay in the database but leave the tree. Not someone
    // with children (the tree would lose a branch; archived children don't count), nor the top couple.
    if (req.method === 'POST' && id && url.pathname.endsWith('/archive')) {
      const { archived } = await req.json().catch(() => ({}));
      if (archived) {
        const [busy] = await sql`SELECT 1 AS x FROM couples c WHERE (c.a = ${id} OR c.b = ${id})
                                  AND (c.is_root OR EXISTS (SELECT 1 FROM people k WHERE k.parents = c.id AND k.archived_at IS NULL))`;
        if (busy) return json({ error: 'has children' }, 409);
      }
      const [r] = archived
        ? await sql`UPDATE people SET archived_at = now(), archived_by = ${by}, updated_at = now() WHERE id = ${id} RETURNING id, archived_at`
        : await sql`UPDATE people SET archived_at = NULL, archived_by = NULL, updated_at = now() WHERE id = ${id} RETURNING id, archived_at`;
      if (!r) return json({ error: 'not found' }, 404);
      await log(by, id, [archived ? 'archived' : 'restored']);
      return json(r);
    }
    // Removing a person: only someone nobody else depends on (no spouse, no children, no extra
    // pictures), which is what an accidental duplicate looks like. Their own profile photo goes too.
    if (req.method === 'DELETE' && id) {
      const [r] = await sql`DELETE FROM people WHERE id = ${id}
                            AND NOT EXISTS (SELECT 1 FROM couples WHERE a = ${id} OR b = ${id})
                            AND NOT EXISTS (SELECT 1 FROM photos WHERE person_id = ${id})
                            RETURNING id, photo_v`;
      if (!r) return json({ error: 'not found, or not a person without spouse, children or gallery pictures' }, 404);
      if (r.photo_v) { const store = getStore('photos'); await Promise.all([store.delete(id), store.delete(`orig-${id}`)]); }
      return json({ ok: true });
    }
    const body = await req.json().catch(() => ({}));
    const p = clean(body);
    if (!p) return json({ error: 'a person needs a first name' }, 400);
    // A new person's parents are a couple of this family, or none (a spouse, added before the couple).
    if (p.parents && !scope.couples.has(p.parents)) return json({ error: 'not found' }, 404);
    if (req.method === 'POST' && !context.params.id) {
      // The client picks the id, so a retry after a lost reply finds the person already there
      // instead of adding them twice.
      const newId = uuidOrNull(body.id) ?? crypto.randomUUID();
      const [r] = await sql`INSERT INTO people (id, he_first, he_full, en_first, he_last, en_last, h_day, h_month, h_year, sex,
                                                city, address, phone, email, hobby, occupation, maiden, father_name, mother_name, deceased, parents)
                            VALUES (${newId}, ${p.he_first}, ${p.he_full}, ${p.en_first}, ${p.he_last}, ${p.en_last}, ${p.h_day}, ${p.h_month},
                                    ${p.h_year}, ${p.sex}, ${p.city}, ${p.address}, ${p.phone}, ${p.email}, ${p.hobby}, ${p.occupation}, ${p.maiden}, ${p.father_name}, ${p.mother_name}, ${p.deceased}, ${p.parents})
                            ON CONFLICT (id) DO NOTHING
                            RETURNING id, he_first, he_full, en_first, he_last, en_last, h_day, h_month, h_year, city, address, phone, email, hobby, occupation, maiden, father_name, mother_name, deceased, d_day, d_month, d_year, parents, photo_v, birth_order, sex`;
      if (!r) {
        if (!reachable(newId)) return json({ error: 'not found' }, 404);
        const [existing] = await sql`SELECT id, he_first, he_full, en_first, he_last, en_last, h_day, h_month, h_year, city, address, phone, email, hobby, occupation, maiden, father_name, mother_name, deceased, d_day, d_month, d_year, parents, photo_v, birth_order, sex FROM people WHERE id = ${newId}`;
        return json(view(scope, existing));
      }
      // Someone adding themselves has no id yet: count it as their own edit.
      await log(by ?? r.id, r.id, ['added']);
      return json(r, 201);
    }
    if (req.method === 'PUT' && id) {
      const [old] = await sql`SELECT id, he_first, he_full, en_first, he_last, en_last, h_day, h_month, h_year, city, address, phone, email, hobby, occupation, maiden, father_name, mother_name, deceased, d_day, d_month, d_year, parents, photo_v, birth_order FROM people WHERE id = ${id}`;
      if (!old) return json({ error: 'not found' }, 404);
      // The page doesn't know a married-in person's parents (another family's couple), so it sends
      // none: keep the link instead of clearing it.
      if (!p.parents && old.parents && !scope.couples.has(old.parents)) p.parents = old.parents;
      // A page from before these fields existed doesn't send them: keep what's stored.
      for (const k of ['maiden', 'father_name', 'mother_name', 'occupation', 'address', 'd_day', 'd_month', 'd_year']) if (!(k in body)) p[k] = old[k];
      const [r] = await sql`UPDATE people SET he_first = ${p.he_first}, he_full = ${p.he_full}, en_first = ${p.en_first}, he_last = ${p.he_last},
                                   en_last = ${p.en_last}, h_day = ${p.h_day}, h_month = ${p.h_month}, h_year = ${p.h_year}, birth_order = ${p.birth_order},
                                   city = ${p.city}, address = ${p.address}, phone = ${p.phone}, email = ${p.email}, hobby = ${p.hobby}, occupation = ${p.occupation},
                                   maiden = ${p.maiden}, father_name = ${p.father_name}, mother_name = ${p.mother_name}, deceased = ${p.deceased}, d_day = ${p.d_day}, d_month = ${p.d_month}, d_year = ${p.d_year}, sex = ${p.sex},
                                   parents = ${p.parents}, updated_at = now()
                            WHERE id = ${id} RETURNING id, he_first, he_full, en_first, he_last, en_last, h_day, h_month, h_year, city, address, phone, email, hobby, occupation, maiden, father_name, mother_name, deceased, d_day, d_month, d_year, parents, photo_v, birth_order, sex`;
      await log(by, id, Object.keys(GROUPS).filter((g) => GROUPS[g].some((k) => (old[k] ?? null) !== (r[k] ?? null))), old, r);
      return json(view(scope, r));
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/couples') {
    const body = await req.json().catch(() => ({}));
    const a = uuidOrNull(body.a), b = uuidOrNull(body.b);
    if (!a || a === b) return json({ error: 'invalid couple' }, 400);
    if (!reachable(a) || (b && !reachable(b))) return json({ error: 'not found' }, 404);
    // A person is in at most one couple here; adding a spouse to a single parent fills in `b`.
    const [existing] = await sql`SELECT id, a, b, is_root AS root, w_day, w_month, w_year, photo_v, apart, engaged, venue FROM couples WHERE a = ${a} OR b = ${a}`;
    if (existing) {
      if (existing.b || !b) return json(existing);
      const [r] = await sql`UPDATE couples SET b = ${b} WHERE id = ${existing.id} RETURNING id, a, b, is_root AS root, w_day, w_month, w_year, photo_v, apart, engaged, venue`;
      return json(r);
    }
    const [r] = await sql`INSERT INTO couples (a, b) VALUES (${a}, ${b}) RETURNING id, a, b, is_root AS root, w_day, w_month, w_year, photo_v, apart, engaged, venue`;
    return json(r, 201);
  }

  // The wedding date, for anniversaries, whether the couple are still engaged, and the wedding's venue.
  if (req.method === 'PUT' && url.pathname.startsWith('/api/couples/') && id) {
    if (!scope.couples.has(id)) return json({ error: 'not found' }, 404);
    const body = await req.json().catch(() => ({}));
    const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
    let d = int(body.w_day, 1, 30), m = int(body.w_month, 1, 14);
    const y = d && m ? int(body.w_year, 5500, 6100) : null;
    m = realMonth(m, y);
    if (!d || !m) d = m = null;
    // Engaged or not: only when sent (a page from before this existed keeps what's stored).
    const engaged = typeof body.engaged === 'boolean' ? body.engaged : null;
    // The venue likewise only when sent; an empty one clears it.
    const hasVenue = typeof body.venue === 'string' || body.venue === null;
    const venue = String(body.venue ?? '').trim().slice(0, 120) || null;
    const [was] = await sql`SELECT w_day, w_month, w_year, engaged, venue FROM couples WHERE id = ${id}`;
    const [r] = await sql`UPDATE couples SET w_day = ${d}, w_month = ${m}, w_year = ${y}, engaged = COALESCE(${engaged}, engaged),
                                 venue = CASE WHEN ${hasVenue} THEN ${venue} ELSE venue END WHERE id = ${id}
                          RETURNING id, a, b, is_root AS root, w_day, w_month, w_year, photo_v, apart, engaged, venue`;
    if (!r) return json({ error: 'not found' }, 404);
    // Undoable only when something did change.
    const changed = was && !same(was, pick(r, WEDDING));
    await log(by, r.a, ['anniversary'], changed ? was : null, changed ? r : null, { anniversary: WEDDING });
    return json(r);
  }

  return json({ error: 'not found' }, 404);
};

export const config = { path: ['/api/tree', '/api/people', '/api/people/:id', '/api/people/:id/archive', '/api/couples', '/api/couples/:id'] };
