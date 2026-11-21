// Which people a site shows: one family per site. A family is its
// top couple, everyone descended from them, and those descendants' husbands and wives; nothing is
// tagged by hand. Which family a site is comes from its address (families.mjs).
import { sql } from './db.mjs';
import { familyOf, FAMILIES } from './families.mjs';
import { familyScope } from './scope.mjs';

export { familyScope };

/** The top couple of this request's family. */
export const rootOf = (req, couples) => familyOf(req).root ?? couples.find((c) => c.root)?.id;

/** The family this request's site shows. */
export async function loadScope(req) {
  const [people, couples] = await Promise.all([
    sql`SELECT id, parents FROM people`,
    sql`SELECT id, a, b, is_root AS root FROM couples`,
  ]);
  return familyScope(people, couples, rootOf(req, couples));
}

/** Is this person in the tree of one of this site's sister families (families.mjs: kin)? Their profile picture
 *  shows here, with them, in the extended family. */
export async function inKinTree(req, id) {
  const kin = (familyOf(req).kin ?? []).map((k) => FAMILIES.find((f) => f.key === k)).filter(Boolean);
  if (!kin.length) return false;
  const [people, couples] = await Promise.all([sql`SELECT id, parents FROM people WHERE archived_at IS NULL`, sql`SELECT id, a, b, is_root AS root FROM couples`]);
  return kin.some((f) => familyScope(people, couples, f.root ?? couples.find((c) => c.root)?.id).members.has(id));
}

/** The top couples of this site's sister families (tree people ids): the brother or sister of this family's own
 *  top couple, with their husband or wife. Their whole profile can be seen here (pictures, documents), not changed. */
export async function kinTops(req) {
  const kin = (familyOf(req).kin ?? []).map((k) => FAMILIES.find((f) => f.key === k)).filter(Boolean);
  if (!kin.length) return new Set();
  const couples = await sql`SELECT id, a, b, is_root AS root FROM couples`;
  return new Set(kin.flatMap((f) => { const c = couples.find((x) => x.id === (f.root ?? couples.find((y) => y.root)?.id)); return c ? [c.a, c.b].filter(Boolean) : []; }));
}

/** A person as this site shows them: a married-in member's parents are in another family, so the
 *  link isn't shown here (it stays in the database). */
export const view = (scope, p) => (p && p.parents && !scope.couples.has(p.parents) ? { ...p, parents: null } : p);
