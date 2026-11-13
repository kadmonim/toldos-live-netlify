// Writes the invented family the site starts with: netlify/database/migrations/0002_family/migration.sql (for the database) and data/family.json (for the
// local preview and the demo). Nobody here is a real person; their portraits in public/people/ are
// AI-generated. Run: node scripts/make-sample.mjs
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const id = (label) => { const h = createHash('sha1').update(`sample:${label}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const people = [], couples = [];
let n = 0;
const CITIES = ['Jerusalem', 'Brooklyn, NY', 'London', 'Melbourne', 'Tzfat', 'Miami, FL'];
function person(en, he, sex, last, year, extra = {}) {
  n++;
  const adult = year < 5766;
  const p = {
    id: id(`${en}-${last[0]}-${year}`), he_first: he, he_full: he, en_first: en, he_last: last[1], en_last: last[0], sex,
    h_day: (n * 7) % 29 + 1, h_month: (n * 5) % 12 + 1, h_year: year, deceased: false, parents: null,
    city: adult ? CITIES[n % CITIES.length] : null,
    phone: adult ? `1-555-01${String(n).padStart(2, '0')}` : null,
    email: adult ? `${en.toLowerCase().replace(/\s/g, '')}${n}@example.com` : null,
    ...extra,
  };
  people.push(p);
  return p;
}
function couple(a, b, year, root = false) {
  const c = { id: id(`couple-${a.id}`), a: a.id, b: b.id, root, w_day: (n * 3) % 28 + 1, w_month: (n * 4) % 12 + 1, w_year: year };
  couples.push(c);
  return c;
}
const FAMILY = ['Rosenfeld', 'רוזנפלד'];
// The top couple.
const top = couple(
  person('Avraham', 'אברהם', 'm', FAMILY, 5700, { deceased: true, d_day: 12, d_month: 9, d_year: 5778, city: null, phone: null, email: null }),
  person('Sarah', 'שרה', 'f', FAMILY, 5703, { maiden: 'Schwartz' }), 5723, true);
// Their children, each with a spouse and children: [name, he, sex, spouse, spouse he, surname, year, wife's maiden name, kids]
const branches = [
  ['Yitzchak', 'יצחק', 'm', 'Rivka', 'רבקה', FAMILY, 5725, 'Levin', [['Yaakov', 'יעקב', 'm'], ['Leah', 'לאה', 'f'], ['Dovid', 'דוד', 'm'], ['Chana', 'חנה', 'f']]],
  ['Miriam', 'מרים', 'f', 'Aharon', 'אהרן', ['Katz', 'כץ'], 5727, null, [['Moshe', 'משה', 'm'], ['Devorah', 'דבורה', 'f'], ['Yosef', 'יוסף', 'm']]],
  ['Shmuel', 'שמואל', 'm', 'Esther', 'אסתר', FAMILY, 5730, 'Goldstein', [['Binyamin', 'בנימין', 'm'], ['Rochel', 'רחל', 'f'], ['Levi', 'לוי', 'm'], ['Dina', 'דינה', 'f'], ['Shimon', 'שמעון', 'm']]],
  ['Bracha', 'ברכה', 'f', 'Eliyahu', 'אליהו', ['Weiss', 'וייס'], 5734, null, [['Naftali', 'נפתלי', 'm'], ['Malka', 'מלכה', 'f']]],
];
// The eldest grandson's wife and children, in the first two branches.
const GRAND = {
  Yitzchak: ['Chaya', 'חיה', 'Segal', [['Chaim', 'חיים', 'm'], ['Shoshana', 'שושנה', 'f'], ['Yehuda', 'יהודה', 'm']]],
  Miriam: ['Sheindy', 'שיינדי', 'Friedlander', [['Mendel', 'מענדל', 'm'], ['Raizel', 'רייזל', 'f'], ['Zalman', 'זלמן', 'm']]],
};
for (const [en, he, sex, sEn, sHe, last, year, wifeMaiden, kids] of branches) {
  const child = person(en, he, sex, last, year, { parents: top.id, maiden: sex === 'f' ? FAMILY[0] : null });
  const spouse = person(sEn, sHe, sex === 'm' ? 'f' : 'm', last, year + 1, sex === 'm' ? { maiden: wifeMaiden } : {});
  const c = couple(child, spouse, year + 22);
  kids.forEach(([kEn, kHe, kSex], i) => {
    const kid = person(kEn, kHe, kSex, last, year + 24 + i * 2, { parents: c.id });
    // The eldest of the first two branches is married with children of their own.
    if (i === 0 && year < 5730) {
      const [spEn, spHe, spMaiden, grand] = GRAND[en];
      const sp = person(spEn, spHe, 'f', last, year + 25, { maiden: spMaiden });
      const kc = couple(kid, sp, year + 46);
      grand.forEach(([gEn, gHe, gSex], j) => person(gEn, gHe, gSex, last, year + 48 + j * 2, { parents: kc.id }));
    }
  });
}

// The newest generation, for the demo's "Mazal tov" (src/demo.js moves their dates close to the
// day the demo is opened): a new baby, a couple just married, and a couple engaged.
const find = (en, last) => people.find((p) => p.en_first === en && p.en_last === last);
person('Tzipora', 'צפורה', 'f', ['Katz', 'כץ'], 5787, { parents: couples.find((c) => c.a === find('Moshe', 'Katz').id).id });
couple(find('Levi', 'Rosenfeld'), person('Rivky', 'רבקי', 'f', FAMILY, 5763, { maiden: 'Klein' }), 5787);
Object.assign(couple(find('Dina', 'Rosenfeld'), person('Yisroel', 'ישראל', 'm', ['Mandel', 'מנדל'], 5761), 5787), { engaged: true, venue: 'Ateres Simcha Hall' });

// Newer households, added to the tree by someone but not filled in yet: no photos, and some without
// a birthday or contact details. "Complete the Family" lists them.
const KATZ = ['Katz', 'כץ'], WEISS = ['Weiss', 'וייס'];
const NOPHOTO = new Set();
const fresh = (...a) => { const x = person(...a); NOPHOTO.add(x.id); return x; };
{
  const gitty = fresh('Gitty', 'גיטי', 'f', FAMILY, 5756, { maiden: 'Brody', phone: null, email: null });
  const c = couple(find('Binyamin', 'Rosenfeld'), gitty, 5778);
  fresh('Yechiel', 'יחיאל', 'm', FAMILY, 5781, { parents: c.id });
  fresh('Chavi', 'חווי', 'f', FAMILY, 5784, { parents: c.id, h_day: null, h_month: null, h_year: null });
}
{
  const esty = fresh('Esty', 'אסתי', 'f', WEISS, 5760, { maiden: 'Gross', h_day: null, h_month: null, h_year: null });
  couple(find('Naftali', 'Weiss'), esty, 5782);
}
{
  const batsheva = fresh('Batsheva', 'בת שבע', 'f', KATZ, 5757, { maiden: 'Adler', city: null, email: null });
  const c = couple(find('Yosef', 'Katz'), batsheva, 5779);
  fresh('Avigail', 'אביגיל', 'f', KATZ, 5785, { parents: c.id });
  fresh('Meir', 'מאיר', 'm', KATZ, 5783, { parents: c.id, h_day: null, h_month: null, h_year: null });
}
// And a few gaps in profiles that are otherwise filled in.
NOPHOTO.add(find('Aharon', 'Katz').id);
NOPHOTO.add(find('Eliyahu', 'Weiss').id);
Object.assign(find('Leah', 'Rosenfeld'), { city: null, phone: null, email: null });
Object.assign(find('Shimon', 'Rosenfeld'), { h_day: null, h_month: null, h_year: null });

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : `'${String(v).replace(/'/g, "''")}'`);
const PCOLS = ['id', 'he_first', 'he_full', 'en_first', 'he_last', 'en_last', 'sex', 'maiden', 'h_day', 'h_month', 'h_year', 'd_day', 'd_month', 'd_year', 'deceased', 'city', 'phone', 'email'];
const CCOLS = ['id', 'a', 'b', 'w_day', 'w_month', 'w_year', 'engaged', 'venue'];
const lines = [
  '-- The invented family the site starts with (scripts/make-sample.mjs writes this file). Nobody here is a real person.',
  ...people.map((p) => `INSERT INTO people (${PCOLS.join(', ')}) VALUES (${PCOLS.map((k) => q(p[k])).join(', ')});`),
  ...couples.map((c) => `INSERT INTO couples (${CCOLS.join(', ')}, is_root) VALUES (${CCOLS.map((k) => q(k === 'engaged' ? Boolean(c[k]) : c[k])).join(', ')}, ${c.root ? 'TRUE' : 'FALSE'});`),
  ...people.filter((p) => p.parents).map((p) => `UPDATE people SET parents = ${q(p.parents)} WHERE id = ${q(p.id)};`),
];
writeFileSync(new URL('../netlify/database/migrations/0002_family/migration.sql', import.meta.url), `${lines.join('\n')}\n`);
writeFileSync(new URL('../data/family.json', import.meta.url), `${JSON.stringify({ people: people.map((p) => ({ ...p, photo: !NOPHOTO.has(p.id) && existsSync(new URL(`../public/people/${p.id}.jpg`, import.meta.url)) ? `/people/${p.id}.jpg` : null })), couples, edits: [] }, null, 1)}\n`);
console.log(`${people.length} people, ${couples.length} couples; first child: ${people[2].en_first} ${people[2].id}`);
