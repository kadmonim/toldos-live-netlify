// How two people are related, across the tree and the earlier roots.
// Pure: no DOM, no state. The page builds one graph from the tree and the roots; a roots person who is
// also in the tree (main_person) is the same node, so both sources' parents and marriages count.
//
//   const g = kinGraph(treePeople, treeCouples, rootsPeople, rootsCouples)
//   relations(g, viewerId, targetId)  -> [{ kind, label: {he, en}, line: {he, en}?, via, path }]  closest first
//   dor(g, viewerId, targetId)        -> number | null   (their son = דור 1)
// English uses the family's words (Zaidy, Bubby for grandparents; great-grandfather/-mother above; Uncle, Aunt); Hebrew spells out a distant cousin with a
// second line ("בן דוד של סבא שלך") instead of "removed".

export function kinGraph(treePeople = [], treeCouples = [], rootsPeople = [], rootsCouples = []) {
  const node = new Map();      // id -> { id, sex, he, en, hidden, src }
  const alias = new Map();     // roots id -> tree id (main_person)
  const id = (x) => (x == null ? x : alias.get(x) ?? x);
  for (const p of rootsPeople) if (p.main_person) alias.set(p.id, p.main_person);
  const name = (p) => ({
    he: [p.he_first, p.he_last].filter(Boolean).join(' ') || [p.en_first, p.en_last].filter(Boolean).join(' '),
    en: [p.en_first, p.en_last].filter(Boolean).join(' ') || [p.he_first, p.he_last].filter(Boolean).join(' '),
  });
  const sexOf = (p) => (p.sex ? String(p.sex).toUpperCase() : null);   // the tree stores 'm'/'f', the roots 'M'/'F'
  for (const p of treePeople) node.set(p.id, { id: p.id, sex: sexOf(p), ...name(p), src: 'tree' });
  for (const p of rootsPeople) {
    const k = id(p.id);
    if (node.has(k)) { if (!node.get(k).sex && p.sex) node.get(k).sex = sexOf(p); continue; }
    node.set(k, { id: k, sex: sexOf(p), ...name(p), hidden: !!p.hidden, src: 'roots', rootsId: p.id });
  }
  const parentsOf = new Map();     // id -> { couple, ids: [a, b] }
  const spouses = new Map();       // id -> Set
  const coupleIds = new Map();
  const addCouple = (c, src) => {
    const a = id(c.a), b = id(c.b);
    coupleIds.set(`${src}:${c.id}`, [a, b].filter(Boolean));
    if (a && b) { (spouses.get(a) ?? spouses.set(a, new Set()).get(a)).add(b); (spouses.get(b) ?? spouses.set(b, new Set()).get(b)).add(a); }
  };
  for (const c of treeCouples) addCouple(c, 'tree');
  for (const c of rootsCouples) addCouple(c, 'roots');
  for (const p of treePeople) if (p.parents && coupleIds.has(`tree:${p.parents}`)) parentsOf.set(p.id, { couple: `tree:${p.parents}`, ids: coupleIds.get(`tree:${p.parents}`) });
  for (const p of rootsPeople) {
    const k = id(p.id);
    if (!parentsOf.has(k) && p.parents && coupleIds.has(`roots:${p.parents}`)) parentsOf.set(k, { couple: `roots:${p.parents}`, ids: coupleIds.get(`roots:${p.parents}`) });
  }
  return { node, parentsOf, spouses, id };
}

/** Every ancestor of `x` with the number of steps up (x itself = 0) and the first step's child on the way. */
function ancestors(g, x) {
  // Kept per graph (the graph is rebuilt when the family changes): a deep family (one family here has 49 generations, many shared
  // ancestors) asks for the same people's ancestors thousands of times in one search. Callers only read the map.
  const cache = g.ancestorsCache ??= new Map();
  if (cache.has(x)) return cache.get(x);
  const out = new Map([[x, { up: 0, via: null }]]);
  cache.set(x, out);
  const queue = [x];
  while (queue.length) {
    const cur = queue.shift();
    for (const p of g.parentsOf.get(cur)?.ids ?? []) {
      if (!out.has(p)) { out.set(p, { up: out.get(cur).up + 1, from: cur }); queue.push(p); }
    }
  }
  return out;
}

/** The line from `x` up to ancestor `top`: [x, parent, ..., top]. */
function lineUp(anc, x, top) {
  const path = [top];
  for (let cur = top; cur !== x; ) { cur = anc.get(cur).from; path.unshift(cur); }
  return path;
}

const ORD_EN = ['', '1st', '2nd', '3rd'];
const ordEn = (n) => ORD_EN[n] ?? `${n}th`;
const ORD_HE_M = ['', '', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני'];
const ORD_HE_F = ['', '', 'שנייה', 'שלישית', 'רביעית', 'חמישית', 'שישית', 'שביעית', 'שמינית'];
const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times'];
const greats = (n) => (n <= 0 ? '' : n <= 2 ? 'great-'.repeat(n) : `${ordEn(n)} great-`);
const isF = (sex) => sex === 'F';

/** The word for an ancestor `up` steps above (1 = parent). From 4 up, Hebrew is "סבא רבא" / "סבתא רבה"
 *  with the generation number at the end of the whole phrase ("סבתא רבה של אשתך (דור 6)"): `dor`. */
function ancestorWord(up, sex) {
  const f = isF(sex);
  if (up === 1) return { en: f ? 'mother' : 'father', he: f ? 'אמא' : 'אבא' };
  // From 4 up, English is "great-grandfather" with the generation at the end too ("your wife's great-grandmother (Generation 5)").
  const en = up === 2 ? (f ? 'Bubby' : 'Zaidy') : f ? 'great-grandmother' : 'great-grandfather';   // Zaidy/Bubby only for grandparents
  const he = up === 2 ? (f ? 'סבתא' : 'סבא') : (f ? 'סבתא רבה' : 'סבא רבא');
  return up >= 4 ? { en, he, dor: up } : { en, he };   // דור X = X generations after them (their son = דור 1)
}
/** The word for a descendant `down` steps below (1 = child). */
function descendantWord(down, sex) {
  const f = isF(sex);
  if (down === 1) return { en: f ? 'daughter' : 'son', he: f ? 'בת' : 'בן' };
  const en = `${greats(down - 2)}grand${f ? 'daughter' : 'son'}`;
  const he = down === 2 ? (f ? 'נכדה' : 'נכד') : down === 3 ? (f ? 'נינה' : 'נין') : down === 4 ? (f ? 'חימשה' : 'חימש') : (f ? 'צאצאית' : 'צאצא');
  return { en, he };
}
function cousinWord(k, sex) {
  const f = isF(sex);
  return {
    en: `${k === 1 ? '1st' : ordEn(k)} cousin`,
    he: k === 1 ? (f ? 'בת דודה' : 'בן דוד') : `${f ? 'בת דודה' : 'בן דוד'} ${(f ? ORD_HE_F : ORD_HE_M)[k] ?? k}`,
  };
}
const yourHe = (w) => `${w} שלך`;

/**
 * The relationship by blood when the closest shared ancestor is `up` steps above the viewer and `down`
 * steps above the target. `sex` is the target's; `ancSex(n)` is the sex of the viewer's ancestor n steps up
 * (for the spelled-out line); `tgtSex(n)` the same on the target's side. Returns { en, he, line? }.
 */
export function bloodLabel(up, down, sex, ancSex = () => null, half = false, tgtSex = () => null) {
  const H = half ? 'half-' : '', HH = half ? ' (מצד אחד)' : '';
  const f = isF(sex);
  if (up === 0 && down === 0) return { en: 'you', he: 'את/ה' };
  if (down === 0) return ancestorWord(up, sex);
  if (up === 0) return descendantWord(down, sex);
  if (up === 1 && down === 1) return { en: `${H}${f ? 'sister' : 'brother'}`, he: `${f ? 'אחות' : 'אח'}${HH}` };
  if (down === 1) {        // a sibling of the viewer's ancestor
    const g = up - 2;
    const sib = ancestorWord(up - 1, ancSex(up - 1));
    const enU = up <= 4 ? `${H}${greats(g)}${f ? 'Aunt' : 'Uncle'}` : `${H}${f ? 'sister' : 'brother'} of your ${sib.en}`;
    return { en: enU, he: up === 2 ? `${f ? 'דודה' : 'דוד'}${HH}` : `${f ? 'אחות' : 'אח'} של ${sib.he} שלך${HH}`, dor: sib.dor };
  }
  if (up === 1) {          // a descendant of the viewer's sibling
    const g = down - 2;
    const d = descendantWord(down - 1, sex);
    return { en: `${H}${greats(g)}${f ? 'niece' : 'nephew'}`, he: down === 2 ? `${f ? 'אחיינית' : 'אחיין'}${HH}` : `${d.he} של ${f ? 'אחותך' : 'אחיך'}${HH}` };
  }
  const k = Math.min(up, down) - 1, r = Math.abs(up - down);
  const c = cousinWord(k, sex);
  const en = `${H}${c.en}${r ? ` ${TIMES[r] ?? `${r} times`} removed` : ''}`;
  if (!r) return { en, he: c.he + HH };
  if (up > down) {        // the target is a cousin of the viewer's ancestor
    const a = ancestorWord(r, ancSex(r));
    return { en, he: `${c.he} של ${a.he} שלך${HH}`, dor: a.dor, line: { en: `your ${a.en}'s ${c.en}`, he: `${c.he} של ${a.he} שלך` } };
  }
  const d = descendantWord(r, sex);   // the target is a descendant of the viewer's cousin
  const cc = cousinWord(k, tgtSex(r));   // the viewer's cousin is the target's ancestor r steps up: their own sex
  return { en, he: `${d.he} של ${yourHe(cc.he)}${HH}`, line: { en: `your ${cc.en}'s ${d.en}`, he: `${d.he} של ${yourHe(cc.he)}` } };
}

/** Every way `viewer` and `target` are related, closest first. */
export function relations(g, viewer, target) {
  const add = (x, d) => x && { en: `${x.en} (Generation ${d})`, he: `${x.he} (דור ${d})` };
  return rawRelations(g, viewer, target).map((r) => (r.label.dor
    ? { ...r, label: { ...add(r.label, r.label.dor), line: add(r.label.line, r.label.dor) } }
    : r));
}

function rawRelations(g, viewer, target, throughSpouse = true) {
  viewer = g.id(viewer); target = g.id(target);
  if (!g.node.has(viewer) || !g.node.has(target)) return [];
  if (viewer === target) return [{ kind: 'self', label: { en: 'you', he: 'את/ה' }, dist: 0, path: [viewer] }];
  const av = ancestors(g, viewer);
  const out = [];
  // Someone's ancestors as a whole, and also through each parent on their own: a line through the mother can lead
  // to other shared ancestors than the father's (a nephew whose mother is also your 3rd cousin is related twice).
  const sides = (x) => [ancestors(g, x), ...(g.parentsOf.get(x)?.ids ?? []).map((q) => {
    const m = new Map([[x, { up: 0, via: null }]]);
    for (const [k, v] of ancestors(g, q)) m.set(k, { up: v.up + 1, from: v.from ?? x });
    return m;
  })];
  const sidesV = sides(viewer);
  const blood = (to, extraDist = 0) => {
    const res = [];
    const seen = new Set();
    for (const av of sidesV) for (const at of sides(to)) {
      const common = [...av.keys()].filter((x) => at.has(x));
      // The nearest shared ancestors: not themselves above another shared one. One line per couple.
      const lowest = common.filter((x) => !common.some((y) => y !== x && ancestors(g, y).has(x)));
      for (const x of lowest.sort((a, b) => av.get(a).up + at.get(a).up - (av.get(b).up + at.get(b).up))) {
        const pair = [x, ...[...(g.spouses.get(x) ?? [])].filter((s) => lowest.includes(s))].sort().join('+');
        if (seen.has(pair)) continue;
        seen.add(pair);
        const up = av.get(x).up, down = at.get(x).up;
        const pv = lineUp(av, viewer, x), pt = lineUp(at, to, x);
        // Half: the two lines come down from the shared ancestor through different marriages.
        const cv = pv[pv.length - 2], ct = pt[pt.length - 2];
        const half = up > 0 && down > 0 && cv && ct && g.parentsOf.get(cv)?.couple !== g.parentsOf.get(ct)?.couple;
        const ancSex = (n) => g.node.get(pv[n])?.sex;
        res.push({ up, down, via: x, half, path: [...pv, ...pt.slice(0, -1).reverse()], dist: up + down + extraDist,
                   label: bloodLabel(up, down, g.node.get(to).sex, ancSex, half, (n) => g.node.get(pt[n])?.sex) });
      }
    }
    // The same relationship found along two lines (e.g. full brothers through each parent) once.
    const labels = new Set();
    return res.sort((a, b) => a.dist - b.dist).filter((r) => !labels.has(r.label.he) && labels.add(r.label.he));
  };
  for (const r of blood(target)) out.push({ kind: 'blood', ...r });
  // By marriage: the husband or wife of a blood relative (not both direct ancestors, e.g. your own Zaidy and Bubby).
  const direct = (x) => av.has(x) || ancestors(g, x).has(viewer);
  for (const s of g.spouses.get(target) ?? []) {
    // Your own husband or wife.
    if (s === viewer) { out.push({ kind: 'spouse', dist: 1, path: [viewer, target], label: isF(g.node.get(target).sex) ? { en: 'your wife', he: 'אשתך' } : { en: 'your husband', he: 'בעלך' } }); continue; }
    if (direct(s) && direct(target)) continue;
    for (const r of blood(s, 1)) {
      const sp = isF(g.node.get(target).sex) ? { en: 'wife', he: 'אשתו' } : { en: 'husband', he: 'בעלה' };
      const rel = bloodLabel(r.up, r.down, g.node.get(s).sex, (n) => g.node.get(r.path[n])?.sex, r.half, (n) => g.node.get(r.path[r.path.length - 1 - n])?.sex);
      out.push({ kind: 'marriage', via: r.via, spouse: s, dist: r.dist, path: [...r.path, target],
                 label: { en: `${sp.en} of your ${rel.en}`, he: `${isF(g.node.get(target).sex) ? 'אשתו של' : 'בעלה של'} ${rel.he.replace(/ שלך$/, '')}${/(אחותך|אחיך)$/.test(rel.he) ? '' : ' שלך'}`, dor: rel.dor } });   // "…של אחותך" already says "your"
      break;
    }
  }
  // Through your own husband or wife: "your wife's great-grandfather", or by marriage on their side too:
  // "husband of your wife's 3rd cousin".
  // Also when they're a blood relative: someone can be both your sister-in-law and your 3rd cousin.
  if (throughSpouse) {   // only one step through a spouse: their spouse is you again
    for (const s of g.spouses.get(viewer) ?? []) {
      // Every blood tie, and the closest by marriage (e.g. your wife's brother's wife and her 2nd cousin's daughter).
      const via = rawRelations(g, s, target, false);
      for (const r of [...via.filter((x) => x.kind === 'blood'), via.find((x) => x.kind === 'marriage')].filter(Boolean)) {
        const sw = isF(g.node.get(s).sex) ? { en: 'wife', he: 'אשתך' } : { en: 'husband', he: 'בעלך' };
        const en = r.label.en.includes('your ') ? r.label.en.replace('your ', `your ${sw.en}'s `) : `your ${sw.en}'s ${r.label.en}`;
        // "your" goes to your wife: "… שלך" becomes "… של אשתך", and "אחותך" / "אחיך" (your sister / brother) "אחות / אח של אשתך".
        const own = r.label.he.replace(/אחותך/g, 'אחות').replace(/אחיך/g, 'אח');
        const he = / שלך$/.test(own) ? own.replace(/ שלך$/, ` של ${sw.he}`) : `${own} של ${sw.he}`;
        out.push({ kind: 'in-law', from: r.kind, via: r.via, spouse: s, dist: r.dist + 1, path: [viewer, ...r.path], label: { en, he, dor: r.label.dor } });
      }
    }
  }
  // Ties through your own husband or wife are added only where they say something: when you're related yourself
  // (by blood or marriage), only the close ones (your wife's brother, her nephew); when you're not, every blood tie
  // of theirs, and the close ones by marriage (your wife's brother's wife). At least the closest tie is always kept.
  const own = out.some((r) => r.kind !== 'in-law');
  // Your own child, parent, brother or sister needs nothing through your husband or wife ("your wife's son").
  const near = out.some((r) => r.kind === 'blood' && r.dist <= 2);
  const keep = (r) => r.kind !== 'in-law' || (!near && (r.dist <= 4 || (!own && r.from === 'blood')));
  const sorted = out.sort((a, b) => a.dist - b.dist);
  // The closest stays even beside farther ones that are kept (married to your wife's cousin, and her distant cousin too).
  return sorted.filter((r, i) => i === 0 || keep(r));
}

/** דור X: how many generations the viewer comes after the target (their child = דור 1). Only for an
 *  ancestor, or the brother/sister of an ancestor (counted through the ancestor at that generation). */
export function dor(g, viewer, target) {
  viewer = g.id(viewer); target = g.id(target);
  const av = ancestors(g, viewer);
  if (av.has(target)) return av.get(target).up;
  const at = ancestors(g, target);
  const shared = [...at.keys()].filter((x) => av.has(x) && at.get(x).up === 1);
  return shared.length ? av.get(shared[0]).up - 1 : null;
}
