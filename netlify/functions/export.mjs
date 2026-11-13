// A branch of the tree as data, for carrying it to another installation: a couple, everyone
// descended from them and those descendants' husbands and wives, with every column of their
// records and when each part was last changed. The page (src/export.js) adds the photos and the
// import instructions and hands it over as one zip.
//   GET /api/export/:id           id = the couple at the top of the branch
//   GET /api/export/:id?check=1   only whether this person may export it: { allowed }
// Off for everyone until the app admin turns it on for a person: people.can_export, set in the database. Until then the page offers to ask the admin by WhatsApp.
// Only for someone whose own line it is (the `x-editor` header: who this device says it is): the
// couple they are in, or a couple they or their husband or wife descend from (a married couple
// count as one, so he can take her side). Two trees share exactly the branch under the marriage
// that joins them, so that is all anyone needs to take. The top couple's branch is the whole
// tree and is refused.
import { sql } from '../lib/db.mjs';
import { isLoggedIn } from '../lib/auth.mjs';
import { familyOf } from '../lib/families.mjs';
import { familyScope, rootOf } from '../lib/family.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** The branch under `top` as it is exported. Pure: rows as the database has them.
 *  `site` is the scope of the site asked (lib/family.mjs): names from outside it are never given. */
export function branchExport({ people, couples, photos, edits }, top, site) {
  const live = people.filter((p) => !p.archived_at);
  const branch = familyScope(live, couples, top);
  const byId = new Map(people.map((p) => [p.id, p]));
  const coupleById = new Map(couples.map((c) => [c.id, c]));
  // When each part of a record was last changed, from the edit log: { names: '2026-…', photo: … }.
  const changed = new Map();
  for (const e of edits) (changed.get(e.person_id) ?? changed.set(e.person_id, {}).get(e.person_id))[e.field] = e.at;
  const name = (p) => p && { he: [p.he_first, p.he_last].filter(Boolean).join(' ') || null, en: [p.en_first, p.en_last].filter(Boolean).join(' ') || null };

  const outPeople = live.filter((p) => branch.members.has(p.id)).map((p) => {
    const { photo_v, archived_at, archived_by, can_export, ...row } = p;
    const out = { ...row, has_photo: Boolean(photo_v), changed: changed.get(p.id) ?? {} };
    // Parents above or beside the branch (the top couple's own, and those of people who married
    // in) aren't part of it: the link is left out, and their names given when this site shows them.
    if (p.parents && !branch.couples.has(p.parents)) {
      out.parents = null;
      const pc = site.couples.has(p.parents) ? coupleById.get(p.parents) : null;
      if (pc) {
        const [x, y] = [byId.get(pc.a), byId.get(pc.b)];
        const father = [x, y].find((q) => q?.sex === 'm') ?? (y?.sex === 'f' ? x : null);
        const mother = [x, y].find((q) => q?.sex === 'f') ?? (x?.sex === 'm' ? y : null);
        out.parents_outside = { father: name(father) ?? null, mother: name(mother) ?? null };
      }
    }
    return out;
  });
  const outCouples = couples.filter((c) => branch.couples.has(c.id)).map((c) => {
    const { photo_v, is_root, ...row } = c;
    // A spouse who was archived isn't exported: the couple is left with the one who is.
    if (row.b && !branch.members.has(row.b)) row.b = null;
    const log = changed.get(c.a) ?? {};
    return { ...row, has_photo: Boolean(photo_v), changed: Object.fromEntries(['anniversary', 'family_photo'].filter((k) => log[k]).map((k) => [k, log[k]])) };
  });
  const gallery = photos.filter((g) => branch.members.has(g.person_id)).map((g) => ({ id: g.id, person: g.person_id, added: g.created_at }));
  return { members: branch.members, people: outPeople, couples: outCouples, gallery };
}

/** Whether `top` is the couple `me` is in, or one that `me` or their spouse descends from. */
export function inOwnLine(people, couples, me, top) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const coupleById = new Map(couples.map((c) => [c.id, c]));
  const own = couples.find((c) => c.a === me || c.b === me);
  if (own?.id === top) return true;
  const spouse = own && (own.a === me ? own.b : own.a);
  const seen = new Set(), queue = [byId.get(me)?.parents, byId.get(spouse)?.parents];
  while (queue.length) {
    const c = coupleById.get(queue.shift());
    if (!c || seen.has(c.id)) continue;
    if (c.id === top) return true;
    seen.add(c.id);
    for (const x of [c.a, c.b]) if (byId.get(x)?.parents) queue.push(byId.get(x).parents);
  }
  return false;
}

export default async (req, context) => {
  if (!isLoggedIn(req)) return json({ error: 'login' }, 401);
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const { id } = context.params;
  if (!UUID.test(id ?? '')) return json({ error: 'not found' }, 404);
  const [people, couples, photos, edits] = await Promise.all([
    sql`SELECT * FROM people ORDER BY created_at, id`,
    sql`SELECT * FROM couples ORDER BY id`,
    sql`SELECT id, person_id, created_at FROM photos ORDER BY created_at, id`,
    // An edit that was put back (scripts/undo.mjs) changed the record again when it was undone.
    sql`SELECT person_id, field, max(greatest(at, undone_at)) AS at FROM edits WHERE person_id IS NOT NULL GROUP BY 1, 2`,
  ]);
  // Only a branch of the family this site shows.
  const root = rootOf(req, couples.map((c) => ({ ...c, root: c.is_root })));
  const site = familyScope(people, couples, root);
  if (!site.couples.has(id)) return json({ error: 'not found' }, 404);
  // Never the whole tree: the top couple's branch is everyone.
  if (id === root) return json({ error: 'the whole tree cannot be exported, only a branch of it' }, 403);
  const me = req.headers.get('x-editor') ?? '';
  if (!inOwnLine(people, couples, me, id)) return json({ error: 'not your own branch' }, 403);
  // Turned on for this person? 
  const allowed = people.find((p) => p.id === me)?.can_export === true;
  if (new URL(req.url).searchParams.has('check')) return json({ allowed });
  if (!allowed) return json({ error: 'not enabled' }, 403);
  const out = branchExport({ people, couples, photos, edits }, id, site);
  const family = familyOf(req);
  return json({
    format: 'family-tree-branch', version: 1,
    exported_at: new Date().toISOString(),
    source: { site: new URL(req.url).hostname, family: family.en },
    top_couple: id,
    people: out.people, couples: out.couples, gallery: out.gallery,
  });
};

export const config = { path: '/api/export/:id' };
