// Who belongs to a couple's family: the couple, everyone descended from them, and those descendants'
// husbands and wives. Pure (no database), so the page can use it too (the calendar feed's counts).

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
