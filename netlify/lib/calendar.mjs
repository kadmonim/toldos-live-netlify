// The calendar feed: a family's birthdays, anniversaries and yahrzeits as a calendar people subscribe
// to (Google Calendar, iPhone, Outlook). A link names a couple ("their family": the couple and
// everyone descended from them, with husbands and wives), the person who made it (whose ancestors'
// yahrzeits always come too) and a language. The list is worked out afresh each time the calendar
// app asks, so new people and corrected dates turn up by themselves.
// Pure (no database): the page uses `feedEntries` to show how many dates each choice brings.
import { familyScope } from './scope.mjs';
import { HDate, occurrences, dayName, monthName } from '../../src/hebrew.js';

/** What a link covers, as entries { kind, p | c, h_day, h_month, h_year }: the birthdays of the
 *  living, the anniversaries of couples still celebrating one, and the yahrzeits of those who passed
 *  away, in the couple's family; and the yahrzeits of `personId`'s ancestors (and their husband's
 *  or wife's) up to the top of the tree. `people` and `couples` are the site's own, without archived. */
export function feedEntries(people, couples, coupleId, personId) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const scope = familyScope(people, couples, coupleId);
  const out = [];
  for (const id of scope.members) {
    const p = byId.get(id);
    if (!p) continue;
    if (!p.deceased && p.h_day && p.h_month) out.push({ kind: 'birthday', p, h_day: p.h_day, h_month: p.h_month, h_year: p.h_year });
  }
  for (const c of couples) {
    if (!scope.couples.has(c.id) || !c.b || !c.w_day || !c.w_month || c.apart || (c.engaged && !c.w_year)) continue;
    if (byId.get(c.a)?.deceased || byId.get(c.b)?.deceased) continue;
    out.push({ kind: 'anniversary', c, h_day: c.w_day, h_month: c.w_month, h_year: c.w_year });
  }
  // Yahrzeits: the family's, and the ancestors' of whoever made the link.
  const gone = new Set([...scope.members].filter((id) => byId.get(id)?.deceased));
  const coupleById = new Map(couples.map((c) => [c.id, c]));
  const spouse = (id) => { const c = couples.find((x) => (x.a === id || x.b === id) && !x.apart); return c && (c.a === id ? c.b : c.a); };
  const up = [personId, personId && spouse(personId)].filter(Boolean);
  for (let i = 0; i < up.length && i < 64; i++) {
    const c = coupleById.get(byId.get(up[i])?.parents);
    for (const id of c ? [c.a, c.b] : []) {
      if (!id || up.includes(id)) continue;
      up.push(id);
      if (byId.get(id)?.deceased) gone.add(id);
    }
  }
  for (const id of gone) {
    const p = byId.get(id);
    if (p?.d_day && p.d_month) out.push({ kind: 'yahrzeit', p, h_day: p.d_day, h_month: p.d_month, h_year: p.d_year });
  }
  return out;
}

// ---- names and titles ----

const first = (p, l) => (l === 'he' ? p.he_first || p.en_first : p.en_first || p.he_first) ?? '';
const last = (p, l) => (l === 'he' ? p.he_last || p.en_last : p.en_last || p.he_last) ?? '';
const full = (p, l) => [first(p, l), last(p, l)].filter(Boolean).join(' ');
/** "Yitzchak & Rivka Rosenfeld": first names, the husband first, and his family name once. */
export function pairName(c, byId, l) {
  const both = [byId.get(c.a), byId.get(c.b)].filter(Boolean).sort((x, y) => (y.sex === 'm') - (x.sex === 'm'));
  return [both.map((x) => first(x, l)).join(' & '), both[0] && last(both[0], l)].filter(Boolean).join(' ');
}

const TITLE = {
  he: {
    birthday: (n, y) => (y ? `🎂 ${n} – יום הולדת ${y}` : `🎂 יום הולדת: ${n}`),
    bar: (n) => `✨ בר מצוה: ${n}`, bas: (n) => `✨ בת מצוה: ${n}`, upsherin: (n) => `✂️ אפשערניש: ${n}`,
    anniversary: (n, y) => (y ? `💍 ${n} – ${y === 1 ? 'שנה' : `${y} שנים`} לנישואין` : `💍 יום נישואין: ${n}`),
    yahrzeit: (n, y) => `🕯️ יארצייט${y ? ` ${y}` : ''}: ${n} ז"ל`,
    wedding: (n) => `💍 חתונה: ${n}`,
    profile: 'בעץ המשפחה',
  },
  en: {
    birthday: (n, y) => (y ? `🎂 ${n} turns ${y}` : `🎂 ${n}'s birthday`),
    bar: (n) => `✨ ${n}'s bar mitzvah`, bas: (n) => `✨ ${n}'s bas mitzvah`, upsherin: (n) => `✂️ ${n}'s upsherin`,
    anniversary: (n, y) => (y ? `💍 ${n}: ${y === 1 ? '1 year' : `${y} years`} married` : `💍 ${n}'s anniversary`),
    yahrzeit: (n, y) => `🕯️ Yahrzeit${y ? ` (${y})` : ''}: ${n}`,
    wedding: (n) => `💍 Wedding: ${n}`,
    profile: 'In the family tree',
  },
};
/** Bar mitzvah at 13, bas mitzvah at 12, upsherin at 3, as on the home page. */
const milestone = (e, years) => (e.kind !== 'birthday' ? null
  : e.p.sex === 'm' ? (years === 13 ? 'bar' : years === 3 ? 'upsherin' : null)
  : e.p.sex === 'f' && years === 12 ? 'bas' : null);

// ---- the calendar file (iCalendar, RFC 5545) ----

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
/** Lines longer than 75 bytes are folded (continued on the next line after a space). */
function fold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 73) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += n;
  }
  return [...out, cur].join('\r\n');
}

/** The calendar file for a link: every date from a month ago to two years ahead, as all-day events
 *  with the Hebrew date in the title and a link to the profile. `site` is the site's address. */
export function feedFile({ people, couples, coupleId, personId, lang, site, calName }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = new Date(today.getTime() - 31 * 864e5), to = new Date(today.getTime() + 731 * 864e5);
  const T = TITLE[lang];
  const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//family-tree//calendar feed//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H',
  ];
  for (const { entry: e, date, hd, years } of occurrences(feedEntries(people, couples, coupleId, personId), from, to)) {
    const name = e.c ? pairName(e.c, byId, lang) : full(e.p, lang);
    const big = milestone(e, years);
    const hebDate = `${dayName(hd.getDate(), lang)} ${monthName(hd.getMonth(), hd.getFullYear(), lang)}`;
    const summary = `${big ? T[big](name) : T[e.kind](name, years)} (${hebDate})`;
    const link = `https://${site}/#/person/${e.c ? e.c.a : e.p.id}`;
    const end = new Date(date.getTime() + 864e5);
    lines.push('BEGIN:VEVENT',
      `UID:${e.kind}-${e.c ? e.c.id : e.p.id}-${ymd(date)}@${site}`,
      `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(end)}`,
      `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(`${T.profile}: ${link}`)}`, `URL:${link}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  // Weddings: in every feed, whatever family it's for (the whole family goes). An engaged couple with
  // the wedding date and year known, on the day itself, with the hall as the place when it's known.
  // After the day it's their anniversary, in the feeds that cover their family.
  for (const c of couples) {
    if (!c.engaged || !c.b || !c.w_day || !c.w_month || !c.w_year || c.apart) continue;
    if (byId.get(c.a)?.deceased || byId.get(c.b)?.deceased) continue;
    const hd = new HDate(Math.min(c.w_day, HDate.daysInMonth(c.w_month, c.w_year)), c.w_month, c.w_year);
    const date = hd.greg();
    if (date < from || date > to) continue;
    const hebDate = `${dayName(hd.getDate(), lang)} ${monthName(hd.getMonth(), hd.getFullYear(), lang)}`;
    const link = `https://${site}/#/person/${c.a}`;
    lines.push('BEGIN:VEVENT',
      `UID:wedding-${c.id}-${ymd(date)}@${site}`,
      `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(new Date(date.getTime() + 864e5))}`,
      `SUMMARY:${esc(`${T.wedding(pairName(c, byId, lang))} (${hebDate})`)}`,
      ...(c.venue ? [`LOCATION:${esc(c.venue)}`] : []),
      `DESCRIPTION:${esc(`${T.profile}: ${link}`)}`, `URL:${link}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
