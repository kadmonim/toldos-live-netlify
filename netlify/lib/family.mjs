// Which people a site shows: one family per site. A family is its
// top couple, everyone descended from them, and those descendants' husbands and wives; nothing is
// tagged by hand. Which family a site is comes from its address (families.mjs).
import { sql } from './db.mjs';
import { familyOf } from './families.mjs';

/** The family's member people ids and its couples (the top couple and every couple with a member
 *  descended from it). Pure: `people` need { id, parents }, `couples` { id, a, b }. */
export function familyScope(people, couples, rootId) {
  const coupleOf = new Map();
  for (const c of couples) { coupleOf.set(c.a, c); if (c.b) coupleOf.set(c.b, c); }
  const kids = new Map();
  for (const p of people) if (p.parents) (kids.get(p.parents) ?? kids.set(p.parents, []).get(p.parents)).push(p.id);
  const members = new Set(), famCouples = new Set();
  const queue = couples.filter((c) => c.id === rootId);
  while (queue.length) {
    const c = queue.shift();
    if (famCouples.has(c.id)) continue;
    famCouples.add(c.id);
    members.add(c.a); if (c.b) members.add(c.b);
    for (const k of kids.get(c.id) ?? []) {
      members.add(k);
      const kc = coupleOf.get(k);
      if (kc) queue.push(kc);
    }
  }
  return {
    members, couples: famCouples,
    /** Someone just added who isn't attached to anyone yet (a new spouse, before the couple is made). */
    unattached: (id) => !members.has(id) && !coupleOf.has(id) && !people.find((p) => p.id === id)?.parents,
  };
}

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

/** A person as this site shows them: a married-in member's parents are in another family, so the
 *  link isn't shown here (it stays in the database). */
export const view = (scope, p) => (p && p.parents && !scope.couples.has(p.parents) ? { ...p, parents: null } : p);
