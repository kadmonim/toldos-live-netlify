import { api, DEMO, DEMO_PASSWORD } from './api.js';
import { kinGraph, relations, dor } from './kinship.js';
import { t, getLang, otherLang, setLang, setFamily } from './i18n.js';
import { familyOfHost, adminOf } from '../netlify/lib/families.mjs';
import { NEWS } from './news.js';
import { loadProgress, record, isKnown, pickNext } from './progress.js';
import { feedEntries } from '../netlify/lib/calendar.mjs';
import { GAME_ART } from './game-art.js';
import { HDate, ADAR, LEAP_REF, pickerMonths, monthForYear, monthName, dayName, formatDate, fromCivil, upcoming, inYear, monthsOfYear, yearsSince } from './hebrew.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const isHebrew = (s) => /[֐-׿]/.test(s);
// The family calendar, for the Events tab (left out when not set).
const CALENDAR_URL = import.meta.env.VITE_CALENDAR_URL;
// The family this site is for, by its address (the server sends only this family's people).
const FAMILY = familyOfHost(location.hostname);
setFamily(FAMILY);

const state = {
  people: [], couples: [], edits: [], photos: [], archived: [],
  // The 3-step "who are you?" wizard; kept for the tab so a refresh doesn't start over.
  wiz: JSON.parse(sessionStorage.getItem('tree.wiz') ?? 'null') ?? { rel: null, path: [], pick: null, parents: null, self: null },
  filter: 'all',
  draft: null,   // the Add Yourself form
  photoFor: null,
  // The extended family (earlier roots): loaded the first time search or
  // a roots page is opened. null = not loaded yet.
  roots: null,
  offBranches: new Set(),   // search: the top couple's children whose branches are left out (none = the whole family, the default)
};
const storeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const storeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
state.wider = storeGet('tree.wider') === '1';
if (state.wiz.rel === 'unsure') state.wiz.rel = null;
const saveWiz = () => sessionStorage.setItem('tree.wiz', JSON.stringify(state.wiz));

// ---------- the tree ----------

const person = (id) => state.people.find((p) => p.id === id);
const coupleOf = (id) => state.couples.find((c) => c.a === id || c.b === id);
const couple = (id) => state.couples.find((c) => c.id === id);
const rootCouple = () => state.couples.find((c) => c.root);
/** The top couple, when all their children are already in (`complete` in families.mjs): nobody is added
 *  there, as a child, sibling, or parent for Add Yourself. Other families are still filling it in. */
const closed = (c) => Boolean(c?.root && FAMILY.complete);
const spouseOf = (id) => { const c = coupleOf(id); return c && person(c.a === id ? c.b : c.a); };
/** The husband or wife someone lives with: nobody for a couple who are no longer together, or
 *  when the other has passed away. */
const houseMate = (id) => { const sp = coupleOf(id)?.apart ? null : spouseOf(id); return sp && !sp.deceased ? sp : null; };
/** Someone's city as shown. Nothing for someone who passed away: no contact details are shown for them. */
const cityOf = (p) => (p && !p.deceased && p.city) || null;
/** The ♥ between two avatars, or a plain gap for a couple who are no longer together (couples.apart,
 *  set in the database). Otherwise they're shown as any couple: spouses, anniversary and all. */
/** A couple whose anniversary is still celebrated: both living and together (not after one has passed
 *  away, and not for a couple shown without the heart). */
const liveAnniversary = (c) => Boolean(c.w_day) && !c.apart && !isEngaged(c) && !person(c.a)?.deceased && !(c.b && person(c.b)?.deceased);
/** The wedding day of a couple whose wedding date is known with its year (else null). */
const weddingDay = (c) => (c?.w_day && c.w_month && c.w_year && c.w_month !== ADAR ? new HDate(c.w_day, c.w_month, c.w_year) : null);
/** The day someone was born, when the birthday is known with its year (else null). */
const birthDay = (p) => (p?.h_day && p.h_month && p.h_year && p.h_month !== ADAR ? new HDate(p.h_day, p.h_month, p.h_year) : null);
/** An engaged couple (couples.engaged), until the wedding: from the wedding day on (date and year known)
 *  they're married without anyone unticking it; with no date they stay engaged until someone does. */
const isEngaged = (c) => {
  if (!c?.engaged) return false;
  const w = weddingDay(c);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return !w || w.greg() > today;
};
// No heart either once one of them has passed away.
const oneGone = (c) => Boolean(c && (person(c.a)?.deceased || (c.b && person(c.b)?.deceased)));
const heart = (c) => (c.apart || oneGone(c) ? '<span class="heart-gap" aria-hidden="true"></span>'
  : isEngaged(c) ? '<span class="heart ring" aria-hidden="true">💍</span>' : '<span class="heart" aria-hidden="true">♥</span>');
// Oldest first by Hebrew birth date (the year runs from Tishrei); unknown dates go last. Twins, with
// the same date, go by birth_order (1 = born first) when it's set.
const birthKey = (p) => { const m = p.h_month === ADAR ? 12 : p.h_month; return m ? [p.h_year ?? 9999, m >= 7 ? m - 7 : m + 6, p.h_day] : [10000, 0, 0]; };
const byBirth = (a, b) => { const x = birthKey(a), y = birthKey(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (a.birth_order ?? 9) - (b.birth_order ?? 9); };
/** Brothers and sisters born on the same day (a known year included) as the date given. */
const twinsOf = (p, d) => (p.parents && d.h_day && d.h_year
  ? state.people.filter((x) => x.id !== p.id && x.parents === p.parents && x.h_day === d.h_day && x.h_month === d.h_month && x.h_year === d.h_year) : []);
const childrenOf = (coupleId) => state.people.filter((p) => p.parents === coupleId).sort(byBirth);
/** The couples formed by a couple's children: the next step down the tree. */
const childCouples = (coupleId) => childrenOf(coupleId).map((p) => coupleOf(p.id)).filter(Boolean);

const first = (p, l = getLang()) => (l === 'he' ? p.he_first || p.en_first : p.en_first || p.he_first) ?? '';
const last = (p, l = getLang()) => (l === 'he' ? p.he_last || p.en_last : p.en_last || p.he_last) ?? '';
const full = (p, l = getLang()) => [first(p, l), last(p, l)].filter(Boolean).join(' ');
// The name as written in one language only, for the second line under a name ('' when not filled in).
// Without a name in the shown language the main line already falls back to this one, so it isn't
// repeated underneath.
const hasNameIn = (p, l) => Boolean(l === 'he' ? p.he_first : p.en_first);
const shownIn = (l) => (l === 'he' ? 'en' : 'he');
const fullIn = (p, l) => {
  if (!hasNameIn(p, l) || !hasNameIn(p, shownIn(l))) return '';
  return [l === 'he' ? p.he_first : p.en_first, l === 'he' ? p.he_last : p.en_last].filter(Boolean).join(' ');
};
const firstIn = (p, l) => (hasNameIn(p, l) && hasNameIn(p, shownIn(l)) ? (l === 'he' ? p.he_first : p.en_first) : '');
/** Second line under a name: the name in the other language, then "♥ spouse", skipping what's empty. */
const nameLine = (name, sp) => [name && `<bdi>${esc(name)}</bdi>`, sp && `${coupleOf(sp.id)?.apart || oneGone(coupleOf(sp.id)) ? '' : isEngaged(coupleOf(sp.id)) ? '<span class="love">💍</span> ' : '<span class="love">♥</span> '}<bdi>${esc(withZl(sp, first(sp)))}</bdi>`]
  .filter(Boolean).join(' · ');
// ז"ל / z"l after the name of someone who passed away (ע"ה / a"h for a woman), but not when that was more
// than 100 years ago.
/** One of a couple shown together: ז"ל / ע"ה for the one who passed away, and שיחיה / שתחיה for the living one when
 *  the other has (so the two read right whichever comes first). */
const inCouple = (p, partner, s, l = getLang()) => (!p.deceased && partner?.deceased ? s + t(sexOf(p) === 'f' ? 'aliveF' : 'alive', l) : withZl(p, s, l));
const withZl = (p, s, l = getLang()) => (p.deceased && !(p.d_year && THIS_YEAR - p.d_year > 100) ? s + t(sexOf(p) === 'f' ? 'ah' : 'zl', l) : s);


// ---------- telling namesakes apart ----------
// Several people in the tree share a full name (cousins named after the same grandfather). Wherever
// a name stands on its own, a namesake gets a tag after it: ב"ר / בת ר' + the father's first name (or
// בן / בת + the mother's, when she is the one from this site's family), or
// for someone who married in, the spouse's name. People with a name of their own are left alone, as
// is the root couple, whom everyone knows.
// The counts are built once per render (render() clears them), so a name that was just added
// or edited is seen as a namesake straight away.
// Two people are namesakes when their full names match: the full Hebrew name (he_full) when it's
// filled in, else the name shown, plus the surname. So יענקי and יעקב יוסף are the same name
// when both are really יעקב יוסף, and two people called יעקב יוסף and יעקב are not. The tag itself
// names the father (or spouse) by the first name everyone uses, not the full name.
const nameKey = (p, l) => [p.he_full || first(p, l), last(p, l)].filter(Boolean).join(' ');
let dupCache = {};
const isNamesake = (p, l) => {
  if (!dupCache[l]) {
    const counts = new Map();
    for (const x of state.people) { const n = nameKey(x, l); counts.set(n, (counts.get(n) ?? 0) + 1); }
    dupCache[l] = counts;
  }
  return (dupCache[l].get(nameKey(p, l)) ?? 0) > 1;
};
/** The parent a namesake is named by: the one from this site's family (the other married in, so has
 *  no parents here) — where the mother is the family's daughter, her son is "בן רחל", not "ב"ר יוסף". With both or neither,
 *  the father. */
const tagParent = (p) => {
  const c = p.parents && couple(p.parents);
  if (!c) return null;
  const both = [person(c.a), person(c.b)].filter(Boolean);
  const own = both.filter((x) => x.parents);
  return own.length === 1 ? own[0] : both.find((x) => x.sex === 'm') ?? both[0] ?? null;
};
/** "ב"ר יוסף" / "son of Yosef", or with the mother's name "בן רחל". */
const childOf = (p, parent, l) => t(parent.sex === 'f' ? (p.sex === 'f' ? 'daughterOfMother' : 'sonOfMother') : (p.sex === 'f' ? 'daughterOf' : 'sonOf'), l, first(parent, l));
/** A person's given name for telling people apart: the full Hebrew name when there is one (so Yanky
 *  and Yaakov Yosef are both יעקב יוסף), else the first name. */
const givenKey = (x) => (isHebrew(x.he_full ?? '') ? x.he_full : x.he_first || x.en_first || '').trim();
const sameSurname = (x, y) => Boolean((x.he_last && x.he_last === y.he_last) || (x.en_last && x.en_last === y.en_last));
/** Whether someone else in the same family name has this person's given name (then "son of Yaakov"
 *  alone doesn't say which Yaakov, and the grandparent is added). */
const commonFirst = (x) => state.people.some((y) => y.id !== x.id && sameSurname(x, y) && givenKey(y) === givenKey(x));
const nameTag = (p, l = getLang()) => {
  if (!isNamesake(p, l)) return '';
  const parent = tagParent(p);
  if (parent) {
    // A parent whose first name others share gets their own parent too: "(son of Yaakov son of Reuven)".
    const gp = commonFirst(parent) && tagParent(parent);
    return `(${childOf(p, parent, l)}${gp ? ` ${childOf(parent, gp, l)}` : ''})`;
  }
  if (coupleOf(p.id)?.root) return '';
  const sp = spouseOf(p.id);
  return sp ? t(p.sex === 'f' ? 'wifeOf' : 'husbandOf', l, first(sp, l)) : '';
};
/** Whose someone is, in the words the namesake tag uses, for under a name in a list, whether or not anyone shares
 *  their name: the parent, and that parent's parent ("son of Yaakov son of Meir", ב"ר יעקב ב"ר מאיר); for someone
 *  who married in, their husband or wife and whose child that one is ("Rochie's husband, daughter of Meir"). ''
 *  for the top couple, whom everyone knows. */
const whose = (p, l = getLang()) => {
  const up = (x) => { const parent = tagParent(x); if (!parent) return ''; const gp = tagParent(parent); return `${childOf(x, parent, l)}${gp ? ` ${childOf(parent, gp, l)}` : ''}`; };
  if (p.parents) return up(p);
  if (coupleOf(p.id)?.root) return '';
  const sp = spouseOf(p.id);
  if (!sp) return '';
  const of = t(p.sex === 'f' ? 'wifeOf' : 'husbandOf', l, first(sp, l)).replace(/^\(|\)$/g, '');
  const parent = tagParent(sp);
  return parent ? `${of}, ${childOf(sp, parent, l)}` : of;
};
/** The full name, with a tag after it when someone else in the tree has the same one. */
const named = (p, l = getLang()) => [full(p, l), nameTag(p, l)].filter(Boolean).join(' ');
/** הכהן / הלוי, for a tree person: shown on their own page, between the first name and the family name. */
const tribeOf = (p, l = getLang()) => (p?.tribe ? t(p.tribe === 'levi' ? 'tribeLevi' : 'tribeKohen', l) : '');
const namedTribe = (p, l = getLang()) => (p?.tribe ? [first(p, l), tribeOf(p, l), last(p, l), nameTag(p, l)].filter(Boolean).join(' ') : named(p, l));
/** The first name, tagged the same way, for lines that mention a person by first name only. */
const firstNamed = (p, l = getLang()) => [first(p, l), nameTag(p, l)].filter(Boolean).join(' ');
const coupleName = (c, l = getLang()) => { const a = person(c.a), b = person(c.b); return [a && inCouple(a, b, first(a, l), l), b && inCouple(b, a, first(b, l), l)].filter(Boolean).join(' & '); };

// ---------- what's missing ----------

const HAS = {
  birthday: (p) => Boolean(p.h_day), photo: (p) => Boolean(p.photo), city: (p) => Boolean(p.city),
  phone: (p) => Boolean(p.phone), email: (p) => Boolean(p.email), contact: (p) => Boolean(p.phone || p.email),
  anniversary: (p) => Boolean(coupleOf(p.id)?.w_day), family_photo: (p) => Boolean(coupleOf(p.id)?.photo),
};
/** Fields on someone's profile page; contact details don't apply to those who passed away. */
// The hobby is optional for everyone: it never counts as missing.
const profileFields = (p) => (p.deceased ? ['birthday', 'yahrzeit', 'photo', 'hobby', 'occupation'] : ['birthday', 'photo', 'city', 'address', 'phone', 'email', 'hobby', 'occupation']);
// Phone/email/city are asked of adults only: married or 18+. Without a birth year, Yaakov's
// children and grandchildren count as adults and later generations as children.
const THIS_YEAR = new HDate().getFullYear();
function generation(p) {
  let n = 0;
  for (let cur = p; cur?.parents && n < 12; n++) {
    const c = couple(cur.parents);
    if (c?.root) return n + 1;
    cur = person(c?.a)?.parents ? person(c.a) : person(c?.b);
  }
  return n;
}
const isAdult = (p) => Boolean(coupleOf(p.id)) || (p.h_year ? THIS_YEAR - p.h_year >= 18 : generation(p) <= 2);
/** Fields that count towards someone's completeness. */
const wanted = (p) => (p.deceased || !isAdult(p) ? ['birthday', 'photo'] : ['birthday', 'photo', 'city', 'phone', 'email']);
/** What "Complete the Family" asks for. */
const needs = (p) => ['photo', 'birthday', ...(!p.deceased && isAdult(p) ? ['contact'] : [])].filter((k) => !HAS[k](p));
/** Everything a household is responsible for: the person, their spouse (the address is shared),
 *  and their children who haven't married yet (married children are a household of their own). */
function household(p) {
  const sp = spouseOf(p.id);
  const c = coupleOf(p.id);
  const kids = c ? childrenOf(c.id).filter((k) => !coupleOf(k.id)) : [];
  return [
    ...wanted(p).map((k) => [p, k]),
    ...(sp ? wanted(sp).filter((k) => k !== 'city').map((k) => [sp, k]).concat([[p, 'anniversary'], [p, 'family_photo']]) : []),
    ...kids.flatMap((k) => ['birthday', 'photo', ...(!k.deceased && isAdult(k) ? ['contact'] : [])].map((f) => [k, f])),
  ];
}

function editCounts() {
  const by = new Map();
  for (const e of state.edits) {
    const row = by.get(e.by) ?? { total: 0 };
    row.total += e.n;
    row[e.field] = (row[e.field] ?? 0) + e.n;
    by.set(e.by, row);
  }
  return by;
}

// ---------- pieces ----------

/** A phone number in WhatsApp's international form (digits only), or null when it can't be one:
 *  Israeli mobiles (05x) get 972, US numbers 1, the Russian 8… form 7; numbers already written with
 *  + or 00 are taken as they are. Israeli landlines (02, 03, 04, 08, 09, 07x) have no WhatsApp. */
function waNumber(phone) {
  let s = String(phone ?? '').replace(/[^\d+]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  else if (/^05\d{8}$/.test(s)) s = '972' + s.slice(1);
  else if (/^0\d{8,9}$/.test(s)) return null;
  else if (/^1\d{10}$/.test(s)) { /* US with the 1 */ }
  else if (/^\d{10}$/.test(s)) s = '1' + s;
  else if (/^8\d{10}$/.test(s)) s = '7' + s.slice(1);
  else return null;
  if (s.startsWith('972') && !/^9725\d{8}$/.test(s)) return null;   // +972 landline
  return /^\d{8,15}$/.test(s) ? s : null;
}

const ICON = {
  whatsapp: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M12 3.2a8.7 8.7 0 0 0-7.5 13.1L3.3 20.8l4.6-1.2A8.7 8.7 0 1 0 12 3.2Zm0 15.9c-1.3 0-2.6-.4-3.7-1l-.3-.2-2.7.7.7-2.6-.2-.3a7.2 7.2 0 1 1 6.2 3.4Zm4-5.4c-.2-.1-1.3-.6-1.5-.7-.2-.1-.3-.1-.5.1l-.7.8c-.1.2-.3.2-.5.1a5.9 5.9 0 0 1-2.9-2.5c-.2-.4.2-.4.6-1.2.1-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.4a.8.8 0 0 0-.6.3 2.4 2.4 0 0 0-.8 1.8 4.2 4.2 0 0 0 .9 2.2 9.5 9.5 0 0 0 3.6 3.2c1.4.6 1.9.6 2.6.5.4-.1 1.3-.5 1.5-1.1.2-.5.2-1 .1-1.1l-.4-.2Z"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  camera: '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 5C2 4.45 2.45 4 3 4H3.5L4.5 2.5H9.5L10.5 4H11C11.55 4 12 4.45 12 5V10C12 10.55 11.55 11 11 11H3C2.45 11 2 10.55 2 10V5Z" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="7" r="1.8" stroke="currentColor" stroke-width="1.4"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  done: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#D4F0D4"/><path d="M4.5 8L6.5 10L11.5 5.5" stroke="#3A7030" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  user: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  home: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M3 10L11 3L19 10V18.5C19 19.05 18.55 19.5 18 19.5H13.5V14H8.5V19.5H4C3.45 19.5 3 19.05 3 18.5V10Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  search: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="9.5" cy="9.5" r="6" stroke="currentColor" stroke-width="2"/><path d="M14 14L18.5 18.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  down: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  tree: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="11" cy="3.5" r="2.5" stroke="currentColor" stroke-width="2"/><circle cx="4" cy="15" r="2.5" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="15" r="2.5" stroke="currentColor" stroke-width="2"/><path d="M11 6V11M11 11L4 12.5M11 11L18 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  events: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><rect x="2" y="4" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="2"/><path d="M7 2V6M15 2V6M2 9H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="7.5" cy="14" r="1.3" fill="currentColor"/><circle cx="11" cy="14" r="1.3" fill="currentColor"/><circle cx="14.5" cy="14" r="1.3" fill="currentColor"/></svg>',
  // A game controller, for the tab when it opens a list of games.
  games: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M6.6 6.5h8.8a4.3 4.3 0 0 1 4.2 5.2l-.8 3.7a2.2 2.2 0 0 1-3.9.9L13.4 14.5H8.6l-1.5 1.8a2.2 2.2 0 0 1-3.9-.9l-.8-3.7a4.3 4.3 0 0 1 4.2-5.2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 9v3.4M5.3 10.7h3.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="14.6" cy="9.8" r="1.2" fill="currentColor"/><circle cx="16.4" cy="12.3" r="1.2" fill="currentColor"/></svg>',
  quiz: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="8.5" stroke="currentColor" stroke-width="2"/><path d="M8.3 8.6C8.5 7.2 9.6 6.3 11 6.3C12.5 6.3 13.6 7.3 13.6 8.6C13.6 10.3 11 10.5 11 12.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="11" cy="15.4" r="1.2" fill="currentColor"/></svg>',
  trophy: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M7 3H15V12C15 14.21 13.21 16 11 16C8.79 16 7 14.21 7 12V3Z" stroke="currentColor" stroke-width="2"/><path d="M7 6H4C4 8.76 5.79 11.08 8.27 11.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 6H18C18 8.76 16.21 11.08 13.73 11.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M11 16V19M8 19H14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  people: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="8" cy="7.5" r="3.3" stroke="currentColor" stroke-width="2"/><path d="M2 18.5C2 15.5 4.7 13.2 8 13.2C11.3 13.2 14 15.5 14 18.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="15.6" cy="6.6" r="2.6" stroke="currentColor" stroke-width="2"/><path d="M16.4 12.2C18.6 12.6 20 14.3 20 16.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  profile: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="11" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M3 19C3 15.686 6.686 13 11 13C15.314 13 19 15.686 19 19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

// Soft background + ink pairs from the design, picked by id so a person keeps their colour.
const TONES = [['#EEE8FF', '#7C5CBF'], ['#FFF0F3', '#E0436A'], ['#E8F4FF', '#2A6FA8'], ['#FFF5E0', '#A87418'], ['#E8F4E8', '#3A7030'], ['#FFE4F4', '#9A4E9D']];
const tone = (id) => TONES[[...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];

/** A round avatar: photo or Hebrew initial, with the camera badge for uploading a photo. */
function avatar(p, size = 'md', { camera = true } = {}) {
  const [bg, fg] = tone(p.id);
  const inner = p.photo ? `<img src="${esc(p.photo)}" alt="" />` : esc((p.he_first || p.en_first || '?')[0]);
  const cam = camera
    ? `<button type="button" class="cam" data-act="photo" data-pid="${p.id}" aria-label="${esc(`${t(p.photo ? 'changePhoto' : 'addPhoto')}: ${first(p)}`)}">${ICON.camera}</button>`
    : '';
  // Where an avatar has the camera badge it isn't inside a link, so a photo can open large on tap.
  const face = camera && p.photo
    ? `<button type="button" class="av-face he zoomable" data-act="zoom" data-pid="${p.id}" aria-label="${esc(`${t('viewPhoto')}: ${first(p)}`)}">${inner}</button>`
    : `<span class="av-face he">${inner}</span>`;
  return `<span class="av av-${size}" style="--av-bg:${bg};--av-fg:${fg}">${face}${cam}</span>`;
}

const isRtl = () => getLang() === 'he';

/** A person's extra pictures, oldest first. */
const galleryOf = (pid) => state.photos.filter((g) => g.person === pid && g.kind !== 'matzeiva');
/** The headstone (מצבה) photo of someone who passed away, if any (the latest). */
const matzeivaOf = (pid) => state.photos.filter((g) => g.person === pid && g.kind === 'matzeiva').at(-1);

/**
 * All of a person's pictures, large: the profile photo first, then the gallery; prev/next (or the
 * arrow keys, or a swipe) flips through them. `start` is the index to open on.
 */
function zoomPhoto(pid, start = 0) {
  const p = person(pid);
  const name = withZl(p, full(p));
  const items = [
    ...(p.photo ? [{ src: p.photo, caption: name, onChange: () => pickPhoto(pid), download: api.originalUrl('person', pid, p.photo),
      onDelete: async () => {   // the profile picture comes off (kept aside on the server, like every removal)
        if (!confirm(t('deleteProfilePhotoConfirm'))) return false;
        try { await api.removeProfilePhoto(pid); await refresh(); return true; } catch (err) { alert(t('saveErr') + err.message); return false; }
      } }] : []),
    ...galleryOf(pid).map((g) => ({
      src: g.url, caption: name, wide: true, download: api.originalUrl('gallery', g.id, g.url),
      onDelete: async () => {
        if (!confirm(t('deletePhotoConfirm'))) return false;
        try { await api.deleteGalleryPhoto(g.id); await refresh(); return true; } catch (err) { alert(t('saveErr') + err.message); return false; }
      },
    })),
  ];
  showLarge(items, start);
}

/**
 * One or more pictures in the dark dialog. Each item: { src, caption, wide, download, onChange,
 * onDelete }; with several, prev/next buttons, the arrow keys and a swipe move between them.
 */
function showLarge(items, start = 0) {
  if (!Array.isArray(items)) items = [items];
  const dlg = $('#zoom');
  let i = Math.max(0, Math.min(start, items.length - 1));
  const many = items.length > 1;
  const show = () => {
    const it = items[i];
    dlg.innerHTML = `<figure class="zoom-fig ${it.wide ? 'wide' : ''}">
      <div class="zoom-stage">
        <img src="${esc(it.src)}" alt="${esc(it.caption)}" />
        ${many ? `<button type="button" class="zoom-nav prev" data-zoom="prev" aria-label="${esc(t('prevPhoto'))}">${ICON.back}</button>
        <button type="button" class="zoom-nav next" data-zoom="next" aria-label="${esc(t('nextPhoto'))}">${ICON.back}</button>
        <span class="zoom-count" dir="ltr">${i + 1} / ${items.length}</span>` : ''}
      </div>
      <figcaption><span class="he">${esc(it.caption)}</span>
        ${it.download ? `<a class="pill" href="${esc(it.download)}" download aria-label="${esc(t('downloadFull'))}">⬇<span>${t('download')}</span></a>` : ''}
        ${it.onChange ? `<button type="button" class="pill" data-zoom="change">${ICON.camera}<span>${t('changePhoto')}</span></button>` : ''}
        ${it.onDelete ? `<button type="button" class="pill" data-zoom="delete">🗑<span>${t('deletePhoto')}</span></button>` : ''}
        <button type="button" class="pill" data-zoom="close">${t('close')}</button></figcaption>
    </figure>`;
    dlg.querySelector('[data-zoom="close"]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-zoom="change"]')?.addEventListener('click', () => { dlg.close(); it.onChange(); });
    dlg.querySelector('[data-zoom="delete"]')?.addEventListener('click', async () => {
      if (!await it.onDelete()) return;
      items.splice(i, 1);
      if (!items.length) return dlg.close();
      i = Math.min(i, items.length - 1);
      show();
    });
    dlg.querySelector('[data-zoom="prev"]')?.addEventListener('click', () => step(-1));
    dlg.querySelector('[data-zoom="next"]')?.addEventListener('click', () => step(1));
  };
  const step = (d) => { i = (i + d + items.length) % items.length; show(); };
  // A tap outside the photo closes it; arrows and swipes move along (the visual direction, so in
  // Hebrew the arrow pointing left still goes "forward").
  dlg.onclick = (ev) => { if (ev.target === dlg) dlg.close(); };
  // On the document: redrawing the figure drops focus from the button that was pressed.
  const keys = (ev) => {
    if (ev.key === 'ArrowRight') { ev.preventDefault(); step(isRtl() ? -1 : 1); }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); step(isRtl() ? 1 : -1); }
  };
  if (many) {
    document.addEventListener('keydown', keys);
    dlg.addEventListener('close', () => document.removeEventListener('keydown', keys), { once: true });
  }
  let touch = null;
  dlg.ontouchstart = (ev) => { touch = ev.touches[0].clientX; };
  dlg.ontouchend = (ev) => {
    if (!many || touch === null) return;
    const dx = ev.changedTouches[0].clientX - touch;
    touch = null;
    if (Math.abs(dx) > 40) step((dx < 0) !== isRtl() ? 1 : -1);
  };
  show();
  dlg.showModal();
}

/** `for`: a person's id (face crop), 'draft' (Add Yourself), or 'family:<couple id>' (whole photo). */
function pickPhoto(target) {
  state.photoFor = target;
  $('#photoInput').click();
}

/** תמונה משפחתית · משפחת רוזנפלד (יצחק & רבקה) */
function familyCaption(c) {
  const surname = last(person(c.a)) || last(person(c.b) ?? {});
  return `${t('familyPhoto')} · ${surname ? `${t('familyOf', getLang(), surname)} (${coupleName(c)})` : coupleName(c)}`;
}

/** A couple's family photo, or a place to add one. */
function familyPhoto(c) {
  const caption = familyCaption(c);
  return c.photo
    ? `<div class="card family-photo">
        <button type="button" class="fam-img" data-act="zoom-family" data-cid="${c.id}" aria-label="${esc(caption)}"><img src="${esc(c.photo)}" alt="" /></button>
        <div class="fam-bar"><span>${esc(caption)}</span><button type="button" class="link" data-act="family-photo" data-cid="${c.id}">${t('changePhoto')}</button></div>
      </div>`
    : `<button type="button" class="card family-empty" data-act="family-photo" data-cid="${c.id}">
        <span class="fam-icon" aria-hidden="true">${ICON.camera}</span>
        <span class="person-text"><span class="title">${t('addFamilyPhoto')}</span><span class="sub">${t('familyHint')}</span></span>
        <span class="chip amber solid">${t('add')}</span>
      </button>`;
}

function pair(c, size = 'sm') {
  const a = person(c.a), b = person(c.b);
  return `<span class="pair">${avatar(a, size, { camera: false })}${b ? `${heart(c)}${avatar(b, size, { camera: false })}` : ''}</span>`;
}

const langToggle = () => `<div class="langseg" role="group" aria-label="Language">
  <button type="button" data-act="lang" data-lang="en" class="${getLang() === 'en' ? 'on' : ''}" aria-pressed="${getLang() === 'en'}">EN</button>
  <button type="button" data-act="lang" data-lang="he" class="${getLang() === 'he' ? 'on' : ''}" aria-pressed="${getLang() === 'he'}">עב</button>
</div>`;

const backBtn = (act = 'back') => `<button type="button" class="back" data-act="${act}"><span class="iconbtn">${ICON.back}</span><span>${t('back')}</span></button>`;
const brand = () => `<div class="brand"><span aria-hidden="true">🌳</span><span>${t('appName')}</span></div>`;
/** Male / female radio pair (sex is what the quiz uses to offer names of the same sex). */
const sexPick = (value, attrs = '') => `<div class="seg" role="radiogroup" aria-label="${t('sex')}">
  ${[['m', 'male'], ['f', 'female']].map(([v, k]) => `<label><input type="radio" name="sex" value="${v}" ${value === v ? 'checked' : ''} ${attrs} /><span>${t(k)}</span></label>`).join('')}
</div>`;
const otherSex = (p) => (p?.sex === 'm' ? 'f' : p?.sex === 'f' ? 'm' : null);

// Nobody is "you" as someone who has passed away (an old pick like that is dropped at startup).
const hasMe = () => Boolean(api.me && person(api.me) && !person(api.me).deceased);

/** `exit`: the wizard and Add Yourself offer a way back to the profile for people who already have one. */
function hero({ left, center = '', progress, label, labelSub, body = '', cls = '', exit = false, gear = null }) {
  const out = exit && hasMe() ? `<a class="pill-exit" href="#/me">${ICON.close}<span>${t('exit')}</span></a>` : '';
  // A page's settings: always the gear here, beside the language switch (gear = its data-act, or { act, id }).
  const g = gear && (typeof gear === 'string' ? { act: gear } : gear);
  const gearB = g ? `<button type="button" class="hero-gear" data-act="${g.act}"${g.id ? ` data-id="${esc(g.id)}"` : ''} aria-label="${esc(t('settings'))}" title="${esc(t('settings'))}"><span class="iconbtn">⚙️</span></button>` : '';
  return `<header class="hero ${cls}">
    <div class="deco d1"></div><div class="deco d2"></div><div class="deco d3"></div>
    <div class="topbar">${left}${center}<div class="top-end">${out}${gearB}${langToggle()}</div></div>
    ${progress != null ? `<div class="progress">
      <div class="progress-labels"><span>${label}</span><span class="dim">${labelSub ?? ''}</span></div>
      <div class="bar"><div style="width:${progress}%"></div></div>
    </div>` : ''}
    ${body}
  </header>`;
}

const heading = (key, ...args) => `<h1 class="q">${esc(t(key, getLang(), ...args))}</h1><p class="q-sub">${esc(t(key, otherLang(), ...args))}</p>`;
const tagOn = (key) => `<span class="tag-on">${t(key)}</span>`;
const radio = (on) => `<span class="radio ${on ? 'on' : ''}" aria-hidden="true">${on ? ICON.check : ''}</span>`;
// The birthday in a list, with the age now and, for a child in school, the grade: "🎂 כ״ג תשרי תשע״ג · בן 13 · כיתה ח׳".
const birthdayLine = (p) => {
  const d = formatDate(p, getLang());
  if (!d) return `<span class="bday missing">🎂 ${t('missing')}</span>`;
  const age = p.deceased ? null : yearsSince(p.h_day, p.h_month, p.h_year);
  const g = gradeOf(p);
  const extra = [age != null && t(p.sex === 'f' ? 'ageIsF' : 'ageIsM', getLang(), age), g != null && gradeName(g)].filter(Boolean);
  return `<span class="bday">🎂 ${esc([d, ...extra].join(' · '))}</span>`;
};

function nav(active) {
  const item = (key, href, icon, label = `nav_${key}`) => `<a class="${active === key ? 'on' : ''}" href="${href}" ${active === key ? 'aria-current="page"' : ''}>${icon}<span>${t(label)}</span></a>`;
  return `<nav class="nav ${active === 'complete' ? 'coral' : ''}">
    ${item('home', '#/home', ICON.home)}
    ${item('search', '#/search', ICON.search)}
    ${hasChart() ? item('tree', '#/chart', ICON.tree) + item('relatives', '#/tree', ICON.people) : item('tree', '#/tree', ICON.tree)}
    ${CALENDAR_URL ? `<a href="${esc(CALENDAR_URL)}">${ICON.events}<span>${t('nav_events')}</span></a>` : ''}
    ${item('complete', '#/family', ICON.trophy)}
    ${quizGames().length > 1 ? item('quiz', '#/quiz', ICON.games, 'nav_games') : item('quiz', '#/quiz', ICON.quiz)}
    ${item('profile', api.me ? '#/me' : '#/start', ICON.profile)}
  </nav>`;
}

const localNote = () => (api.mode !== 'local' ? '' : DEMO
  ? `<p class="mode-note">${t('demoNote')} <button type="button" class="escape quiet" data-act="demo-reset">${t('demoReset')}</button></p>`
  : `<p class="mode-note">${t('localNote')}</p>`);

// ---------- wizard step 1: who are the top couple to you? ----------

// Everyone in the app is one of the top couple's children, a child of one, or a grandchild of
// one, so there is no "not sure": someone who doesn't know doesn't belong here.
const REL = [['great', 'rel_great', '👴', 'lilac'], ['grand', 'rel_grand', '🧓', 'mix'], ['parents', 'rel_parents', '👨‍👩‍👦', 'pink']];

function step1() {
  const root = rootCouple();
  if (!root) return emptyTree();
  const a = person(root.a), b = person(root.b);
  const bigAv = (p, cls) => `<span class="hero-av ${cls} he">${p.photo ? `<img src="${esc(p.photo)}" alt="" />` : esc((p.he_first || p.en_first)[0])}</span>`;
  // סבא אברהם ז"ל & סבתא שרה / Zaidy Avraham & Bubby Sarah
  const names = (l) => [[a, 'zaidy', b], [b, 'bubby', a]].filter(([p]) => p).map(([p, k, o]) => inCouple(p, o, `${t(k, l)} ${first(p, l)}`, l)).join(' & ');
  const w = state.wiz;
  return hero({
    left: brand(), exit: true, progress: 33, label: t('stepOf', getLang(), 1), labelSub: t('stepOf', otherLang(), 1),
    body: `<div class="hero-couple">${bigAv(a, 'a')}${b ? `<span class="hero-heart" aria-hidden="true">💞</span>${bigAv(b, 'b')}` : ''}</div>
      <div class="hero-names"><div class="he-name">${esc(names(getLang()))}</div><div class="dim">${esc(names(otherLang()))}</div></div>`,
  }) + `<main class="content">
    ${heading('q1', first(a), b ? first(b) : '')}
    <div class="choices">
      ${REL.map(([v, key, emoji, tint]) => `<button type="button" class="choice ${w.rel === v ? 'on' : ''}" data-act="rel" data-v="${v}" aria-pressed="${w.rel === v}">
        ${w.rel === v ? tagOn('chosen') : ''}
        <span class="tile ${tint}" aria-hidden="true">${emoji}</span>
        <span class="choice-text"><span class="title he">${t(key)}</span><span class="sub">${t(key, otherLang())}</span></span>
        ${radio(w.rel === v)}
      </button>`).join('')}
    </div>
    <p class="note">💍 ${t('spouseNote')}</p>
    <div class="wiz-foot">
      <button type="button" class="cta" data-act="step1-next" ${w.rel ? '' : 'disabled'}>${t('next')}</button>
    </div>
  </main>`;
}

// ---------- wizard step 2: drill down to your grandparents / parents ----------

const DEPTH = { parents: 0, grand: 1, great: 2 };

function step2() {
  const w = state.wiz;
  const from = w.path.at(-1) ?? rootCouple()?.id;
  const remaining = DEPTH[w.rel] - w.path.length;
  const key = remaining >= 2 ? 'q2_grand' : 'q2_parents';
  // No "my couple isn't listed" here: the five sons are all in the tree, and a missing child of a
  // son is added from the son's page, not from this step.
  const options = childCouples(from);
  const picked = w.pick && couple(w.pick);
  const coupleCity = (c) => cityOf(person(c.a)) || cityOf(person(c.b));
  const cta = `<button type="button" class="cta" data-act="step2-next" ${picked ? '' : 'disabled'}>${t('next')}</button>`;
  return hero({
    left: backBtn(), exit: true, progress: 66, label: t('stepOf', getLang(), 2), labelSub: t('stepOf', otherLang(), 2),
    body: `<div class="hero-q">${heading(key)}</div>`,
  }) + `<main class="content">
    ${w.path.length ? `<p class="crumb">${w.path.map((id) => esc(coupleName(couple(id)))).join(' › ')}</p>` : ''}
    <div class="choices">
      ${options.length ? options.map((c) => {
        const on = w.pick === c.id;
        const city = coupleCity(c);
        return `<button type="button" class="choice ${on ? 'on' : ''}" data-act="pick" data-id="${c.id}" aria-pressed="${on}">
          ${on ? tagOn('chosen') : ''}
          ${pair(c)}
          <span class="choice-text"><span class="title he">${esc(coupleName(c))}</span><span class="sub">${esc(coupleName(c, otherLang()))}${city ? ` · ${esc(city)}` : ''}</span></span>
          ${radio(on)}
        </button>`;
      }).join('') : `<p class="empty">${t('noCouples')}</p>`}
    </div>
    <div class="wiz-foot">
      ${cta}
    </div>
  </main>`;
}

// ---------- wizard step 3: pick yourself ----------

function step3() {
  const w = state.wiz;
  // Only the living can be "you": someone who passed away is listed only for their living husband
  // or wife to find themselves beside them.
  const kids = childrenOf(w.parents).filter((p) => !p.deceased || (spouseOf(p.id) && !spouseOf(p.id).deceased));
  // The five sons are all in the tree; only from the next generation down can someone be missing.
  return hero({
    left: backBtn(), exit: true, progress: 90, label: `${t('stepOf', getLang(), 3)} — ${t('almost')}`, labelSub: t('almost', otherLang()),
    body: `<div class="hero-q"><h1 class="q">${t('q3')}</h1><p class="q-sub">${t('q3sub')}</p></div>`,
  }) + `<main class="content">
    <div class="choices">
      ${kids.length ? kids.map((p) => {
        const sp = spouseOf(p.id);
        const on = w.self === p.id || (sp && w.self === sp.id);
        // Someone who married into the family finds their husband or wife here, then picks themselves.
        const who = on && sp && !p.deceased && !sp.deceased ? `<div class="who" role="group" aria-label="${esc(t('iAm'))}"><span>${t('iAm')}</span>
          ${[p, sp].map((x) => `<button type="button" class="${w.self === x.id ? 'on' : ''}" aria-pressed="${w.self === x.id}" data-act="self" data-id="${x.id}">${avatar(x, 'xs', { camera: false })}<span class="he">${esc(first(x))}</span></button>`).join('')}
        </div>` : '';
        return `<button type="button" class="choice person ${on ? 'on' : ''}" data-act="self" data-id="${p.id}" aria-pressed="${on}">
          ${on ? tagOn('thatsMe') : ''}
          ${avatar(p, 'md', { camera: false })}
          <span class="choice-text">
            <span class="title he">${esc(withZl(p, first(p)))}</span>
            <span class="sub">${nameLine(fullIn(p, otherLang()), sp)}</span>
            ${birthdayLine(p)}
          </span>
          ${radio(on)}
        </button>${who}`;
      }).join('') : `<p class="empty">${t('noChildren')}</p>`}
    </div>
    <div class="wiz-foot">
      <button type="button" class="cta" data-act="step3-yes" ${w.self ? '' : 'disabled'}>${t('yesMe')}</button>
      ${closed(couple(w.parents)) ? '' : `<a class="escape" href="#/add">${t('notSee')}</a>`}
    </div>
  </main>`;
}

// ---------- a person's page (your profile, or anyone's) ----------

const FIELD = {
  birthday: { emoji: '🎂', tint: 'cream', add: 'addBirthday', value: (p) => formatDate(p, getLang()) },
  // Only on the page of someone marked ז"ל (profileFields); there's no switch for that in the app.
  yahrzeit: { emoji: '🕯️', tint: 'lilac', add: 'addYahrzeit', value: (p) => (p.d_day ? formatDate({ h_day: p.d_day, h_month: p.d_month, h_year: p.d_year }, getLang()) : null) },
  photo: { emoji: '📸', tint: 'pink', add: 'addPhoto', value: (p) => (p.photo ? t('hasPhoto') : null) },
  city: { emoji: '📍', tint: 'lilac', add: 'addCity', value: (p) => p.city },
  // The full mailing address (for invitations); a couple shares one, so a spouse's shows when theirs
  // is empty. Not a couple who are no longer together (couples.apart): each has their own.
  address: { emoji: '🏠', tint: 'lilac', add: 'addAddress', value: (p) => p.address || houseMate(p.id)?.address },
  phone: { emoji: '📞', tint: 'lilac', add: 'addPhone', value: (p) => p.phone },
  email: { emoji: '✉️', tint: 'lilac', add: 'addEmail', value: (p) => p.email },
  hobby: { emoji: '🎨', tint: 'pink', add: 'addHobby', value: (p) => p.hobby },
  occupation: { emoji: '🎓', tint: 'lilac', add: 'addOccupation', value: (p) => p.occupation },
};

/** Under 18 (by birth year when known, else the app's usual guess): "School" instead of "School / Position". */
const isMinor = (p) => (p.h_year ? THIS_YEAR - p.h_year < 18 : !isAdult(p));
/** 25 or older, by birth year (nobody's in school by then): "Job" instead of "School / Position". */
const isPast25 = (p) => Boolean(p.h_year) && THIS_YEAR - p.h_year >= 25;
/** The school/position field's label and empty text for this person's age. */
const occupationKeys = (p) => (isMinor(p) ? ['school', 'addSchool'] : isPast25(p) ? ['job', 'addJob'] : ['occupation', 'addOccupation']);
/** A field's label for this person. */
const fieldLabel = (p, key) => t(key === 'occupation' ? occupationKeys(p)[0] : key);

/** A child's school grade now: from the birthday (the year they turn 6 by December 31 is 1st grade; a new
 *  school year from September), moved by their one-time fix (grade_offset). Shown up to 8th grade for a
 *  boy, 12th for a girl; null outside that, or without a birth year. `raw` skips the range (for the fix). */
function gradeOf(p, raw = false) {
  if (!p || p.deceased || !p.h_day || !p.h_month || !p.h_year) return null;
  const born = new HDate(Math.min(p.h_day, HDate.daysInMonth(p.h_month, p.h_year)), p.h_month, p.h_year).greg().getFullYear();
  const now = new Date();
  const schoolYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;   // starts in September
  const g = schoolYear - born - 5 + (p.grade_offset ?? 0);
  return raw || (g >= 1 && g <= gradeMax(p)) ? g : null;
}
const gradeMax = (p) => (p.sex === 'f' ? 12 : 8);
const gradeName = (g) => (getLang() === 'he' ? `כיתה ${dayName(g, 'he')}` : t('gradeN', 'en', g));
function gradeRow(p) {
  const g = gradeOf(p);
  if (g == null) return '';
  return `<button type="button" class="info-row" data-act="grade-edit" data-pid="${p.id}">
    <span class="tile sm cream" aria-hidden="true">🏫</span>
    <span class="info-text"><span class="label">${t('gradeLabel')}</span><span class="value">${esc(getLang() === 'he' ? dayName(g, 'he') : gradeName(g))}</span></span>
    <span class="link">${t('edit')}</span>
  </button>`;
}
/** Fix a child's grade once: pick the grade they're really in; the difference is kept and counted on from there. */
function openGradeSheet(pid) {
  const p = person(pid);
  const base = gradeOf({ ...p, grade_offset: 0 }, true);
  const now = base + (p.grade_offset ?? 0);
  const opts = [];
  for (let g = Math.max(1, base - 3); g <= Math.min(gradeMax(p), base + 3); g++) opts.push(g);
  const dlg = $('#sheet');
  dlg.innerHTML = `<form method="dialog" class="sheet-form">
    <h2>${t('gradeLabel')} · <bdi>${esc(first(p))}</bdi></h2>
    <p class="dim">${t('gradeHint', getLang(), gradeName(base))}</p>
    <label class="field"><select name="grade">${opts.map((g) => `<option value="${g}" ${g === now ? 'selected' : ''}>${esc(gradeName(g))}${g === base ? ` (${t('gradeAuto')})` : ''}</option>`).join('')}</select></label>
    <p class="err" hidden></p>
    <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button><button class="cta small">${t('save')}</button></div>
  </form>`;
  const f = dlg.querySelector('form');
  dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api.savePerson({ ...p, grade_offset: Number(f.grade.value) - base || null });
      await refresh(); dlg.close(); render();
    } catch (err) { const e = f.querySelector('.err'); e.textContent = err.message; e.hidden = false; }
  });
  dlg.showModal();
}

function infoRow(p, key) {
  const f = FIELD[key];
  const v = f.value(p);
  const act = key === 'photo' ? `data-act="photo" data-pid="${p.id}"` : `data-act="edit" data-field="${key}" data-pid="${p.id}"`;
  // Not asked of children, so not flagged as missing either.
  const optional = !v && !wanted(p).includes(key);
  const end = optional ? `<span class="link">${t('add')}</span>`
    : !v ? `<span class="chip amber solid">${t('add')}</span>`
    : key === 'birthday' ? `<span class="link">${t('edit')}</span>` : ICON.done;
  // A phone that WhatsApp can reach gets a small button beside it (outside the row's own button).
  const wa = key === 'phone' && v && waNumber(v);
  const row = `<button type="button" class="info-row ${v || optional ? '' : 'missing'}${wa ? ' has-wa' : ''}" ${act}>
    <span class="tile sm ${v || optional ? f.tint : 'amber'}" aria-hidden="true">${f.emoji}</span>
    <span class="info-text"><span class="label">${fieldLabel(p, key)}</span>
      <span class="value ${v ? '' : optional ? 'add quiet' : 'add'} ${key === 'birthday' ? 'he' : ''}" ${['phone', 'email'].includes(key) ? 'dir="ltr"' : ''}>${esc(v ?? t(key === 'occupation' ? occupationKeys(p)[1] : f.add))}</span></span>
    ${wa ? '' : end}
  </button>`;
  return wa ? `<div class="wa-wrap">${row}<a class="wa" href="https://wa.me/${wa}" target="_blank" rel="noopener" aria-label="${esc(t('whatsapp'))}" title="${esc(t('whatsapp'))}">${ICON.whatsapp}</a></div>` : row;
}

/** The last row of the details card: more pictures of this person, and a place to add one. */
function galleryRow(p) {
  const pics = galleryOf(p.id);
  // Where the profile photo is first in the viewer, the gallery starts at 1.
  const offset = p.photo ? 1 : 0;
  return `<div class="info-row gallery-row">
    <span class="tile sm pink" aria-hidden="true">🖼️</span>
    <span class="info-text"><span class="label">${t('morePhotos')}</span>
      <span class="value ${pics.length ? '' : 'add quiet'}">${esc(pics.length ? t('nPhotos', getLang(), pics.length) : t('morePhotosHint'))}</span></span>
  </div>
  <div class="gallery">
    ${pics.map((g, i) => `<button type="button" class="thumb" data-act="zoom-gallery" data-pid="${p.id}" data-i="${i + offset}" aria-label="${esc(`${t('viewPhoto')} ${i + 1}`)}"><img src="${esc(g.url)}" alt="" loading="lazy" /></button>`).join('')}
    <button type="button" class="thumb add-thumb" data-act="add-gallery" data-pid="${p.id}" aria-label="${esc(t('addMorePhoto'))}">${ICON.plus}<span>${t('addMorePhoto')}</span></button>
  </div>`;
}

/** One relative on someone's page. `of` is whose page it is: a relative with another surname
 *  (a married daughter, a grandparent from the other side) is shown with it. */
function relativeRow(k, end = 'status', of = null) {
  const ks = spouseOf(k.id);
  const name = of && last(k) && last(k) !== last(of) ? full(k) : first(k);
  return `<div class="person-row line">
    ${avatar(k, 'sm')}
    <a class="person-text" href="#/person/${k.id}">
      <span class="title he">${esc(withZl(k, name))}</span>
      <span class="sub">${nameLine(firstIn(k, otherLang()), ks)}</span>
      ${birthdayLine(k)}
    </a>
    ${end === 'edit' ? '' : childStatus(k)}
    <a class="pencil view" href="#/person/${k.id}" aria-label="${esc(`${t('openProfile')}: ${first(k)}`)}">${ICON.eye}</a>
  </div>`;
}

/** Someone whose parents aren't in this tree (mostly who married in): their parents' names as text. */
function parentNamesRow(p) {
  const v = [p.father_name, p.mother_name].filter(Boolean).join(t('and'));
  return `<button type="button" class="info-row ${v ? '' : 'missing'}" data-act="edit" data-field="parentNames" data-pid="${p.id}">
    <span class="tile sm lilac" aria-hidden="true">👪</span>
    <span class="info-text"><span class="label">${t('parentNames')}</span>
      <span class="value ${v ? '' : 'add quiet'}">${esc(v || t('addParentNames'))}</span></span>
    <span class="link">${t(v ? 'edit' : 'add')}</span>
  </button>`;
}

/** What the progress bar counts as missing for this household (household()), as a list to fix: each
 *  item opens what fills it in — the photo picker, the date picker, the field's editor. */
const MISSING_LABEL = { birthday: 'birthday', photo: 'photo', city: 'city', phone: 'phone', email: 'email', contact: 'c_contact', anniversary: 'anniversary', family_photo: 'familyPhoto' };
function missingSheet(pid) {
  const p = person(pid);
  const items = household(p).filter(([x, k]) => !HAS[k](x));
  const dlg = $('#sheet');
  dlg.innerHTML = `<form method="dialog" class="sheet-form"><h2>${t('missingTitle')} · ${esc(first(p))}</h2>
    <div class="card list">${items.map(([x, k], i) => `<button type="button" class="person-row missing-item" data-i="${i}">
        ${avatar(x, 'xs', { camera: false })}
        <span class="person-text"><span class="title">${esc(withZl(x, first(x)))}</span><span class="sub">${t(MISSING_LABEL[k] ?? k)}</span></span>
        <span class="chip amber solid">${t('add')}</span></button>`).join('')}</div>
    <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button></div></form>`;
  dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
  dlg.querySelectorAll('.missing-item').forEach((btn) => btn.addEventListener('click', () => {
    const [x, k] = items[Number(btn.dataset.i)];
    dlg.close();
    if (k === 'photo') return pickPhoto(x.id);
    if (k === 'family_photo') return pickPhoto(`family:${coupleOf(x.id).id}`);
    return openSheet(k, x.id);   // birthday, anniversary, contact, city, phone, email
  }));
  dlg.showModal();
}

function annivRow(p, c) {
  const v = formatDate({ h_day: c.w_day, h_month: c.w_month, h_year: c.w_year }, getLang());
  return `<button type="button" class="info-row ${v ? '' : 'missing'}" data-act="edit" data-field="anniversary" data-pid="${p.id}">
    <span class="tile sm ${v ? 'pink' : 'amber'}" aria-hidden="true">💍</span>
    <span class="info-text"><span class="label">${isEngaged(c) ? t('engagedWedding') : t('anniversary')}</span>
      <span class="value ${v ? 'he' : 'add'}">${esc(v ? [v, isEngaged(c) && c.venue].filter(Boolean).join(' · ') : t(isEngaged(c) ? 'addWedding' : 'addAnniversary'))}</span></span>
    ${v ? `<span class="link">${t('edit')}</span>` : `<span class="chip amber solid">${t('add')}</span>`}
  </button>`;
}

function childStatus(p) {
  const n = needs(p);
  if (!n.length) return `<span class="chip green">${t('full')}</span>`;
  const emoji = { birthday: '🎂', photo: '📸', contact: '📞' }[n[0]];
  return `<span class="chip amber">${emoji} ${t('missing')}</span>`;
}

/** Someone with no parents in the tree whose parents are in the earlier roots (Mordechai, Dusya, a cousin
 *  who married in): those parents, linking to their roots pages, so you can go on up from there. */
function rootsParents(p) {
  if (p.parents) return [];
  loadRoots();
  const r = state.roots?.byMain.get(p.id);
  return r ? rootsParentsOf(r) : [];
}
/** The brothers and sisters, in the earlier roots, of someone whose parents are only there. */
function rootsSiblings(p) {
  if (p.parents) return [];
  const r = state.roots?.byMain.get(p.id);
  if (!r?.parents) return [];
  return state.roots.people.filter((x) => x.parents === r.parents && x.id !== r.id && !x.hidden)
    .sort((a, b) => (a.born?.y ?? 9999) - (b.born?.y ?? 9999));
}
/** A tree person's other marriages that are only in the earlier roots, with their children there (not in the tree). */
function rootsOtherMarriages(p) {
  loadRoots();
  const r = state.roots?.byMain.get(p.id);
  if (!r) return [];
  const R = state.roots;
  const inTree = (x) => x?.main_person && person(x.main_person);
  return R.couples.filter((c) => c.a === r.id || c.b === r.id).map((c) => {
    const spouse = R.byId.get(c.a === r.id ? c.b : c.a);
    if (spouse && inTree(spouse)) return null;   // the marriage in the tree itself
    const list = R.people.filter((x) => x.parents === c.id && !x.hidden && !inTree(x)).sort((a, b) => (a.born?.y ?? 9999) - (b.born?.y ?? 9999));
    return list.length ? { spouse, list } : null;
  }).filter(Boolean);
}
/** A husband and wife who are also related by blood, through the extended family (e.g. she married into the
 *  family and is also his 2nd cousin's daughter): one line under the spouse, on both their profiles. */
function alsoKin(p, sp) {
  if (!state.roots || !sp) return '';
  const x = !p.parents ? p : !sp.parents ? sp : null;   // the one who married in
  if (!x) return '';
  const other = x === p ? sp : p;
  const r = relations(kin(), other.id, x.id).find((y) => y.kind === 'blood');
  if (!r) return '';
  const L = getLang(), on = first(other);
  const what = L === 'he'
    ? (/ שלך/.test(r.label.he) ? r.label.he.replace(/ שלך/, ` של ${on}`) : `${r.label.he} של ${on}`)
    : (r.label.en.includes('your ') ? r.label.en.replace('your ', `${on}'s `) : `${on}'s ${r.label.en}`);
  return `<a class="kin-note" href="#/roots/${encodeURIComponent(state.roots.byMain.get(x.id)?.id ?? '')}">🔗 ${esc(t(x.sex === 'f' ? 'alsoKinF' : 'alsoKinM', L, first(x), what))}</a>`;
}
/** On someone else's profile, when the app knows who you are: every way they're related to you (e.g. both your
 *  sister-in-law and your 3rd cousin), each opening to its path, the same as on the extended-family pages. */
function relSection(p) {
  if (!api.me || !person(api.me) || p.id === api.me) return '';
  const L = getLang();
  const seen = new Set();
  const rels = relations(kin(), api.me, p.id).filter((r) => !seen.has(r.label[L]) && seen.add(r.label[L]));
  if (!rels.length) return '';
  const n = dor(kin(), api.me, p.id);
  return `<div class="sec-head"><h2>${t('howRelated')}</h2></div>
    <div class="card pad rel-card">${rels.map((r) => `<details class="rel">
      <summary><b>${esc(r.label[L])}</b>${r.label.line ? `<span class="dim"> · ${esc(r.label.line[L])}</span>` : ''}</summary>
      ${pathSteps(r)}
    </details>`).join('')}
    ${n ? `<p class="dor">${t('dorLine', L, n, `<bdi>${esc(withZl(p, named(p)))}</bdi>`)}</p>` : ''}</div>`;
}
// ---------- Documents, videos and links on a profile ----------
// Kept per person (a tree person or someone in the extended family), any number, in the order the family sets:
// a file (a PDF, a scan: sent straight to the storage), a Vimeo video (played right here) or a link.
// Fetched when the profile is opened (state.items: person -> list, or null while it is on its way).
function itemsOf(person) {
  state.items ??= new Map();
  if (!state.items.has(person)) {
    state.items.set(person, null);
    api.items(person).then((list) => { state.items.set(person, Array.isArray(list) ? list : []); render(); }).catch(() => state.items.set(person, []));
  }
  return state.items.get(person) ?? [];
}
const fileSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : n ? `${n} B` : '');
/** A Vimeo link as the address its player takes (an unlisted video's link carries a second part, its key). */
function vimeoSrc(url) {
  const m = String(url ?? '').match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?/i);
  if (!m) return null;
  const h = m[2] ?? (() => { try { return new URL(url).searchParams.get('h'); } catch { return null; } })();
  return `https://player.vimeo.com/video/${m[1]}${h ? `?h=${encodeURIComponent(h)}` : ''}`;
}
/** A YouTube link (watch, youtu.be, shorts, live, embed) as the address its player takes. */
function youtubeSrc(url) {
  const m = String(url ?? '').match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}
const videoSrc = (url) => vimeoSrc(url) ?? youtubeSrc(url);
// ---- preview pictures: the first page of a PDF, a scan made small, or the picture a linked page offers.
const THUMB_W = 360;
const canThumb = (it) => it.kind === 'link' || (it.kind === 'file' && (/pdf/i.test(it.file_type ?? '') || /\.pdf$/i.test(it.file_name ?? '') || /^image\/(jpeg|png|webp|gif)/i.test(it.file_type ?? '')));
const toJpeg = (canvas) => new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.82));
/** Draws the small picture of a file (a Blob): a PDF's first page (pdf.js, loaded only now) or a scan. Throws
 *  { bad: true } when the file itself can't be drawn (so it isn't tried again), anything else when this browser can't. */
async function drawThumb(blob, isPdf) {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  if (!isPdf) {
    const img = await createImageBitmap(blob).catch(() => { throw Object.assign(new Error('image'), { bad: true }); });
    const k = Math.min(1, THUMB_W / img.width);
    canvas.width = Math.round(img.width * k); canvas.height = Math.round(img.height * k);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return toJpeg(canvas);
  }
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = await blob.arrayBuffer();
  const task = pdfjs.getDocument({ data, wasmUrl: '/pdfjs/wasm/', standardFontDataUrl: '/pdfjs/standard_fonts/', cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, iccUrl: '/pdfjs/iccs/' });
  const doc = await task.promise.catch((e) => { throw Object.assign(e, { bad: /Invalid|Password|Missing|Format/i.test(e?.name ?? '') }); });
  try {
    const page = await doc.getPage(1), base = page.getViewport({ scale: 1 });
    const view = page.getViewport({ scale: THUMB_W / base.width });
    canvas.width = Math.round(view.width); canvas.height = Math.round(view.height);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport: view }).promise;
    return toJpeg(canvas);
  } finally { task.destroy().catch(() => {}); }
}
/** The item with its new preview, put in the list and (if it is on the screen) in its place on the page. */
function thumbDone(row) {
  if (!row?.id) return;
  for (const [person, list] of state.items ?? []) {
    const i = list?.findIndex((x) => String(x.id) === String(row.id)) ?? -1;
    if (i >= 0) state.items.set(person, list.map((x, j) => (j === i ? { ...x, thumb_key: row.thumb_key } : x)));
  }
  if (row.thumb_key && row.thumb_key !== 'none') document.querySelectorAll(`[data-thumb="${row.id}"]`).forEach((el) => { el.outerHTML = itemPic(row); });
}
const thumbTried = new Set();
let thumbLine = Promise.resolve();
/** Makes the preview of an item that has none: right after an upload (`file` is at hand), or for an older item the
 *  first time anyone sees it. One at a time, each tried once in a visit, and never in the way of anything. */
function wantThumb(it, file = null) {
  if (it.thumb_key || !canThumb(it) || thumbTried.has(it.id)) return;
  if (!file && it.kind === 'file' && (it.file_size ?? 0) > 40 * 1024 * 1024) return;
  thumbTried.add(it.id);
  thumbLine = thumbLine.then(async () => {
    if (it.kind === 'link') return thumbDone(await api.findItemThumb(it.id));
    const isPdf = /pdf/i.test(it.file_type ?? '') || /\.pdf$/i.test(it.file_name ?? '');
    try {
      const blob = file ?? await fetch(api.itemFileUrl(it)).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`))));
      const pic = await drawThumb(blob, isPdf);
      if (pic) thumbDone(await api.sendItemThumb(it.id, pic));
    } catch (e) { console.warn('preview of item', it.id, 'not made:', e); if (e?.bad) thumbDone(await api.noItemThumb(it.id)); }
  }).catch(() => {});
}
const hasThumb = (it) => Boolean(it.thumb_key && it.thumb_key !== 'none');
const itemPic = (it) => `<img class="item-thumb" src="${esc(api.itemThumbUrl(it))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true" />`;
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
function itemsRow(person, seeOnly = false) {
  if (DEMO) return '';   // the browser-only demo has no server to keep documents on
  const list = itemsOf(person), editing = !seeOnly && state.itemsEdit === person, id = esc(person);
  if (seeOnly && !list.length) return '';
  const tools = (it, i) => (editing ? `<span class="item-tools">
      <button type="button" data-act="item-move" data-id="${it.id}" data-dir="up" ${i ? '' : 'disabled'} aria-label="${esc(t('itemUp'))}">↑</button>
      <button type="button" data-act="item-move" data-id="${it.id}" data-dir="down" ${i < list.length - 1 ? '' : 'disabled'} aria-label="${esc(t('itemDown'))}">↓</button>
      <button type="button" data-act="item-edit" data-id="${it.id}" aria-label="${esc(t('edit'))}">✏️</button>
      <button type="button" data-act="item-delete" data-id="${it.id}" aria-label="${esc(t('remove'))}">🗑️</button></span>` : '');
  const note = (it) => (it.note ? `<span class="item-note" dir="auto">${esc(it.note)}</span>` : '');
  const one = (it, i) => {
    wantThumb(it);
    const title = esc(it.title || it.file_name || host(it.url) || '');
    if (it.kind === 'video') {
      const src = videoSrc(it.url);
      return `<div class="item video"><div class="item-head"><b dir="auto">${title}</b>${tools(it, i)}</div>${note(it)}
        ${src ? `<div class="item-player"><iframe src="${esc(src)}" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen title="${title}"></iframe></div>` : `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.url)}</a>`}</div>`;
    }
    const href = it.kind === 'file' ? api.itemFileUrl(it) : it.url;
    const sub = it.kind === 'file' ? [/pdf/i.test(it.file_type ?? '') ? 'PDF' : (it.file_name ?? '').split('.').pop()?.toUpperCase(), fileSize(it.file_size)].filter(Boolean).join(' · ') : host(it.url);
    return `<div class="item"><div class="item-head"><a class="item-link" href="${esc(href)}" target="_blank" rel="noopener">${hasThumb(it) ? itemPic(it) : `<span class="item-ico" data-thumb="${it.id}" aria-hidden="true">${it.kind === 'file' ? '📄' : '🔗'}</span>`}<span class="item-text"><b dir="auto">${title}</b><span class="sub">${esc(sub)}</span></span></a>${tools(it, i)}</div>${note(it)}</div>`;
  };
  return `<div class="info-row gallery-row">
    <span class="tile sm lilac" aria-hidden="true">📄</span>
    <span class="info-text"><span class="label">${t('itemsTitle')}</span>
      <span class="value ${list.length ? '' : 'add quiet'}">${esc(list.length ? t('nItems', getLang(), list.length) : t('itemsHint'))}</span></span>
    ${seeOnly ? '' : `${list.length ? `<button type="button" class="link" data-act="items-edit" data-id="${id}">${t(editing ? 'itemsDone' : 'itemsOrder')}</button>` : ''}
    <button type="button" class="link" data-act="item-add" data-id="${id}">${t('add')}</button>`}
  </div>
  ${list.length ? `<div class="items">${list.map(one).join('')}</div>` : ''}`;
}
/** The sheet for adding one: what it is (a file, a video, a link), its title, a line about it. */
function itemAddSheet(person) {
  const dlg = $('#sheet');
  dlg.innerHTML = `<form method="dialog" class="sheet-form item-form">
    <h2>${t('itemsAdd')}</h2>
    <div class="seg" role="radiogroup">${[['file', t('itemFile')], ['video', t('itemVideo')], ['link', t('itemLink')]].filter(([v]) => v !== 'file' || FAMILY.files !== false).map(([v, label], i) => `
      <label><input type="radio" name="kind" value="${v}" ${i ? '' : 'checked'} /><span>${label}</span></label>`).join('')}</div>
    <label class="field" data-for="file"><span>${t('itemChoose')}</span><input type="file" name="file" /></label>
    <label class="field" data-for="url" hidden><span data-url-label></span><input name="url" type="url" dir="ltr" autocomplete="off" maxlength="600" /></label>
    <label class="field"><span>${t('itemTitle')}</span><input name="title" dir="auto" maxlength="200" autocomplete="off" /></label>
    <label class="field"><span>${t('itemNote')}</span><input name="note" dir="auto" maxlength="1000" autocomplete="off" /></label>
    <p class="item-prog" hidden></p>
    <p class="err" hidden></p>
    <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button><button class="cta small">${t('save')}</button></div>
  </form>`;
  const f = dlg.querySelector('form'), prog = f.querySelector('.item-prog'), err = f.querySelector('.err');
  const show = () => {
    const k = f.kind.value;
    f.querySelector('[data-for="file"]').hidden = k !== 'file';
    f.querySelector('[data-for="url"]').hidden = k === 'file';
    f.querySelector('[data-url-label]').textContent = t(k === 'video' ? 'itemVimeoUrl' : 'itemUrl');
  };
  f.querySelectorAll('[name="kind"]').forEach((r) => r.addEventListener('change', show));
  show();
  dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const kind = f.kind.value, btn = f.querySelector('.cta');
    err.hidden = true;
    try {
      let body = { kind, title: f.title.value, note: f.note.value };
      if (kind === 'file') {
        const file = f.file.files[0];
        if (!file) throw new Error(t('itemNoFile'));
        if (file.size > 100 * 1024 * 1024) throw new Error(t('itemTooBig'));
        btn.disabled = true; prog.hidden = false;
        const up = await api.uploadFile(person, file, (x) => { prog.textContent = `${t('itemUploading')} ${Math.round(x * 100)}%`; });
        body = { ...body, ...up };
      } else {
        body.url = f.url.value.trim();
        if (kind === 'video' && !videoSrc(body.url)) throw new Error(t('itemNotVimeo'));
        btn.disabled = true;
      }
      const row = await api.addItem(person, body);
      state.items.set(person, [...(state.items.get(person) ?? []), row]);
      if (kind === 'file') wantThumb(row, f.file.files[0]);
      dlg.close(); render();
    } catch (e) {
      btn.disabled = false; prog.hidden = true;
      err.textContent = t('saveErr') + e.message; err.hidden = false;
    }
  });
  dlg.showModal();
}
/** One item's title and line, changed. */
function itemEditSheet(person, it) {
  const dlg = $('#sheet');
  dlg.innerHTML = `<form method="dialog" class="sheet-form">
    <h2>${t('itemsTitle')}</h2>
    <label class="field"><span>${t('itemTitle')}</span><input name="title" dir="auto" maxlength="200" autocomplete="off" value="${esc(it.title ?? '')}" /></label>
    <label class="field"><span>${t('itemNote')}</span><input name="note" dir="auto" maxlength="1000" autocomplete="off" value="${esc(it.note ?? '')}" /></label>
    <p class="err" hidden></p>
    <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button><button class="cta small">${t('save')}</button></div>
  </form>`;
  const f = dlg.querySelector('form');
  dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const row = await api.saveItem(it.id, { title: f.title.value, note: f.note.value });
      state.items.set(person, state.items.get(person).map((x) => (x.id === row.id ? row : x)));
      dlg.close(); render();
    } catch (e) { const x = f.querySelector('.err'); x.textContent = t('saveErr') + e.message; x.hidden = false; }
  });
  dlg.showModal();
}
/** The list an item is in, and the person it belongs to. */
const itemHome = (id) => { for (const [person, list] of state.items ?? []) { const it = list?.find((x) => String(x.id) === String(id)); if (it) return { person, it }; } return {}; };

/** Ancestors (in the tree and on up through the extended family) who share a first name with this person:
 *  any one of the names is enough (משה for משה יהודה), spellings that go together count as one, and only
 *  the same sex. Nearest first, each once. */
const NAME_SKIP = new Set(['ר', 'רבי', 'רב', 'הרב', 'מרת', 'r', 'rabbi', 'rav', 'reb', 'בן', 'בת', 'בר', 'ben', 'bat', 'bas', 'of', 'wife', 'אשת', 'nn', '?', 'הכהן', 'הלוי', 'hacohen', 'halevi']);
// 'יוסף בן משה', 'Yosef ben Moshe': what follows בן / ben is the father's name, not theirs.
const ownName = (x) => String(x ?? '').replace(/\s(?:בן|בת|בר|ב"ר|ben|bat|bas|bar|ibn|(?:son|daughter) of)\s.*$/i, '');
// A tree person's full Hebrew name counts too (דוסיא, whose full name is דוואשא, shares it with a דוואשא above her).
const nameKeys = (x) => new Set(words(ownName(x.he_first), ownName(x.en_first), ownName(x.he_full)).map((w) => w.replace(/[().,]/g, '')).filter((w) => w.length > 1 && !NAME_SKIP.has(w)).flatMap((w) => [w, ...(sameOne.get(w) ?? [])]));
function sameNameAncestors(tp, rp) {
  const R = state.roots, me = tp ?? rp, mine = nameKeys(me);
  if (!mine.size) return [];
  const sex = me.sex?.toLowerCase();
  const cById = R ? (R.coupleById ??= new Map(R.couples.map((c) => [c.id, c]))) : null;
  const up = (n) => {
    if (n.t) {
      const c = n.t.parents && couple(n.t.parents);
      if (c) return [c.a, c.b].map(person).filter(Boolean).map((x) => ({ t: x }));
      const r = R?.byMain.get(n.t.id);
      return r ? up({ r }) : [];
    }
    const c = n.r.parents && cById?.get(n.r.parents);
    return c ? [c.a, c.b].map((x) => R.byId.get(x)).filter(Boolean).map((r) => (r.main_person && person(r.main_person) ? { t: person(r.main_person) } : { r })) : [];
  };
  const seen = new Set([me.id]), out = [];
  let level = [tp ? { t: tp } : { r: rp }];
  for (let g = 1; level.length && g < 80; g++) {
    const next = [];
    for (const n of level) for (const a of up(n)) {
      const x = a.t ?? a.r;
      if (seen.has(x.id)) continue;
      seen.add(x.id); next.push(a);
      if (a.r?.hidden || (sex && x.sex && x.sex.toLowerCase() !== sex)) continue;
      if ([...nameKeys(x)].some((w) => mine.has(w))) out.push({ ...a, g });
    }
    level = next;
  }
  return out;
}
function sameNameSection(tp, rp) {
  const list = sameNameAncestors(tp, rp);
  if (!list.length) return '';
  const row = (a) => {
    const sub = `<span class="sub">${esc(t('sameNameGen', getLang(), a.g))}</span>`;
    return a.t ? `<a class="person-row line" href="#/person/${a.t.id}">${avatar(a.t, 'sm', { camera: false })}<span class="person-text"><span class="title he">${esc(withZl(a.t, named(a.t)))}</span>${sub}</span></a>`
      : `<a class="person-row line" href="#/roots/${encodeURIComponent(a.r.id)}">${rootsAv(a.r, 'sm')}<span class="person-text"><span class="title he"><bdi>${esc(rootsName(a.r))}</bdi></span>${sub}</span></a>`;
  };
  const me = (tp ?? rp).id, shown = state.sameShown?.id === me ? state.sameShown.n : 6;
  return `<div class="sec-head"><h2>${t('sameName')}</h2></div>
    <div class="card list">${list.slice(0, shown).map(row).join('')}${list.length > shown ? `<button type="button" class="link same-more" data-act="same-more" data-id="${esc(me)}" data-n="${shown + 12}">${esc(t('sameNameMore', getLang(), list.length - shown))}</button>` : ''}</div>`;
}

/** A roots person's parents, father first. */
function rootsParentsOf(r) {
  const c = r?.parents && state.roots.couples.find((x) => x.id === r.parents);
  return c ? [c.a, c.b].map((x) => state.roots.byId.get(x)).filter((x) => x && !x.hidden).sort((x, y) => (x.sex === 'F') - (y.sex === 'F')) : [];
}

function personPage(id) {
  const p = person(id);
  if (!p) return notFound();
  const isMe = id === api.me;
  const fields = profileFields(p);
  const items = household(p);
  const done = items.filter(([x, k]) => HAS[k](x)).length;
  const pct = Math.round((done / items.length) * 100);
  const left = items.length - done;
  const family = items.some(([x]) => x !== p);
  const sp = spouseOf(id);
  const c = coupleOf(id);
  const kids = c ? childrenOf(c.id) : [];
  // Children are added to a couple, so only once there is a spouse.
  const canAddKids = Boolean(sp) && !closed(c);
  // Parents, both sets of grandparents that are in the tree, and brothers and sisters, so anyone
  // can reach (and fill in) the people above them. The five sons are complete: no adding there.
  const pc = p.parents ? couple(p.parents) : null;
  const parentRows = pc ? [person(pc.a), person(pc.b)].filter(Boolean) : [];
  // Someone who married in has no parents here (theirs are in another family, if anywhere): show
  // their husband's or wife's parents instead, as their in-laws.
  const spc = !pc && sp?.parents ? couple(sp.parents) : null;
  const inLawRows = spc && !spc.root ? [person(spc.a), person(spc.b)].filter(Boolean) : [];
  const grandRows = parentRows.flatMap((x) => {
    const gc = x.parents ? couple(x.parents) : null;
    return gc ? [person(gc.a), person(gc.b)].filter(Boolean) : [];
  });
  // Grandparents who aren't in the tree but are in the earlier roots (Mordechai's and Dusya's parents, for
  // their children): shown with the rest, linking to their roots pages.
  // A cousin who married in (no parents in the tree): their grandparents from the roots too.
  // Children from another marriage that's only in the earlier roots (Yaakov's first wife, Feiga): listed with his
  // children, under "from his marriage to …". Not on the other spouse's profile.
  const otherKids = rootsOtherMarriages(p);
  const rootsGrand = [...parentRows.flatMap((x) => rootsParents(x)), ...(pc ? [] : rootsParents(p).flatMap(rootsParentsOf))];
  const sibs = pc ? childrenOf(pc.id).filter((x) => x.id !== p.id) : [];
  // No parents in the tree, but in the earlier roots (Mordechai, Dusya, a cousin who married in): their
  // brothers and sisters from there, oldest first when the year is known.
  const rootsSibs = pc ? [] : rootsSiblings(p);
  const canAddSibs = Boolean(pc) && !closed(pc);
  // No spouse section for children: only for adults (married, 18+, or by generation without a year).
  const showSpouse = Boolean(sp) || isAdult(p);
  // Without a birth year we can't tell a child from a married grandchild (in a big family, many
  // great-grandchildren are married): offer adding a spouse quietly, without flagging it as missing.
  const maybeSpouse = !showSpouse && !p.h_year && !p.deceased;
  const subLine = [p.he_full !== p.he_first && p.he_full, (p.maiden || p.maiden_he) && t('nee', getLang(), (getLang() === 'he' ? p.maiden_he || p.maiden : p.maiden || p.maiden_he)), fullIn(p, otherLang()) && withZl(p, fullIn(p, otherLang()), otherLang()), cityOf(p)].filter(Boolean).join(' · ');

  // After the grandparents (after the parents, for someone with none shown): the drawn tree from this
  // person, on up (where the site has earlier roots).
  const hasGrand = Boolean(grandRows.length || rootsGrand.length);
  const chartRow = hasChart() ? `<a class="info-row t2-row" href="#/chart/${id}">
      <span class="tile sm lilac" aria-hidden="true">🌳</span>
      <span class="info-text"><span class="value">${t('t2ViewEarlier')}</span><span class="label">${t('t2TreeView')}</span></span>
      <span class="link" aria-hidden="true">›</span></a>` : '';
  // The same, for someone with no parents shown here: there are no earlier generations to promise, only the tree.
  const treeRow = hasChart() ? `<a class="info-row t2-row" href="#/chart/${id}">
      <span class="tile sm lilac" aria-hidden="true">🌳</span>
      <span class="info-text"><span class="value">${t('viewInTree')}</span></span>
      <span class="link" aria-hidden="true">›</span></a>` : '';
  return hero({
    cls: 'tall',
    left: backBtn(),
    center: isMe ? `<span class="pill-welcome">${t('welcome')}</span>` : '',
    body: `<div class="profile-head">
      ${avatar(p, 'xl')}
      <div class="name-line"><h1 class="hello">${esc(isMe ? t('hello', getLang(), first(p)) : withZl(p, namedTribe(p)))}</h1><button type="button" class="pencil on-hero" data-act="edit" data-field="names" data-pid="${id}" aria-label="${esc(t('editName'))}">✏️</button></div>
      <p class="dim">${esc(subLine)}</p>
      <button type="button" class="complete-box" data-act="missing" data-pid="${id}" ${left ? '' : 'disabled'}>
        <span class="progress-labels"><span>${t(family ? (isMe ? 'myFamilyPct' : 'familyPct') : (isMe ? 'myPct' : 'pct'), getLang(), pct)}</span><span class="dim">${left ? `${t('nMissingItems', getLang(), left)} ›` : t('allFilled')}</span></span>
        <span class="bar thick"><span class="warm" style="width:${pct}%"></span></span>
      </button>
    </div>`,
  }) + `<main class="content">
    ${isMe && FAMILY.tehillim !== false ? tehillimBlock(p) : ''}
    <div class="sec-head"><h2>${t(isMe ? 'myInfo' : 'info')}</h2></div>
    <div class="card list">${fields.map((k) => infoRow(p, k) + (k === 'birthday' ? gradeRow(p) : '')).join('')}${p.deceased ? matzeivaRow(matzeivaOf(p.id)?.url, 'matzeiva', p.id, p.burial) : ''}${galleryRow(p)}</div>

    ${isMe ? '' : relSection(p)}

    ${showSpouse ? `<div class="sec-head"><h2>${t('spouse')}</h2>${sp ? '' : `<button type="button" class="link" data-act="edit" data-field="spouse" data-pid="${id}">${t('addSpouse')}</button>`}</div>
    <div class="card ${sp ? 'list' : 'pad'}">
      ${sp ? `<div class="person-row line">
        ${avatar(sp, 'md')}
        <a class="person-text" href="#/person/${sp.id}">
          <span class="title he">${esc(withZl(sp, first(sp)))}</span>
          <span class="sub"><bdi>${esc(fullIn(sp, otherLang()))}</bdi></span>
          ${birthdayLine(sp)}
        </a>
        <a class="chip amber" href="#/person/${sp.id}">${t('edit')}</a>
      </div>
      ${alsoKin(p, sp)}
      ${annivRow(p, c)}` : `<button type="button" class="person-row empty-row" data-act="edit" data-field="spouse" data-pid="${id}">
        <span class="av av-md dashed" aria-hidden="true">${ICON.plus}</span>
        <span class="person-text"><span class="sub">${t('noSpouse')}</span></span>
        <span class="chip amber solid">${t('add')}</span>
      </button>`}
    </div>` : maybeSpouse ? `<div class="sec-head"><h2>${t('spouse')}</h2><button type="button" class="link" data-act="edit" data-field="spouse" data-pid="${id}">${t('addSpouse')}</button></div>` : ''}
    ${sp ? `<div class="sec-head"><h2>${t('familyPhoto')}</h2></div>${familyPhoto(c)}` : ''}

    ${kids.length || canAddKids || otherKids.length ? `<div class="sec-head"><h2>${t('children')}</h2>${canAddKids ? `<button type="button" class="link" data-act="focus-child">${t('addChild')}</button>` : ''}</div>` : ''}
    ${kids.length ? `<div class="card list">${kids.map((k) => relativeRow(k, 'status', p)).join('')}</div>` : ''}
    ${otherKids.map(({ spouse, list }) => `<p class="other-marriage">${esc(t(p.sex === 'f' ? 'fromHerMarriage' : 'fromHisMarriage', getLang(), spouse ? rootsName(spouse) : t('unknownPerson')))}</p>
      <div class="card list">${list.map(rootsLink).join('')}</div>`).join('')}
    ${!canAddKids ? '' : `<form class="card add-child" data-form="child" data-pid="${id}">
      <div class="add-child-head">${t('newChild')}</div>
      <div class="add-child-row">
        <span class="av av-sm dashed" aria-hidden="true">${ICON.plus}</span>
        <input name="first" required aria-label="${t('firstName')}" placeholder="${t('firstName')}..." />
        <input name="last" aria-label="${t('lastName')}" placeholder="${t('lastName')}..." value="${esc(last(p))}" />
        <button class="btn-sm">${t('addBtn')}</button>
      </div>
      <div class="add-child-row tinted">${sexPick(null)}</div>
    </form>`}

    ${parentRows.length ? `<div class="sec-head"><h2>${t('parents')}</h2></div>
    <div class="card list">${parentRows.map((x) => relativeRow(x, 'edit', p)).join('')}${hasGrand ? '' : chartRow}</div>
    ${pc.root ? '' : familyPhoto(pc)}` : ''}${pc && !parentRows.length && !hasGrand && treeRow ? `<div class="card list">${treeRow}</div>` : ''}

    ${!pc ? `<div class="sec-head"><h2>${t('parents')}</h2>${state.roots?.byMain.get(p.id) ? `<a class="link" href="#/roots/${encodeURIComponent(state.roots.byMain.get(p.id).id)}">${t(p.sex === 'f' ? 'herExtended' : 'hisExtended')} ›</a>` : ''}</div>
    <div class="card list">${rootsParents(p).length ? rootsParents(p).map(rootsLink).join('') + (hasGrand ? '' : chartRow) : parentNamesRow(p) + (hasGrand ? '' : treeRow)}</div>` : ''}

    ${inLawRows.length ? `<div class="sec-head"><h2>${t('inLaws')}</h2></div>
    <div class="card list">${inLawRows.map((x) => relativeRow(x, 'edit', p)).join('')}</div>` : ''}

    ${grandRows.length || rootsGrand.length ? `<div class="sec-head"><h2>${t('grandparents')}</h2></div>
    <div class="card list">${grandRows.map((x) => relativeRow(x, 'edit', p)).join('')}${rootsGrand.map(rootsLink).join('')}${chartRow}</div>` : ''}

    ${sibs.length || canAddSibs ? `<div class="sec-head"><h2>${t('siblings')}</h2>${canAddSibs ? `<button type="button" class="link" data-act="focus-sibling">${t('addSibling')}</button>` : ''}</div>` : ''}
    ${sibs.length ? `<div class="card list">${sibs.map((x) => relativeRow(x, 'status', p)).join('')}</div>` : ''}
    ${rootsSibs.length ? `<div class="sec-head"><h2>${t('siblings')}</h2></div><div class="card list">${rootsSibs.map(rootsLink).join('')}</div>` : ''}
    ${canAddSibs ? `<form class="card add-child" data-form="sibling" data-couple="${p.parents}">
      <div class="add-child-head">${t('newSibling')}</div>
      <div class="add-child-row">
        <span class="av av-sm dashed" aria-hidden="true">${ICON.plus}</span>
        <input name="first" required aria-label="${t('firstName')}" placeholder="${t('firstName')}..." />
        <input name="last" aria-label="${t('lastName')}" placeholder="${t('lastName')}..." value="${esc(last(person(pc.a)) || last(p))}" />
        <button class="btn-sm">${t('addBtn')}</button>
      </div>
      <div class="add-child-row tinted">${sexPick(null)}</div>
    </form>` : ''}
    ${sameNameSection(p, null)}
    <div class="card list items-card">${itemsRow(p.id)}</div>
    ${isMe || canArchive(p) || canExport(c) ? `<div class="profile-foot">
      ${canExport(c) ? `<button type="button" class="escape quiet" data-act="export" data-cid="${c.id}">${t('exportBranch')}</button>` : ''}
      ${isMe ? `<button type="button" class="escape quiet" data-act="not-me">${t('notMe')}</button>
      <button type="button" class="escape quiet" data-act="logout">${t('logout')}</button>`
      : canArchive(p) ? `<button type="button" class="escape quiet" data-act="archive" data-pid="${id}">${t('archive')}</button>` : ''}
    </div>` : ''}
    ${localNote()}
  </main>${nav(isMe ? 'profile' : null)}`;
}

// ---------- archive ----------

/** Someone can be archived when no one hangs below them: no children, and not the top couple. */
/** Everyone in a couple's branch: the two of them, their descendants and those descendants'
 *  husbands and wives (the same rule as a whole family, lib/family.mjs). */
function branchMembers(coupleId) {
  const members = new Set();
  const queue = [couple(coupleId)].filter(Boolean);
  while (queue.length) {
    const c = queue.shift();
    members.add(c.a); if (c.b) members.add(c.b);
    for (const k of childrenOf(c.id)) { members.add(k.id); const kc = coupleOf(k.id); if (kc) queue.push(kc); }
  }
  return members;
}
/** The couples whose branch is a person's own line: the couple they are in, and every couple they
 *  or their husband or wife descend from (a married couple count as one: he can take her side). */
function ownLine(id) {
  const line = new Set();
  const own = coupleOf(id);
  if (own) line.add(own.id);
  const queue = [person(id)?.parents, spouseOf(id)?.parents];
  while (queue.length) {
    const c = couple(queue.shift());
    if (!c || line.has(c.id)) continue;
    line.add(c.id);
    for (const x of [c.a, c.b]) if (person(x)?.parents) queue.push(person(x).parents);
  }
  return line;
}
/** Exporting a branch (for another installation of the tree) is for someone whose own line it is
 *  (theirs or their spouse's), and never the whole tree from the top couple. Two trees share exactly the branch under the
 *  marriage that joins them, so that is what anyone needs to take. The server checks the same
 *  (functions/export.mjs). Not in the local preview: there is no server to ask. */
const canExport = (c) => Boolean(c && !c.root && api.me && api.mode === 'server' && ownLine(api.me).has(c.id));
const canArchive = (p) => { const c = coupleOf(p.id); return !c || (!c.root && !childrenOf(c.id).length); };

function archivedPage() {
  const list = [...state.archived].sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at)));
  const row = (p) => {
    const c = p.parents && couple(p.parents);
    const sub = [c ? `${t('parents')}: ${coupleName(c)}` : '', t('archivedAgo', getLang(), ago(p.archived_at))].filter(Boolean).join(' · ');
    return `<div class="person-row line">
      ${avatar(p, 'sm', { camera: false })}
      <span class="person-text"><span class="title he">${esc(withZl(p, full(p)))}</span><span class="sub">${esc(sub)}</span></span>
      <button type="button" class="chip amber solid" data-act="restore" data-pid="${p.id}">${t('restore')}</button>
    </div>`;
  };
  return hero({
    left: backBtn(),
    body: `<div class="title-block"><h1 class="hero-title">${t('archivedTitle')}</h1><p class="dim">${t('archivedTitle', otherLang())}</p></div>`,
  }) + `<main class="content">
    <p class="note">${t('archivedNote')}</p>
    ${list.length ? `<div class="card list">${list.map(row).join('')}</div>` : `<p class="empty">${t('noArchived')}</p>`}
  </main>${nav(hasChart() ? 'relatives' : 'tree')}`;
}

// ---------- Complete the Family ----------

const CATS = [['photo', '📸'], ['birthday', '🎂'], ['contact', '📞']];

function familyPage() {
  const all = state.people;
  const complete = all.filter((p) => !needs(p).length).length;
  const pct = all.length ? Math.round((complete / all.length) * 100) : 0;
  const counts = editCounts();
  const mine = counts.get(api.me) ?? { total: 0 };
  const badges = [['📸', 'b_photo', (mine.photo ?? 0) >= 3], ['🎂', 'b_birthday', (mine.birthday ?? 0) >= 3], ['⭐', 'b_ten', mine.total >= 10]];
  const needy = all.filter((p) => needs(p).length);
  const count = (cat) => needy.filter((p) => needs(p).includes(cat)).length;
  const shown = needy
    .filter((p) => state.filter === 'all' || needs(p).includes(state.filter))
    .sort((a, b) => needs(b).length - needs(a).length || first(a).localeCompare(first(b)));
  const leaders = [...counts].filter(([by]) => person(by)).sort((a, b) => b[1].total - a[1].total).slice(0, 3);
  const filters = [['all', '', needy.length], ...CATS.map(([k, e]) => [k, e, count(k)])];

  return hero({
    left: `<div class="title-block"><h1 class="hero-title">${t('mTitle')}</h1><p class="dim">${t('mTitle', otherLang())}</p></div>`,
    body: `<div class="overall">
      <div class="progress-labels"><span>${t('nComplete', getLang(), complete, all.length)}</span><span class="pct">${pct}%</span></div>
      <div class="bar thick glow"><div style="width:${pct}%"></div></div>
      <ul class="badges">${badges.map(([e, key, on]) => `<li class="${on ? '' : 'locked'}"><span aria-hidden="true">${on ? e : '🔒'}</span>${t(key)}</li>`).join('')}</ul>
    </div>`,
  }) + `<main class="content">
    <div class="filters" role="tablist">
      ${filters.map(([k, e, n]) => `<button type="button" role="tab" aria-selected="${state.filter === k}" class="${state.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${e ? `${e} ` : ''}${t(`f_${k}`)} (${n})</button>`).join('')}
    </div>
    <h2 class="sec-title">${t('needHelp')}</h2>
    ${shown.length ? shown.map((p) => {
      const n = needs(p);
      const sp = spouseOf(p.id);
      const cats = CATS.filter(([k]) => k !== 'contact' || !p.deceased);
      return `<div class="card pad need">
        <div class="person-row">
          ${avatar(p, 'md')}
          <a class="person-text" href="#/person/${p.id}">
            <span class="title he">${esc(withZl(p, whose(p) ? full(p) : named(p)))}</span>
            <span class="sub">${whose(p) ? `<bdi>${esc(whose(p))}</bdi>` : nameLine(fullIn(p, otherLang()), sp)}</span>
          </a>
          <span class="chip pink">${t('nMiss', getLang(), n.length)}</span>
        </div>
        <div class="fix-row">
          ${cats.map(([k, e]) => (n.includes(k)
            ? `<button type="button" class="fix" ${k === 'photo' ? `data-act="photo" data-pid="${p.id}"` : `data-act="edit" data-field="${k}" data-pid="${p.id}"`}><span aria-hidden="true">${e}</span>${t(`c_${k}`)}</button>`
            : `<span class="fix ok"><span aria-hidden="true">${e}</span>${t('full')}</span>`)).join('')}
        </div>
      </div>`;
    }).join('') : `<p class="empty">${t('allDone')}</p>`}
    <section class="leaders">
      <h2>${t('leaders')}</h2>
      ${leaders.length ? `<ol>${leaders.map(([by, row], i) => {
        const p = person(by);
        return `<li><span class="rank r${i + 1}">${i + 1}</span>${avatar(p, 'xs', { camera: false })}<a href="#/person/${p.id}">${esc(named(p))}</a><span class="edits">${t('nEdits', getLang(), row.total)}</span></li>`;
      }).join('')}</ol>` : `<p class="empty">${t('noLeaders')}</p>`}
    </section>
    ${localNote()}
  </main>${nav('complete')}`;
}

// ---------- home: what's coming up, what's new ----------

const FEED = {
  photo: ['📸', 'feed_photo'], gallery: ['🖼️', 'feed_gallery'], family_photo: ['🖼️', 'feed_family_photo'], birthday: ['🎂', 'feed_birthday'],
  anniversary: ['💍', 'feed_anniversary'], names: ['✏️', 'feed_names'], city: ['📍', 'feed_contact'], address: ['🏠', 'feed_contact'], phone: ['📞', 'feed_contact'],
  email: ['✉️', 'feed_contact'], hobby: ['🎨', 'feed_hobby'], added: ['🌱', 'feed_added'], parents: ['🌳', 'feed_parents'],
};

function ago(at) {
  const rtf = new Intl.RelativeTimeFormat(getLang() === 'he' ? 'he' : 'en', { numeric: 'auto' });
  const s = (new Date(at) - Date.now()) / 1000;
  // Chrome's Hebrew says "לפני שעה (1)" / "לפני שעתיים (2)": the number in brackets only repeats the word.
  const say = (v, unit) => rtf.format(v, unit).replace(/\s*\(\d+\)\s*$/, '');
  for (const [unit, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= n) return say(Math.round(s / n), unit);
  }
  return say(0, 'minute');
}

/** One line of "What's new". Repeats of the same change by the same person are folded together. */
function feedItems() {
  const out = [];
  for (const e of state.recent ?? []) {
    const p = person(e.person);
    if (!p || !FEED[e.field]) continue;
    const prev = out.at(-1);
    if (prev && prev.by === e.by && prev.person === e.person && FEED[prev.field][1] === FEED[e.field][1]) continue;
    out.push(e);
    if (out.length >= 12) break;
  }
  return out;
}

function feedRow(e) {
  const p = person(e.person), by = person(e.by);
  const [emoji, key] = FEED[e.field];
  const c = coupleOf(p.id);
  const what = e.field === 'family_photo' && c ? t(key, getLang(), familyCaption(c).split(' · ')[1])
    : e.field === 'anniversary' && c ? t(key, getLang(), coupleName(c))
    : t(key, getLang(), withZl(p, named(p)));
  const who = by && !(e.field === 'added' && by.id === p.id) ? t('byWhom', getLang(), named(by)) : '';
  return `<a class="feed-row" href="#/person/${p.id}">
    ${e.field === 'family_photo' && c ? pair(c) : avatar(p, 'sm', { camera: false })}
    <span class="person-text"><span class="feed-what"><span aria-hidden="true">${emoji}</span> ${esc(what)}</span>
      <span class="sub">${[who, ago(e.at)].filter(Boolean).map(esc).join(' · ')}</span></span>
  </a>`;
}

function comingUp() {
  const entries = [
    ...state.people.filter((p) => !p.deceased).map((p) => ({ kind: 'birthday', p, h_day: p.h_day, h_month: p.h_month, h_year: p.h_year })),
    ...state.people.filter((p) => p.d_day).map((p) => ({ kind: 'yahrzeit', p, h_day: p.d_day, h_month: p.d_month, h_year: p.d_year })),
    ...state.couples.filter(liveAnniversary).map((c) => ({ kind: 'anniversary', c, h_day: c.w_day, h_month: c.w_month, h_year: c.w_year })),
  ];
  // Weddings aren't here: they have their own rows under "Mazal tov" (simchas).
  return upcoming(entries, 30).slice(0, 10);
}

/** "Mazal tov", above "coming up": babies born in the last 14 days (newest first), couples married in
 *  the last 7 days, then the next three weddings. Only with a full date: a baby with no birthday, or
 *  an engaged couple with no wedding date, isn't shown. */
function simchas() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = (x) => ({ ...x, days: Math.round((x.hd.greg() - today) / 864e5) });
  const babies = state.people.filter((p) => !p.deceased).map((p) => ({ kind: 'baby', p, hd: birthDay(p) })).filter((x) => x.hd).map(days)
    .filter((x) => x.days <= 0 && x.days >= -14).sort((a, b) => b.days - a.days);
  const weddings = state.couples.filter((c) => c.b && !c.apart).map((c) => ({ kind: 'wedding', c, hd: weddingDay(c) })).filter((x) => x.hd).map(days);
  const married = weddings.filter((x) => x.days < 0 && x.days >= -7).sort((a, b) => b.days - a.days);
  const next = weddings.filter((x) => x.days >= 0 && x.c.engaged).sort((a, b) => a.days - b.days).slice(0, 3);
  return [...babies, ...married, ...next];
}

function simchaRow({ kind, p, c, hd, days }) {
  const L = getLang();
  const sex = (x) => (x.sex === 'm' ? 'M' : x.sex === 'f' ? 'F' : '');
  if (kind === 'baby') {
    // "Son of Yitzchak & Rivka Rosenfeld" under the name, and the mazal tov goes to the parents.
    const parents = p.parents && couple(p.parents);
    return upRow({ hd, days, emoji: '👶', title: parents ? full(p) : named(p), sub: parents ? t(`quizChild${sex(p)}`, L, pairName(parents, L)) : t('newBaby'),
      link: p.id, face: avatar(p, 'sm', { camera: false }), who: parents ? [person(parents.a), person(parents.b)] : [], msg: t(`mazalTovBaby${sex(p)}`, L) });
  }
  // A wedding: the venue beside it when it's filled in, and a mazal tov to whichever of them has a mobile.
  return upRow({ hd, days, emoji: '💍', title: coupleName(c), sub: [t(days < 0 ? 'justMarried' : 'wedding'), c.venue].filter(Boolean).join(' · '),
    link: person(c.a).id, face: pair(c), who: [person(c.a), person(c.b)], msg: t(days > 0 ? 'mazalTovEngaged' : 'mazalTovWedding', L) });
}

/** A birthday that is a milestone: a bar mitzvah (a boy turning 13), a bas mitzvah (a girl turning
 *  12) or an upsherin (a boy turning 3). These stand out in "coming up". */
const MILESTONE = { bar: ['✨', 'barMitzvah', 'mazalTovBarMitzvah'], bas: ['✨', 'basMitzvah', 'mazalTovBasMitzvah'], upsherin: ['✂️', 'upsherin', 'mazalTovUpsherin'] };
const milestoneOf = (entry, years) => (entry.kind !== 'birthday' ? null
  : entry.p.sex === 'm' ? (years === 13 ? 'bar' : years === 3 ? 'upsherin' : null)
  : entry.p.sex === 'f' && years === 12 ? 'bas' : null);

function upcomingRow({ entry, hd, days, years }) {
  const L = getLang();
  const big = MILESTONE[milestoneOf(entry, years)];
  const [emoji, title, sub, link, face] = entry.kind === 'anniversary'
    ? ['💍', coupleName(entry.c), years ? t('yearsMarried', L, years) : t('anniversary'), person(entry.c.a).id, pair(entry.c)]
    : entry.kind === 'yahrzeit'
      ? ['🕯️', withZl(entry.p, named(entry.p)), years ? t('yahrzeitN', L, years) : t('yahrzeit'), entry.p.id, avatar(entry.p, 'sm', { camera: false })]
      : big ? [big[0], named(entry.p), t(big[1], L), entry.p.id, avatar(entry.p, 'sm', { camera: false })]
      : ['🎂', named(entry.p), years ? t('turns', L, years) : t('birthday'), entry.p.id, avatar(entry.p, 'sm', { camera: false })];
  // A WhatsApp button to say מזל טוב, for a birthday or an anniversary of someone reachable on WhatsApp
  // (for a couple, whichever of them has a phone). Not for a yahrzeit.
  const who = entry.kind === 'birthday' ? [entry.p] : entry.kind === 'anniversary' ? [person(entry.c.a), person(entry.c.b)] : [];
  const msg = t(entry.kind === 'anniversary' ? 'mazalTovAnniversary' : big ? big[2] : 'mazalTovBirthday', L);
  // Whose they are has a small line of its own under the name (son of Yaakov son of Meir), and what it is the line
  // after; the name above then needs no tag of its own. For a couple: whose the one of them who is of the family is.
  const of = entry.kind === 'anniversary' ? [person(entry.c.a), person(entry.c.b)].find((x) => x?.parents) : entry.p;
  const where = of ? whose(of, L) : '';
  return upRow({ hd, days, emoji, title: where && entry.kind !== 'anniversary' ? (entry.kind === 'yahrzeit' ? withZl(entry.p, full(entry.p)) : full(entry.p)) : title, sub, link, face, who, msg, big, where });
}

/** One row of "coming up" or "Mazal tov": when (in 3 days, today, 5 days ago) over the Hebrew date,
 *  the face, the name over what it is, and a WhatsApp button to the first of `who` with a mobile. */
function upRow({ hd, days, emoji, title, sub, link, face, who = [], msg, big, where = '' }) {
  const L = getLang();
  const when = days === 0 ? t('today') : days === 1 ? t('tomorrow') : days === -1 ? t('yesterday') : days > 0 ? t('inDays', L, days) : t('daysAgo', L, -days);
  const date = formatDate({ h_day: hd.getDate(), h_month: hd.getMonth() }, L);
  const wa = who.filter((x) => x && !x.deceased).map((x) => waNumber(x.phone)).find(Boolean);
  return `<div class="up-item${wa ? ' has-wa' : ''}"><a class="up-row ${days === 0 ? 'today' : ''} ${big ? 'mitzvah' : ''}" href="#/person/${link}">
    <span class="up-when"><span class="up-day">${esc(when)}</span><span class="up-date he">${esc(date)}</span></span>
    ${face}
    <span class="person-text"><span class="title he">${esc(title)}</span>${where ? `<span class="sub whose"><bdi>${esc(where)}</bdi></span>` : ''}<span class="sub"><span aria-hidden="true">${emoji}</span> ${esc(sub)}</span></span>
  </a>${wa ? `<a class="wa" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" aria-label="${esc(t('whatsappMazalTov'))}" title="${esc(t('whatsappMazalTov'))}">${ICON.whatsapp}</a>` : ''}</div>`;
}

// ---------- what's new in the app (news.js) ----------

/** The posts for this site, newest first. */
const newsHere = () => NEWS.filter((n) => !n.only || (n.only === 'chart' ? hasChart() : n.only.includes(FAMILY.key)));
const newsFresh = (n) => Date.now() - new Date(`${n.date}T00:00:00`) < 7 * 864e5;
function newsPage() {
  const L = getLang(), posts = newsHere();
  const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(L === 'he' ? 'he-IL' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  return hero({
    left: backBtn(),
    body: `<div class="home-head"><h1 class="hello">${t('newsTitle')}</h1></div>`,
  }) + `<main class="content">
    ${posts.map((n) => `<article class="card pad news-post">
      <p class="news-date">${esc(day(n.date))}${newsFresh(n) ? `<span class="chip lilac">${t('newsNew')}</span>` : ''}</p>
      <h2>${esc(n[L][0])}</h2><p>${esc(n[L][1]).replace(/\[(.+?)\]\((#\/[\w/-]*)\)/g, '<a class="news-link" href="$2">$1</a>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])_(.+?)_(?=[\s).,]|$)/g, '$1<i>$2</i>')}</p>
      ${n.href ? `<a class="link" href="${n.href}">${t('newsOpen')} ›</a>` : ''}
    </article>`).join('') || `<p class="empty">${t('newsNone')}</p>`}
  </main>${nav('home')}`;
}

function homePage() {
  const news = newsHere();
  const me = hasMe() ? person(api.me) : null;
  const all = state.people;
  const photos = all.filter((p) => p.photo).length + state.couples.filter((c) => c.photo).length;
  const complete = all.filter((p) => !needs(p).length).length;
  const needy = all.length - complete;
  const ups = comingUp();
  const joys = simchas();
  const feed = feedItems();
  const week = (state.recent ?? []).filter((e) => Date.now() - new Date(e.at) < 7 * 864e5).length;
  return hero({
    left: brand(),
    body: `<div class="home-head">
      <h1 class="hello">${esc(me ? t('hello', getLang(), first(me)) : t('treeTitle'))}</h1>
      <p class="dim">${esc(week ? t('weekBuzz', getLang(), week) : t('homeSub'))}</p>
      <ul class="stats">
        <li><b>${all.length}</b><span>${t('st_people')}</span></li>
        <li><b>${photos}</b><span>${t('st_photos')}</span></li>
        <li><b>${all.filter((p) => p.h_day).length}</b><span>${t('st_birthdays')}</span></li>
      </ul>
    </div>`,
  }) + `<main class="content">
    ${joys.length ? `<div class="sec-head"><h2>${t('mazalTovSec')}</h2></div>
    <div class="card list simchas">${joys.map(simchaRow).join('')}</div>` : ''}

    <div class="sec-head"><h2>${t('comingUp')}</h2><button type="button" class="cal-btn" data-act="calendar">${ICON.events}<span>${t('calButton')}</span></button></div>
    ${ups.length ? `<div class="card list">${ups.map(upcomingRow).join('')}</div>` : `<p class="empty">${t('nothingSoon')}</p>`}

    ${news[0] && newsFresh(news[0]) ? `<a class="card pad nudge" href="#/news"><span class="nudge-icon" aria-hidden="true">✨</span>
      <span class="person-text"><span class="title">${t('newsCard')}</span><span class="sub">${esc(news[0][getLang()][0])}</span></span>
      <span class="chip lilac">${t('newsGo')}</span></a>` : ''}

    ${needy ? `<a class="card pad nudge" href="#/family"><span class="nudge-icon" aria-hidden="true">🏆</span>
      <span class="person-text"><span class="title">${t('nudgeTitle', getLang(), needy)}</span><span class="sub">${t('nudgeSub')}</span></span>
      <span class="chip pink">${t('nudgeGo')}</span></a>` : ''}

    ${photos >= 4 ? `<a class="card pad nudge" href="#/quiz/who"><span class="nudge-icon" aria-hidden="true">🎯</span>
      <span class="person-text"><span class="title">${t('quizCard')}</span><span class="sub">${t('quizCardSub')}</span></span>
      <span class="chip lilac">${t('quizGo')}</span></a>` : ''}

    <div class="sec-head"><h2>${t('whatsNew')}</h2></div>
    ${feed.length ? `<div class="card list">${feed.map(feedRow).join('')}</div>` : `<p class="empty">${t('noNews')}</p>`}
    ${news.length ? `<div class="profile-foot"><a class="escape quiet" href="#/news">${t('newsTitle')}</a></div>` : ''}
    ${localNote()}
  </main>${nav('home')}`;
}

// ---------- the calendar feed ----------

// A link people add to their own calendar (Google, iPhone, Outlook) for a family's birthdays,
// anniversaries and yahrzeits (functions/calendar.mjs). They choose whose: their close family, or the
// family of a couple further up, up to the top couple; and the language of the names.

/** The families to choose from, closest first, as { c, label }. Close family is your own couple and
 *  everyone below you; without children of your own, your parents' family. Then each couple above
 *  you (on your husband's or wife's side when you married in), ending at the top couple. Signed out:
 *  the top couple's family and each of their children's. */
function calRows() {
  const L = getLang();
  const root = rootCouple();
  if (!root) return [];
  const everyone = (c) => ({ c, label: t('calEveryone', L, coupleName(c, L)) });
  const me = hasMe() && person(api.me);
  if (!me) return [everyone(root), ...childCouples(root.id).map((c) => ({ c, label: t('calOf', L, coupleName(c, L)) }))];
  // The couples up the line, with how many steps up from you each is (your own couple is 0).
  const bornIn = (p) => p?.parents && couple(p.parents);
  const chain = [];
  const mine = coupleOf(me.id);
  if (mine && !mine.apart) chain.push({ c: mine, up: 0 });
  const ownLine = Boolean(bornIn(me));
  let cur = ownLine ? me : spouseOf(me.id);
  for (let up = 1; bornIn(cur) && up < 12; up++) {
    const c = bornIn(cur);
    chain.push({ c, up });
    cur = [person(c.a), person(c.b)].find(bornIn) ?? null;
  }
  // Close family: your own couple when you have children, else the next one up.
  const hasKids = (c) => state.people.some((k) => k.parents === c.id);
  if (chain.length > 1 && chain[0].up === 0 && !hasKids(chain[0].c)) chain.shift();
  return chain.map(({ c, up }, i) => (c.root ? everyone(c)
    : i === 0 ? { c, label: t('calClose', L) }
    : { c, label: ownLine && up <= 3 ? `${t(`calUp${up}`, L)} · ${coupleName(c, L)}` : t('calOf', L, coupleName(c, L)) }));
}

function calendarSheet() {
  const dlg = $('#sheet');
  const L = getLang();
  const rows = calRows();
  if (!rows.length) return;
  const me = hasMe() ? api.me : null;
  const count = (c) => feedEntries(state.people, state.couples, c.id, me).length;
  dlg.innerHTML = `<form method="dialog" class="sheet-form quiz-settings cal-sheet"><h2>${t('calTitle')}</h2>
    <fieldset><legend>${t('calWhose')} <details class="cal-info"><summary aria-label="${esc(t('calInfoLabel'))}">ⓘ</summary><p>${esc(t('calInfo'))}</p></details></legend>
      ${rows.map((r, i) => `<label class="chk"><input type="radio" name="fam" value="${r.c.id}" ${i === 0 ? 'checked' : ''} /> <span>${esc(r.label)}</span> <span class="n">${esc(t('calDates', L, count(r.c)))}</span></label>`).join('')}
    </fieldset>
    <fieldset class="cal-lang"><legend>${t('calLang')}</legend>
      <label class="chk"><input type="radio" name="lang" value="he" ${L === 'he' ? 'checked' : ''} /> עברית</label>
      <label class="chk"><input type="radio" name="lang" value="en" ${L === 'en' ? 'checked' : ''} /> English</label>
    </fieldset>
    <div class="cal-links">
      <a class="cta small" data-cal="add" href="#" aria-disabled="true">${t('calAdd')}</a>
      <button type="button" class="chip lilac" data-cal="copy" disabled>${t('calCopy')}</button>
    </div>
    <details class="cal-help"><summary>${t('calGoogle')}</summary><ol>${t('calGoogleSteps').map((s) => `<li>${esc(s)}</li>`).join('')}</ol><p>${esc(t('calIphone'))}</p></details>
    <div class="actions"><button type="button" class="link" data-sheet="done">${t('quizDone')}</button></div></form>`;
  const f = dlg.querySelector('form');
  const add = f.querySelector('[data-cal="add"]'), copy = f.querySelector('[data-cal="copy"]');
  let url = null, asked = 0;
  // A new link each time the choice changes (the server signs it).
  const make = async () => {
    const n = ++asked;
    url = null;
    add.setAttribute('aria-disabled', 'true');
    copy.disabled = true;
    try {
      const got = await api.calendarLink(f.fam.value, me, f.lang.value);
      if (n !== asked) return;
      url = got;
      // webcal:// opens the calendar app straight away (iPhone, Mac, Outlook) and subscribes.
      add.href = url.replace(/^https?:/, 'webcal:');
      add.removeAttribute('aria-disabled');
      copy.disabled = false;
    } catch (err) { if (n === asked) alert(err.message); }
  };
  f.addEventListener('change', make);
  add.addEventListener('click', (ev) => { if (!url) ev.preventDefault(); });
  copy.addEventListener('click', async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); } catch { prompt(t('calCopy'), url); return; }
    copy.textContent = t('calCopied');
    setTimeout(() => { copy.textContent = t('calCopy'); }, 2000);
  });
  dlg.querySelector('[data-sheet="done"]').addEventListener('click', () => dlg.close());
  dlg.showModal();
  make();
}

// ---------- quiz: who is this? ----------

// One photo, four names; the wrong names are other people in the tree (never a namesake of the right
// answer). Who comes up when goes by what you've learned (progress.js): the ones you're learning
// often, the ones you know further apart. `recent`: the last ones asked, which wait a few questions;
// `practice`: "Keep practicing" when nothing is due.
const quiz = { q: null, right: 0, total: 0, streak: 0, recent: [], practice: false, none: null, mine: localStorage.getItem('tree.quiz.mine') === '1',
  sameSex: localStorage.getItem('tree.quiz.sameSex') === '1',
  // The advanced way: no names to pick from. Think of the name, reveal it, and say whether you had it.
  recall: localStorage.getItem('tree.quiz.recall') === '1',
  // Generations left out of the quiz (1 = the top couple's children, 2 = grandchildren, …).
  gensOff: new Set((() => { try { return JSON.parse(localStorage.getItem('tree.quiz.gensOff')) ?? []; } catch { return []; } })()),
  // What it asks: 'name' (a photo, four names), 'face' (a name, four photos: "find the face"), or
  // 'both', mixed (the start). Each is remembered on its own (keys `<id>` and `face:<id>`).
  mode: (() => { try { return localStorage.getItem('tree.quiz.mode') ?? 'both'; } catch { return 'both'; } })() };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const quizName = (p) => withZl(p, named(p));

/** A couple by first names with the family name once, the husband first: "Yitzchak & Rivka Rosenfeld". */
function pairName(c, l = getLang()) {
  const both = [person(c.a), person(c.b)].filter(Boolean).sort((x, y) => (y.sex === 'm') - (x.sex === 'm'));
  return [both.map((x) => first(x, l)).join(' & '), both[0] && last(both[0], l)].filter(Boolean).join(' ');
}
/** Someone's birthday for the line after a quiz answer: "Born 2 Tishrei 5780 (7 years old)"; without
 *  the age for someone who has passed away; "Birthday: 2 Tishrei" without a year; '' without a date. */
function bornLine(p, l = getLang()) {
  if (!p.h_day || !p.h_month) return '';
  if (!p.h_year) return t('bdayOn', l, formatDate(p, l));
  const n = p.deceased ? null : yearsSince(p.h_day, p.h_month, p.h_year);
  return t('bdayBorn', l, formatDate(p, l)) + (n != null ? ` (${t(`ageIs${{ f: 'F', m: 'M' }[sexOf(p)] ?? ''}`, l, n)})` : '');
}

/** Where someone sits in the tree, a line or two shown after a quiz answer: whose child (and grandchild)
 *  they are when born into the family; whose husband or wife (and son- or daughter-in-law) when
 *  married in. Nothing for the couple at the top. */
function quizWhere(p, l = getLang()) {
  const kin = (key) => `quiz${key}${p.sex === 'm' ? 'M' : p.sex === 'f' ? 'F' : ''}`;
  const c = p.parents && couple(p.parents);
  if (c) {
    const parts = [t(kin('Child'), l, pairName(c, l))];
    // The grandparents on the family's side: the parent who was born into the tree, else the father.
    const side = !c.root && [person(c.a), person(c.b)].filter(Boolean).sort((x, y) => (y.sex === 'm') - (x.sex === 'm')).find((x) => x.parents && couple(x.parents));
    if (side) parts.push(t(kin('Grandchild'), l, pairName(couple(side.parents), l)));
    return parts;
  }
  const mc = coupleOf(p.id), sp = spouseOf(p.id);
  if (!mc || mc.root || mc.apart || !sp) return [];
  const parts = [t(isEngaged(mc) ? 'quizEngaged' : kin('Spouse'), l, full(sp, l))];
  const inLaws = sp.parents && couple(sp.parents);
  if (inLaws && !isEngaged(mc)) parts.push(t(kin('InLaw'), l, pairName(inLaws, l)));   // not an in-law until the wedding
  return parts;
}

/** The child of the top couple whose branch you belong to, when the quiz is set to "my branch". */
function quizBranch() {
  if (!quiz.mine || !hasMe()) return null;
  const me = person(api.me);
  return me ? branchOf(me) : null;
}

/** The sex of whoever is signed in, for "show only boys / girls" (off until someone ticks it). */
const mySex = () => (hasMe() && person(api.me)?.sex) || null;
/** Which generation someone is in the quiz: 1 = the top couple's children (with their husbands and
 *  wives), 2 = the grandchildren, and so on. Someone who married in counts with their spouse. The
 *  top couple themselves are 0: always in the quiz, in no generation's row or count. */
const quizGen = (p) => (p.parents && couple(p.parents) ? generation(p) : generation(spouseOf(p.id) ?? p));
const genLabel = (n, l = getLang()) => (n <= 4 ? t(`quizGen${n}`, l) : t('quizGenN', l, n));

/** Who the quiz draws from: everyone, or (within a branch) the branch head, their spouse, and
 *  everyone descended from or married into it; only your own sex while that box is ticked. */
function quizPeople() {
  return quizBase().filter((p) => !(quiz.gensOff.size && quiz.gensOff.has(quizGen(p))));
}
/** The same before the generations are chosen: the branch, and only your own sex if that's ticked. */
function quizBase() {
  const branch = quizBranch();
  // The games leave out those who have passed away, as questions and as answers.
  const living = state.people.filter((p) => !p.deceased);
  const people = branch ? living.filter((p) => p.id === branch.id || branchOf(p)?.id === branch.id) : living;
  const sex = quiz.sameSex && mySex();
  return sex ? people.filter((p) => p.sex === sex) : people;
}
/** How many people each generation has as the quiz is set now (its branch, only boys or girls), with
 *  or without a photo: those born into it, and the husbands and wives who married in, as
 *  "49 + 47 spouses". Only the ones with a photo come up in the quiz; the numbers are the family's. */
function quizGenCounts() {
  const counts = {};
  for (const p of quizBase()) {
    const g = quizGen(p);
    if (!g) continue;
    const c = (counts[g] ??= { born: 0, spouses: 0 });
    if (p.parents && couple(p.parents)) c.born++; else c.spouses++;
  }
  return counts;
}
const genCount = (c, l = getLang()) => (!c ? '0' : c.spouses ? `${c.born} ${t('quizSpouses', l, c.spouses)}` : `${c.born}`);

/** The quiz's settings, behind the gear: the advanced way (no choices), only your own sex, and which
 *  generations are in it. */
function quizSettings() {
  const dlg = $('#sheet');
  const L = getLang();
  const sex = mySex();
  const root = rootCouple();
  // Every generation that has photos gets a row; its numbers are everyone in it as the quiz is set now.
  const gens = [...new Set(state.people.filter((p) => p.photo).map(quizGen))].filter(Boolean).sort((a, b) => a - b);
  const counts = quizGenCounts();
  dlg.innerHTML = `<form method="dialog" class="sheet-form quiz-settings"><h2>${t('quizSettings')}</h2>
    ${FAMILY.games?.includes('face') ? `<fieldset class="inline"><legend>${t('bdayAskWhat')}</legend>
      ${['both', 'name', 'face'].map((m) => `<label class="chk"><input type="radio" name="mode" value="${m}" ${quiz.mode === m ? 'checked' : ''} /> ${t(`quizMode_${m}`)}</label>`).join('')}
    </fieldset>` : ''}
    <label class="chk"><input type="checkbox" name="recall" ${quiz.recall ? 'checked' : ''} /> ${t('quizRecall')}</label>
    ${sex ? `<label class="chk"><input type="checkbox" name="sameSex" ${quiz.sameSex ? 'checked' : ''} /> ${t(sex === 'm' ? 'quizOnlyMale' : 'quizOnlyFemale')}</label>` : ''}
    ${gens.length > 1 ? `<fieldset><legend>${t('quizGens')}</legend>
      ${root ? `<p>${esc(t('quizGensHint', L, coupleName(root, L)))}</p>` : ''}
      ${gens.map((g) => `<label class="chk"><input type="checkbox" name="gen" value="${g}" ${quiz.gensOff.has(g) ? '' : 'checked'} /> ${esc(genLabel(g, L))} <span class="n" data-gen="${g}">${esc(genCount(counts[g], L))}</span></label>`).join('')}
    </fieldset>` : ''}
    <div class="actions"><button type="button" class="cta small" data-sheet="done">${t('quizDone')}</button></div></form>`;
  const f = dlg.querySelector('form');
  const boxes = [...f.querySelectorAll('[name="gen"]')];
  // At least one generation stays in: the last ticked box can't be unticked.
  const lock = () => { const on = boxes.filter((b) => b.checked); boxes.forEach((b) => { b.disabled = on.length === 1 && b.checked; }); };
  lock();
  f.addEventListener('change', () => {
    quiz.recall = f.recall.checked;
    localStorage.setItem('tree.quiz.recall', quiz.recall ? '1' : '0');
    if (f.mode) quiz.mode = f.mode.value;
    localStorage.setItem('tree.quiz.mode', quiz.mode);
    if (f.sameSex) { quiz.sameSex = f.sameSex.checked; localStorage.setItem('tree.quiz.sameSex', quiz.sameSex ? '1' : '0'); }
    quiz.gensOff = new Set(boxes.filter((b) => !b.checked).map((b) => Number(b.value)));
    localStorage.setItem('tree.quiz.gensOff', JSON.stringify([...quiz.gensOff]));
    lock();
    // Only boys or only girls changes how many each generation has.
    const now = quizGenCounts();
    f.querySelectorAll('[data-gen]').forEach((n) => { n.textContent = genCount(now[n.dataset.gen], L); });
  });
  const apply = () => { nextQuestion(); render(); };
  dlg.querySelector('[data-sheet="done"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', apply, { once: true });
  dlg.showModal();
}

function nextQuestion() {
  const people = quizPeople();
  const pool = people.filter((p) => p.photo);
  if (!pool.length || people.length < 4) { quiz.q = null; quiz.none = 'empty'; return; }
  const next = pickNext('who', whoQuestions(pool), quiz.recent, quiz.practice);
  if (!next.pick) { quiz.q = null; quiz.none = next.none; return; }
  quiz.none = null;
  const { p, ask, key } = next.pick;
  if (ask === 'face') {
    // Find the face: three other photos, of the same sex, from the branch and generation first.
    const inBranch = new Set(people.map((x) => x.id));
    const rest = state.people.filter((x) => x.photo && !x.deceased && x.id !== p.id && (!sexOf(p) || !sexOf(x) || sexOf(x) === sexOf(p)));
    const tier = (x) => (sexOf(x) === sexOf(p) ? 0 : 4) + (inBranch.has(x.id) ? 0 : 2) + (quizGen(x) === quizGen(p) ? 0 : 1);
    quiz.q = { p, ask, key, options: shuffle([p, ...shuffle(rest).sort((a, b) => tier(a) - tier(b)).slice(0, 3)]), answer: null };
    return;
  }
  // Wrong names are of the same sex (mixing men and women would give the answer away); people
  // whose sex isn't recorded fill in only when there aren't enough, and the other sex never does.
  // A small branch may not have three such people: then the rest of the family fills in.
  const names = new Set([quizName(p)]);
  const decoys = [];
  const inBranch = new Set(people.map((x) => x.id));
  const rest = state.people.filter((x) => x.id !== p.id && !x.deceased && (!p.sex || !x.sex || x.sex === p.sex));
  const tier = (x) => (x.sex === p.sex ? 0 : 2) + (inBranch.has(x.id) ? 0 : 1);
  for (const x of shuffle(rest).sort((a, b) => tier(a) - tier(b))) {
    if (names.has(quizName(x))) continue;
    names.add(quizName(x));
    decoys.push(x);
    if (decoys.length === 3) break;
  }
  quiz.q = { p, ask, key, pic: quizPic(p), options: shuffle([p, ...decoys]), answer: null };
}

/** "Who's this?" questions as the gear is set: photo → name (keyed by the person's id, as before
 *  there were two kinds), and/or name → photo (`face:<id>`). */
const whoQuestions = (pool) => { const mode = whoMode(); return pool.flatMap((p) => [
  ...(mode !== 'face' ? [{ key: p.id, p, ask: 'name' }] : []),
  ...(mode !== 'name' ? [{ key: `face:${p.id}`, p, ask: 'face' }] : []),
]); };
/** Find the Face is new, so only on a site that has it (FAMILY.games 'face'); elsewhere, photo → name. */
const whoMode = () => (FAMILY.games?.includes('face') ? quiz.mode : 'name');

/** A game with nothing to ask right now: everyone known, or nothing due today. "Keep practicing"
 *  asks the shakiest ones anyway (`act` turns that on for the game). */
const restCard = (msg, act) => `<div class="card pad quiz"><p class="quiz-result ok">${msg}</p><div class="quiz-actions"><button type="button" class="cta small" data-act="${act}">${t('keepPracticing')}</button></div></div>`;


/** Someone with gallery pictures as well is shown one of their pictures at random, the profile
 *  photo included. A gallery picture is whole (not a face crop), so it's shown uncropped. */
function quizPic(p) {
  const pics = [{ src: p.photo }, ...galleryOf(p.id).map((g) => ({ src: g.url, wide: true }))];
  return pics[Math.floor(Math.random() * pics.length)];
}

function quizPage() {
  if (!quiz.q) nextQuestion();
  const q = quiz.q;
  const L = getLang();
  const people = quizPeople();
  const head = hero({ left: quizLeft(), gear: 'quiz-settings', body: `<div class="home-head"><h1 class="hello">${t('quizTitle')}</h1><p class="dim">${t('quizSub')}</p></div>` });
  const mine = hasMe() && branchOf(person(api.me));
  const toggle = mine ? `<div class="seg quiz-scope" role="radiogroup" aria-label="${t('quizScope')}">
      <label><input type="radio" name="scope" value="all" ${quiz.mine ? '' : 'checked'} data-act="quiz-scope" /><span>${t('quizAll')}</span></label>
      <label><input type="radio" name="scope" value="mine" ${quiz.mine ? 'checked' : ''} data-act="quiz-scope" /><span>${esc(t('quizMine', L, first(mine)))}</span></label>
    </div>` : '';
  // The gear for the settings sits at the end of the tabs' row; with no tabs, in the card's corner.
  const bar = `<div class="quiz-bar">${toggle}</div>`;
  // What's switched on there, in a few words after the score: "(boys & men only, 2 generations)".
  const sex = quiz.sameSex && mySex();
  const gensIn = quiz.gensOff.size ? [...new Set(state.people.filter((p) => p.photo).map(quizGen))].filter((g) => g && !quiz.gensOff.has(g)) : [];
  const only = [sex && t(sex === 'm' ? 'quizMaleOnly' : 'quizFemaleOnly'), gensIn.length === 1 ? t('quizOnly', L, genLabel(gensIn[0], L)) : gensIn.length ? t('quizNGens', L, gensIn.length) : ''].filter(Boolean).join(', ');
  if (!q) {
    const msg = quiz.none === 'empty' ? `<p class="empty">${t('quizNoPhotos')}</p>`
      : restCard(t(quiz.none === 'allKnown' ? 'quizAllKnown' : 'caughtUp'), 'quiz-practice');
    return `${head}<main class="content">${bar}${msg}</main>${nav('quiz')}`;
  }
  const qs = whoQuestions(people.filter((x) => x.photo));
  const known = qs.filter((x) => isKnown('who', x.key)).length;
  const withPhoto = qs.length;
  const done = q.answer != null;
  const ok = done && q.answer === q.p.id;
  const cls = (o) => (!done ? '' : o.id === q.p.id ? 'ok' : o.id === q.answer ? 'bad' : '');
  // After any answer, where the person sits in the tree. It says whose child they are, so the name
  // beside it goes without its "(daughter of …)" tag.
  // Each part on its own line (the birthday and age, then parents, then grandparents), starting with a capital.
  const where = done || q.revealed ? [bornLine(q.p), ...quizWhere(q.p)].filter(Boolean).map((x) => `<span>${esc(x.charAt(0).toUpperCase() + x.slice(1))}</span>`).join('') : '';
  return `${head}<main class="content">
    ${toggle ? bar : ''}
    <div class="card pad quiz">
      <p class="quiz-score">${esc(t('quizScore', L, quiz.right, quiz.total))}${quiz.streak >= 3 ? ` · ${esc(t('quizStreak', L, quiz.streak))}` : ''} · ${esc(t('quizKnown', L, known, withPhoto))}${only ? ` <span class="quiz-only">(${esc(only)})</span>` : ''}</p>
      ${q.ask === 'face' ? faceBody(q, where) : `<div class="quiz-photo${q.pic.wide ? ' wide' : ''}"><img src="${esc(q.pic.src)}" alt="" /></div>
      ${quiz.recall ? (q.revealed
        // The advanced way, after the reveal: the name and where they sit, then you mark yourself
        // (which goes straight on to the next photo).
        ? `<p class="quiz-name he">${esc(where ? withZl(q.p, full(q.p)) : quizName(q.p))}</p>
      ${where ? `<p class="quiz-where">${where}</p>` : ''}
      <p class="quiz-ask">${t('quizDidKnow')}</p>
      <div class="quiz-opts two">
        <button type="button" class="quiz-opt ok" data-act="quiz-answer" data-id="${q.p.id}">${t('quizKnew')}</button>
        <button type="button" class="quiz-opt bad" data-act="quiz-answer" data-id="x">${t('quizMissed')}</button>
      </div>
      <div class="quiz-actions"><a class="chip lilac" href="#/person/${q.p.id}">${t('openProfile')}</a></div>`
        : `<p class="quiz-ask">${t('quizThink')}</p>
      <button type="button" class="cta" data-act="quiz-reveal" autofocus>${t('quizReveal')}</button>`)
      : `<div class="quiz-opts">
        ${q.options.map((o) => `<button type="button" class="quiz-opt ${cls(o)}" data-act="quiz-answer" data-id="${o.id}" ${done ? 'disabled' : ''}><span class="he">${esc(quizName(o))}</span></button>`).join('')}
      </div>
      ${done ? `<p class="quiz-result ${ok ? 'ok' : 'bad'}">${esc(ok ? t('quizRight') : t('quizWrong', L, where ? withZl(q.p, full(q.p)) : quizName(q.p)))}</p>
      ${where ? `<p class="quiz-where">${where}</p>` : ''}
      <div class="quiz-actions">
        <a class="chip lilac" href="#/person/${q.p.id}">${t('openProfile')}</a>
        <button type="button" class="cta small" data-act="quiz-next" autofocus>${t('quizNext')}</button>
      </div>` : ''}`}`}
    </div>
  </main>${nav('quiz')}`;
}

/** Find the face: the name, and four photos to pick from (their names show once answered); or the
 *  advanced way: picture the face, reveal the photo, and mark yourself. `where` is the lines shown
 *  after an answer. */
function faceBody(q, where) {
  const L = getLang();
  const done = q.answer != null;
  const ok = done && q.answer === q.p.id;
  const cls = (o) => (!done ? '' : o.id === q.p.id ? 'ok' : o.id === q.answer ? 'bad' : '');
  const name = `<p class="quiz-name he">${esc(quizName(q.p))}</p>`;
  if (quiz.recall) {
    return q.revealed
      ? `${name}<div class="quiz-photo"><img src="${esc(q.p.photo)}" alt="" /></div>
      ${where ? `<p class="quiz-where">${where}</p>` : ''}
      <p class="quiz-ask">${t('quizDidKnow')}</p>
      <div class="quiz-opts two">
        <button type="button" class="quiz-opt ok" data-act="quiz-answer" data-id="${q.p.id}">${t('quizKnew')}</button>
        <button type="button" class="quiz-opt bad" data-act="quiz-answer" data-id="x">${t('quizMissed')}</button>
      </div>`
      : `${name}<p class="quiz-ask">${t('faceThink')}</p>
      <button type="button" class="cta" data-act="quiz-reveal" autofocus>${t('faceReveal')}</button>`;
  }
  return `${name}<p class="quiz-ask">${t('faceAsk')}</p>
      <div class="quiz-opts faces">
        ${q.options.map((o) => `<button type="button" class="quiz-opt with-face ${cls(o)}" data-act="quiz-answer" data-id="${o.id}" ${done ? 'disabled' : ''}>${avatar(o, 'sm', { camera: false })}${done ? `<span class="he">${esc(quizName(o))}</span>` : ''}</button>`).join('')}
      </div>
      ${done ? `<p class="quiz-result ${ok ? 'ok' : 'bad'}">${esc(ok ? t('quizRight') : t('faceWrong'))}</p>
      ${where ? `<p class="quiz-where">${where}</p>` : ''}
      <div class="quiz-actions">
        <a class="chip lilac" href="#/person/${q.p.id}">${t('openProfile')}</a>
        <button type="button" class="cta small" data-act="quiz-next" autofocus>${t('quizNext')}</button>
      </div>` : ''}`;
}

// ---------- the quiz's games ----------

/** Everyone descended from someone, with how far down (1 = their children, 2 = grandchildren, …),
 *  through every marriage they had. */
function descendantsOf(id) {
  const out = [], seen = new Set([id]);
  const kids = new Map();   // couple id → its children
  for (const k of state.people) if (k.parents) (kids.get(k.parents) ?? kids.set(k.parents, []).get(k.parents)).push(k);
  const walk = (pid, depth) => {
    if (depth > 8) return;
    for (const c of state.couples) {
      if (c.a !== pid && c.b !== pid) continue;
      for (const k of kids.get(c.id) ?? []) {
        if (seen.has(k.id)) continue;
        seen.add(k.id);
        out.push({ p: k, depth });
        walk(k.id, depth + 1);
      }
    }
  };
  walk(id, 1);
  return out;
}

/** The games someone can play here: "Who's this?" always; the birthday game on a site that has it
 *  (FAMILY.games), for someone signed in with relatives who have a photo and a birthday. */
function quizGames() {
  const games = ['who'];
  if (FAMILY.games?.includes('birthdays') && bdayItems().length) games.push('birthdays');
  if (FAMILY.games?.includes('family') && famCouples().length) games.push('family');
  if (FAMILY.games?.includes('kids') && kidsAll().length) games.push('kids');
  if (FAMILY.games?.includes('inlaws') && inlawAll().length) games.push('inlaws');
  return games;
}
const GAMES = { who: ['🎯', 'nav_quiz', 'quizCardSub'], birthdays: ['🎂', 'bdayTitle', 'bdayCardSub'],
  family: ['🏠', 'famTitle', 'famCardSub'], kids: ['👨‍👩‍👧', 'kidsTitle', 'kidsCardSub'], inlaws: ['💍', 'inlawTitle', 'inlawCardSub'] };

/** #/quiz: the list of games when there is more than one, else straight into "Who's this?". */
function quizScreen(id) {
  const games = quizGames();
  if (id === 'birthdays' && games.includes('birthdays')) return bdayPage();
  if (id === 'inlaws' && games.includes('inlaws')) return inlawPage();
  if (id === 'kids' && games.includes('kids')) return kidsPage();
  if (id === 'family' && games.includes('family')) return famPage();
  if (id === 'who' || games.length === 1) return quizPage();
  return gamesPage(games);
}
/** In a game, when there is a list of games: the way back to it, where the family's name would be. */
const quizLeft = () => (quizGames().length > 1
  ? `<a class="back" href="#/quiz"><span class="iconbtn">${ICON.back}</span><span>${t('allGames')}</span></a>` : brand());

function gamesPage(games) {
  const head = hero({ left: brand(), body: `<div class="home-head"><h1 class="hello">${t('gamesTitle')}</h1><p class="dim">${t('quizSub')}</p></div>` });
  return `${head}<main class="content">
    ${games.map((g) => { const [emoji, title, sub] = GAMES[g]; return `<a class="card pad nudge" href="#/quiz/${g}"><span class="nudge-icon game-art" aria-hidden="true">${GAME_ART[g] ?? emoji}</span>
      <span class="person-text"><span class="title">${t(title)}</span><span class="sub">${t(sub)}</span></span>
      <span class="chip lilac">${t('quizGo')}</span></a>`; }).join('')}
  </main>${nav('quiz')}`;
}

// ---------- the birthday game ----------

// A photo of someone close to you: when is their birthday? Or of a couple: when is their
// anniversary? Four Hebrew dates (day and month) to pick from, or the advanced way (think & reveal),
// the same setting as in "Who's this?". Who comes up goes by levels, closest first, chosen in the
// gear; when you know everyone in them, the game offers the next level. Its score and what it
// remembers are its own.

/** Everyone in the tree, each at the level they come up in for someone (each level adds to the ones
 *  before it):
 *  1 = the dates it's embarrassing not to know: husband or wife; children and everyone below them,
 *      with their husbands and wives; parents and parents-in-law; brothers and sisters; grandparents.
 *  2 = brothers- and sisters-in-law (the husbands and wives of your brothers and sisters, and your
 *      husband's or wife's brothers and sisters), and the children of all of them.
 *  3 = uncles and aunts, and first cousins, with their husbands and wives.
 *  4 = everyone else in the tree.
 *  Someone who married in gets their husband's or wife's parents and brothers and sisters as in-laws,
 *  so it works the same for them. */
function relativesOf(id) {
  const lv = new Map();
  const put = (p, n) => { if (p && p.id !== id && !(lv.get(p.id) <= n)) lv.set(p.id, n); };
  const withSpouse = (p, n) => { put(p, n); if (p) put(spouseOf(p.id), n); };
  const kids = new Map();   // couple id → its children
  for (const k of state.people) if (k.parents) (kids.get(k.parents) ?? kids.set(k.parents, []).get(k.parents)).push(k);
  const parentsOf = (p) => { const c = p?.parents && couple(p.parents); return c ? [person(c.a), person(c.b)].filter(Boolean) : []; };
  const childrenOf = (p) => state.couples.filter((c) => c.a === p.id || c.b === p.id).flatMap((c) => kids.get(c.id) ?? []);
  const siblingsOf = (p) => (p?.parents ? (kids.get(p.parents) ?? []).filter((x) => x.id !== p.id) : []);
  const me = person(id), sp = spouseOf(id);
  // 1
  put(sp, 1);
  for (const { p } of descendantsOf(id)) withSpouse(p, 1);
  for (const p of [...parentsOf(me), ...parentsOf(sp)]) put(p, 1);
  for (const g of parentsOf(me).flatMap(parentsOf)) put(g, 1);
  for (const s of siblingsOf(me)) put(s, 1);
  // 2 (and the husband's or wife's grandparents)
  for (const g of parentsOf(sp).flatMap(parentsOf)) put(g, 2);
  for (const s of [...siblingsOf(me), ...siblingsOf(sp)]) { withSpouse(s, 2); for (const k of childrenOf(s)) withSpouse(k, 2); }
  // 3
  for (const u of parentsOf(me).flatMap(siblingsOf)) { withSpouse(u, 3); for (const k of childrenOf(u)) withSpouse(k, 3); }
  // 4
  for (const p of state.people) put(p, 4);
  return lv;
}
// Worked out once per screen (render() clears it): the nav and the games list ask too.
const relCache = new Map();
const rels = (id) => { if (!relCache.has(id)) relCache.set(id, relativesOf(id)); return relCache.get(id); };

const bday = { q: null, right: 0, total: 0, streak: 0, recent: [], practice: false, none: null,
  // The levels checked in the gear; the closest only, to start with.
  levels: new Set((() => { try { return JSON.parse(localStorage.getItem('tree.bday.levels')) ?? [1]; } catch { return [1]; } })()),
  // What it asks: 'date' (the birthday or anniversary), 'age' (how old, how many years married), or
  // 'both', mixed (the start). Without a known year, only the date is asked.
  mode: (() => { try { return localStorage.getItem('tree.bday.mode') ?? 'both'; } catch { return 'both'; } })() };
const saveLevels = () => localStorage.setItem('tree.bday.levels', JSON.stringify([...bday.levels]));
/** The right answer to a question: the date's key, or the age as text. */
const bdayRight = (q) => (q.ask === 'age' ? String(q.it.years) : q.ask === 'year' ? String(itemYear(q.it)) : dmKey(q.it.date));
/** The Hebrew year someone was born, or a couple married. */
const itemYear = (it) => (it.p ? it.p.h_year : it.c.w_year);
/** A Hebrew year as the game shows it: תשע״ג (5773 in English). */
const yearName = (y, L = getLang()) => (L === 'he' ? dayName(y % 1000, 'he') : String(y));

/** A date as the game asks it: day and month, with Adar of a regular year as plain Adar. */
const dayMonth = (day, month, year) => ({ h_day: day, h_month: month === 12 && year && !HDate.isLeapYear(year) ? ADAR : month });
// Adar, Adar I and Adar II count as one month when telling dates apart: two of them on the same day
// would be a trick question.
const dmKey = (d) => `${d.h_day}-${[12, 13, ADAR].includes(d.h_month) ? 'adar' : d.h_month}`;
const YEAR_MONTHS = [7, 8, 9, 10, 11, ADAR, 1, 2, 3, 4, 5, 6];   // Tishrei to Elul, with one Adar

/** Everything that can come up for whoever is signed in, each at its level: the birthdays of living
 *  relatives with a photo, and the anniversaries of couples still celebrating one (with a family
 *  photo, or a photo of each). A couple is at the level of the further of the two. */
function bdayItems() {
  if (!hasMe()) return [];
  const lv = rels(api.me);
  const items = [];
  for (const [pid, level] of lv) {
    const p = person(pid);
    if (p && !p.deceased && p.photo && p.h_day && p.h_month) items.push({ key: p.id, level, p, date: dayMonth(p.h_day, p.h_month, p.h_year), years: yearsSince(p.h_day, p.h_month, p.h_year) });
  }
  const mine = coupleOf(api.me);
  for (const c of state.couples) {
    if (!c.b || !c.w_month || !liveAnniversary(c)) continue;
    const a = person(c.a), b = person(c.b);
    if (!(c.photo || (a?.photo && b?.photo))) continue;
    const level = c === mine ? 1 : Math.max(lv.get(c.a) ?? 9, lv.get(c.b) ?? 9);
    if (level <= 4) items.push({ key: `c:${c.id}`, level, c, date: dayMonth(c.w_day, c.w_month, c.w_year), years: yearsSince(c.w_day, c.w_month, c.w_year) });
  }
  return items;
}
const bdayLevels = (items) => [...new Set(items.map((x) => x.level))].sort((a, b) => a - b);

function nextBday() {
  const items = bdayItems();
  // Ticked levels with nobody in them (no photos yet): start from the closest level that has someone.
  if (items.length && !items.some((x) => bday.levels.has(x.level))) { bday.levels = new Set([bdayLevels(items)[0]]); saveLevels(); }
  const pool = bdayQuestions(items.filter((x) => bday.levels.has(x.level)));
  const next = pickNext('bday', pool, bday.recent, bday.practice);
  if (!next.pick) { bday.q = null; bday.none = next.none; return; }
  bday.none = null;
  const { it, ask, key } = next.pick;
  // A couple: their family photo, else a photo of each.
  const pic = it.p ? quizPic(it.p) : it.c.photo ? { src: it.c.photo, wide: true } : { pair: [person(it.c.a).photo, person(it.c.b).photo] };
  if (ask === 'age') { bday.q = { it, ask, key, pic, options: shuffle([it.years, ...wrongAges(it.years)]), answer: null }; return; }
  // The year: wrong ones as far off as the wrong ages would be (a year or two for a child, more for a grown-up).
  if (ask === 'year') { const y = itemYear(it); bday.q = { it, ask, key, pic, options: shuffle([y, ...wrongAges(it.years).map((a) => y - (a - it.years))]), answer: null }; return; }
  // The wrong dates: sometimes another date in the family (one that sounds familiar); the rest close
  // to the right one: the same month a few days off, or the same day a month before or after.
  const right = it.date;
  const keys = new Set([dmKey(right)]);
  const wrong = [];
  const add = (d) => { if (wrong.length < 3 && d.h_day >= 1 && d.h_day <= 29 && !keys.has(dmKey(d))) { keys.add(dmKey(d)); wrong.push(d); } };
  const other = shuffle(items.filter((x) => x.key !== it.key))[0];
  if (other && Math.random() < 0.5) add(other.date);
  const mi = YEAR_MONTHS.indexOf(dmKey(right).endsWith('adar') ? ADAR : right.h_month);
  for (let i = 0; wrong.length < 3 && i < 100; i++) {
    if (Math.random() < 0.6) {
      const off = 2 + Math.floor(Math.random() * 9);
      add({ h_day: right.h_day + (Math.random() < 0.5 ? -off : off), h_month: right.h_month });
    } else {
      add({ h_day: Math.min(right.h_day, 29), h_month: YEAR_MONTHS[(mi + (Math.random() < 0.5 ? 11 : 1)) % 12] });
    }
  }
  bday.q = { it, ask, key, pic, options: shuffle([right, ...wrong]), answer: null };
}

/** The questions items give as the gear is set: the date, the age (only with a year, from 1 up), or
 *  both. Each is remembered on its own: knowing someone's birthday isn't knowing their age. */
const bdayQuestions = (items) => items.flatMap((it) => {
  // The year only: for those whose year is known (the others are asked their date).
  if (bday.mode === 'year') return it.years >= 1 ? [{ it, ask: 'year', key: `year:${it.key}` }] : [{ it, ask: 'date', key: it.key }];
  const age = it.years >= 1 && bday.mode !== 'date';
  const date = bday.mode !== 'age' || !age;
  return [...(date ? [{ it, ask: 'date', key: it.key }] : []), ...(age ? [{ it, ask: 'age', key: `age:${it.key}` }] : [])];
});

/** Three wrong ages near the right one. Under 18, four ages in a row with the right one anywhere in
 *  them (7, 8, 9, 10), since a few years make all the difference for a child; for an adult, two,
 *  four or six years off. */
function wrongAges(n) {
  if (n < 18) {
    const start = Math.max(1, n - Math.floor(Math.random() * 4));
    return [0, 1, 2, 3].map((i) => start + i).filter((x) => x !== n).slice(0, 3);
  }
  const step = 2;
  const out = shuffle([-3, -2, -1, 1, 2, 3]).map((o) => n + o * step).filter((x) => x >= 1).slice(0, 3);
  for (let x = n + 4 * step; out.length < 3; x += step) out.push(x);
  return out;
}

/** The birthday game's settings, behind the gear: the advanced way, and which levels are in it. */
function bdaySettings() {
  const dlg = $('#sheet');
  const L = getLang();
  const items = bdayItems();
  const levels = bdayLevels(items);
  const count = (n) => items.filter((x) => x.level === n).length;
  dlg.innerHTML = `<form method="dialog" class="sheet-form quiz-settings"><h2>${t('quizSettings')}</h2>
    <fieldset class="inline"><legend>${t('bdayAskWhat')}</legend>
      ${['both', 'date', 'age', 'year'].map((m) => `<label class="chk"><input type="radio" name="mode" value="${m}" ${bday.mode === m ? 'checked' : ''} /> ${t(`bdayMode_${m}`)}</label>`).join('')}
    </fieldset>
    <label class="chk"><input type="checkbox" name="recall" ${quiz.recall ? 'checked' : ''} /> ${t('quizRecall')}</label>
    ${levels.length > 1 ? `<fieldset><legend>${t('bdayLevels')}</legend>
      ${levels.map((n) => `<label class="chk"><input type="checkbox" name="level" value="${n}" ${bday.levels.has(n) ? 'checked' : ''} />
        <span class="lvl"><b>${esc(t('bdayLevel', L, levels.indexOf(n) + 1))}</b><small>${esc(t(`bdayLevel${n}`, L))}</small></span> <span class="n">${count(n)}</span></label>`).join('')}
    </fieldset>` : ''}
    <div class="actions"><button type="button" class="cta small" data-sheet="done">${t('quizDone')}</button></div></form>`;
  const f = dlg.querySelector('form');
  const boxes = [...f.querySelectorAll('[name="level"]')];
  // At least one level stays in.
  const lock = () => { const on = boxes.filter((b) => b.checked); boxes.forEach((b) => { b.disabled = on.length === 1 && b.checked; }); };
  lock();
  f.addEventListener('change', () => {
    quiz.recall = f.recall.checked;
    localStorage.setItem('tree.quiz.recall', quiz.recall ? '1' : '0');
    bday.mode = f.mode.value;
    localStorage.setItem('tree.bday.mode', bday.mode);
    if (boxes.length) { bday.levels = new Set(boxes.filter((b) => b.checked).map((b) => Number(b.value))); saveLevels(); }
    lock();
  });
  dlg.querySelector('[data-sheet="done"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { nextBday(); render(); }, { once: true });
  dlg.showModal();
}

function bdayPage() {
  if (!bday.q) nextBday();
  const q = bday.q;
  const L = getLang();
  const items = bdayItems();
  const levels = bdayLevels(items);
  const head = hero({ left: quizLeft(), gear: 'bday-settings', body: `<div class="home-head"><h1 class="hello">${t('bdayTitle')}</h1><p class="dim">${t('bdaySub')}</p></div>` });
  const bar = '';
  const on = levels.filter((n) => bday.levels.has(n));
  // Levels are numbered as this person has them: with no uncles or cousins in the tree, "everyone
  // else" is their level 3.
  const no = (n) => levels.indexOf(n) + 1;
  if (!q) {
    // Everyone known: on to the next level when there is one (or this level again, as practice);
    // with nothing due today, practice.
    const next = levels.find((n) => n > Math.max(...on));
    const msg = bday.none === 'empty' ? `<p class="empty">${t('bdayNone')}</p>`
      : bday.none === 'allKnown' && next ? `<div class="card pad quiz"><p class="quiz-result ok">${esc(t('bdayLevelDone', L, on.map(no).join(', ')))}</p>
        <div class="quiz-actions"><button type="button" class="chip lilac" data-act="bday-practice">${esc(t('bdayRedo', L, on.map(no).join(', ')))}</button>
        <button type="button" class="cta small" data-act="bday-level" data-id="${next}">${esc(t('bdayGoLevel', L, no(next)))}</button></div></div>`
      : restCard(t(bday.none === 'allKnown' ? 'bdayAllKnown' : 'caughtUp'), 'bday-practice');
    // In the regular way (four to choose from), a level done suggests the harder way: think & reveal.
    const harder = bday.none !== 'empty' && !quiz.recall ? `<div class="card pad quiz-tip"><p>${t('bdayTryRecall')}</p>
      <div class="quiz-actions"><button type="button" class="cta small" data-act="bday-recall-on">${t('quizRecall')}</button></div></div>` : '';
    return `${head}<main class="content">${bar}${msg}${harder}</main>${nav('quiz')}`;
  }
  const pool = bdayQuestions(items.filter((x) => bday.levels.has(x.level)));
  const known = pool.filter((x) => isKnown('bday', x.key)).length;
  // Which levels are on, after the score, when there's more than one to choose from: "(level 1)".
  const only = levels.length > 1 ? t('bdayLevelsOn', L, on.map(no)) : '';
  const { it } = q;
  const age = q.ask === 'age', year = q.ask === 'year', num = age || year;
  const rightKey = bdayRight(q);
  const done = q.answer != null;
  const ok = done && q.answer === rightKey;
  const kind = it.p ? ({ f: 'F', m: 'M' }[sexOf(it.p)] ?? '') : 'C';   // her birthday, his, their anniversary, or (sex not recorded) neutral
  // An option and the answer as shown: a date ("15 Shvat"), or an age (the bare number on a button,
  // "8 years old" / "בן 8" as the answer).
  const label = (o) => (year ? yearName(o, L) : age ? String(o) : formatDate(o, L));
  const answer = year ? yearName(itemYear(it), L) : age ? t(`ageIs${kind}`, L, it.years) : formatDate(it.date, L);
  const keyOf = (o) => (num ? String(o) : dmKey(o));
  const cls = (o) => (!done ? '' : keyOf(o) === rightKey ? 'ok' : keyOf(o) === q.answer ? 'bad' : '');
  const name = it.p ? full(it.p) : pairName(it.c, L);
  const askKey = year ? 'yearAsk' : age ? 'ageAsk' : 'bdayAsk', thinkKey = year ? 'yearThink' : age ? 'ageThink' : 'bdayThink';
  // After the answer: the whole date with its year, and (for one person) where they sit in the tree.
  // A date question adds the age after it, "(בן 7)" / "(12 years)"; an age question already has it.
  const ageNote = !age && it.years != null ? ` (${t(`ageIs${kind}`, L, it.years)})` : '';
  const dateLine = it.p ? (it.p.h_year ? t('bdayBorn', L, formatDate(it.p, L)) : '')
    : it.c.w_year ? t('bdayMarried', L, formatDate({ h_day: it.c.w_day, h_month: it.c.w_month, h_year: it.c.w_year }, L)) : '';
  const fullDate = dateLine && dateLine + ageNote;
  const where = done || q.revealed
    ? [fullDate, ...(it.p ? quizWhere(it.p) : [])].filter(Boolean).map((x) => `<span>${esc(x.charAt(0).toUpperCase() + x.slice(1))}</span>`).join('')
    : '';
  const photo = (src, wide) => `<div class="quiz-photo${wide ? ' wide' : ''}"><img src="${esc(src)}" alt="" /></div>`;
  const pic = q.pic.pair ? `<div class="quiz-pair">${q.pic.pair.map((s) => photo(s)).join('')}</div>` : photo(q.pic.src, q.pic.wide);
  const profile = it.p ? it.p.id : it.c.a;
  return `${head}<main class="content">
    <div class="card pad quiz">
      <p class="quiz-score">${esc(t('quizScore', L, bday.right, bday.total))}${bday.streak >= 3 ? ` · ${esc(t('quizStreak', L, bday.streak))}` : ''} · ${esc(t('quizKnown', L, known, pool.length))}${only ? ` <span class="quiz-only">(${esc(only)})</span>` : ''}</p>
      ${pic}
      <p class="quiz-name">${esc(name)}</p>
      ${quiz.recall ? (q.revealed
        // The advanced way, after the reveal: the date, then you mark yourself (straight on to the next).
        ? `<p class="quiz-date he">${esc(answer)}</p>
      ${where ? `<p class="quiz-where">${where}</p>` : ''}
      <p class="quiz-ask">${t('quizDidKnow')}</p>
      <div class="quiz-opts two">
        <button type="button" class="quiz-opt ok" data-act="bday-answer" data-id="${rightKey}">${t('quizKnew')}</button>
        <button type="button" class="quiz-opt bad" data-act="bday-answer" data-id="x">${t('quizMissed')}</button>
      </div>`
        : `<p class="quiz-ask">${t(`${thinkKey}${kind}`)}</p>
      <button type="button" class="cta" data-act="bday-reveal" autofocus>${t(num ? 'ageReveal' : 'bdayReveal')}</button>`)
      : `<p class="quiz-ask">${t(`${askKey}${kind}`)}</p>
      <div class="quiz-opts${num ? ' ages' : ''}">
        ${q.options.map((o) => `<button type="button" class="quiz-opt ${cls(o)}" data-act="bday-answer" data-id="${keyOf(o)}" ${done ? 'disabled' : ''}><span class="he">${esc(label(o))}</span></button>`).join('')}
      </div>
      ${done ? `<p class="quiz-result ${ok ? 'ok' : 'bad'}">${esc(ok ? t('quizRight') : t('quizWrong', L, answer))}</p>
      ${where ? `<p class="quiz-where">${where}</p>` : ''}
      <div class="quiz-actions">
        <a class="chip lilac" href="#/person/${profile}">${t('openProfile')}</a>
        <button type="button" class="cta small" data-act="bday-next" autofocus>${t('quizNext')}</button>
      </div>` : ''}`}
    </div>
  </main>${nav('quiz')}`;
}

// ---------- the in-laws game ----------

// A son- or daughter-in-law's photo and name, and one of two questions: whose son-in-law is he (four
// couples to pick from), or who is he married to (four people born into the family). Both mixed to
// start with; the gear picks one. Or the advanced way (think & reveal, the setting shared by every
// game). Its score and what it remembers are its own, each kind of question on its own.
const inlaw = { q: null, right: 0, total: 0, streak: 0, recent: [], practice: false, none: null,
  // Generations left out, as in "Who's this?" (someone who married in counts with their spouse).
  gensOff: new Set((() => { try { return JSON.parse(localStorage.getItem('tree.inlaw.gensOff')) ?? []; } catch { return []; } })()),
  // What it asks: 'both' (the start), 'inlaw' (whose son-in-law), or 'spouse' (married to whom).
  mode: (() => { try { return localStorage.getItem('tree.inlaw.mode') ?? 'both'; } catch { return 'both'; } })() };

/** The in-laws of someone who married in: their husband's or wife's parents, when they're in the tree.
 *  Not for an engaged couple (not in-laws until the wedding) or one no longer together. */
function inLawsOf(p) {
  if (p.parents && couple(p.parents)) return null;   // born into the family
  const mc = coupleOf(p.id), sp = spouseOf(p.id);
  if (!mc || mc.root || mc.apart || isEngaged(mc) || !sp?.parents) return null;
  return couple(sp.parents) ?? null;
}
/** Someone's sex, or (when it isn't recorded) the other one from their husband's or wife's. */
const sexOf = (p) => p.sex || { m: 'f', f: 'm' }[spouseOf(p.id)?.sex] || null;
/** Everyone who can come up: sons- and daughters-in-law with a photo, living, whose husband or wife
 *  and in-laws are living too (nobody who has passed away is a question or an answer). Not the top
 *  couple's (everyone knows whose those are), so the top couple is never one of the answers either;
 *  and not your own immediate family's: your parents', your husband's or wife's parents', or your own. */
function inlawAll() {
  const me = hasMe() && person(api.me);
  const sp = me && spouseOf(me.id);
  const near = new Set([me?.parents, sp?.parents, me && coupleOf(me.id)?.id].filter(Boolean));
  return state.people.filter((p) => {
    const c = p.photo && !p.deceased && !spouseOf(p.id)?.deceased && inLawsOf(p);
    return c && !c.root && !near.has(c.id) && bothLiving(c);
  });
}
const inlawPool = () => inlawAll().filter((p) => !inlaw.gensOff.has(quizGen(p)));
/** The questions as the gear is set: for each person, whose in-law and/or married to whom. */
const inlawQuestions = (people) => people.flatMap((p) => [
  ...(inlaw.mode !== 'spouse' ? [{ p, ask: 'inlaw', key: p.id }] : []),
  ...(inlaw.mode !== 'inlaw' ? [{ p, ask: 'spouse', key: `sp:${p.id}` }] : []),
]);
/** Couples with children (below the top couple): the answers to "whose in-law". */
const parentCouples = () => { const ids = new Set(state.people.map((k) => k.parents)); return state.couples.filter((c) => ids.has(c.id) && !c.root && bothLiving(c)); };
/** A couple of whom neither has passed away: the games ask only about the living (as answers too). */
const bothLiving = (c) => Boolean(c) && !person(c.a)?.deceased && !(c.b && person(c.b)?.deceased);
/** Someone born into the family by the name they were born with: a married daughter has her
 *  husband's family name, which would give the answer away, so her father's family name instead. */
function birthName(x, l = getLang()) {
  const c = x.parents && couple(x.parents);
  const dad = c && ([person(c.a), person(c.b)].find((y) => y?.sex === 'm') ?? person(c.a));
  return [first(x, l), dad ? last(dad, l) : last(x, l)].filter(Boolean).join(' ');
}

function nextInlaw() {
  const pool = inlawQuestions(inlawPool());
  const couples = parentCouples();
  if (!pool.length || couples.length < 4) { inlaw.q = null; inlaw.none = 'empty'; return; }
  const next = pickNext('inlaw', pool, inlaw.recent, inlaw.practice);
  if (!next.pick) { inlaw.q = null; inlaw.none = next.none; return; }
  inlaw.none = null;
  const { p, ask, key } = next.pick;
  const L = getLang();
  const pick = (right, candidates, label, tier) => {
    const names = new Set([label(right)]);
    const wrong = [];
    for (const x of shuffle(candidates).sort((a, b) => tier(a) - tier(b))) {
      if (names.has(label(x))) continue;
      names.add(label(x));
      wrong.push(x);
      if (wrong.length === 3) break;
    }
    return shuffle([right, ...wrong]).map((x) => ({ id: x.id, label: label(x) }));
  };
  if (ask === 'spouse') {
    // The wrong ones: born into the family, of the spouse's sex, and married; the spouse's brothers or
    // sisters first, then the same generation.
    const sp = spouseOf(p.id);
    const sex = sexOf(sp);
    const born = state.people.filter((x) => x.id !== sp.id && !x.deceased && x.parents && couple(x.parents) && (!sex || sexOf(x) === sex) && coupleOf(x.id) && !coupleOf(x.id).apart);
    const tier = (x) => (x.parents === sp.parents ? 0 : quizGen(x) === quizGen(sp) ? 1 : 2);
    const options = pick(sp, born, (x) => birthName(x, L), tier);
    inlaw.q = { p, ask, key, pic: quizPic(p), options, rightId: sp.id, rightLabel: birthName(sp, L), answer: null };
    return;
  }
  // The wrong couples: of the same generation as the right one first. A daughter-in-law has her
  // husband's family name, so for her those with that name come first (else it gives it away).
  const right = inLawsOf(p);
  const gen = (c) => quizGen(person(c.a));
  const surname = (c) => { const m = [person(c.a), person(c.b)].find((x) => x?.sex === 'm') ?? person(c.a); return last(m); };
  // The family name counts most for her (it's the answer's name), then the generation.
  const tier = (c) => (sexOf(p) === 'f' && surname(c) !== surname(right) ? 2 : 0) + (gen(c) === gen(right) ? 0 : 1);
  const options = pick(right, couples.filter((c) => c.id !== right.id), (c) => pairName(c, L), tier);
  inlaw.q = { p, ask, key, pic: quizPic(p), options, rightId: right.id, rightLabel: pairName(right, L), answer: null };
}

/** The in-laws game's settings, behind the gear: what to ask, the advanced way, and which
 *  generations are in it. */
function inlawSettings() {
  const dlg = $('#sheet');
  const L = getLang();
  const all = inlawAll();
  const gens = [...new Set(all.map(quizGen))].filter(Boolean).sort((a, b) => a - b);
  const count = (g) => all.filter((p) => quizGen(p) === g).length;
  dlg.innerHTML = `<form method="dialog" class="sheet-form quiz-settings"><h2>${t('quizSettings')}</h2>
    <fieldset class="inline"><legend>${t('bdayAskWhat')}</legend>
      ${['both', 'inlaw', 'spouse'].map((m) => `<label class="chk"><input type="radio" name="mode" value="${m}" ${inlaw.mode === m ? 'checked' : ''} /> ${t(`inlawMode_${m}`)}</label>`).join('')}
    </fieldset>
    <label class="chk"><input type="checkbox" name="recall" ${quiz.recall ? 'checked' : ''} /> ${t('quizRecall')}</label>
    ${gens.length > 1 ? `<fieldset><legend>${t('quizGens')}</legend>
      ${gens.map((g) => `<label class="chk"><input type="checkbox" name="gen" value="${g}" ${inlaw.gensOff.has(g) ? '' : 'checked'} /> ${esc(genLabel(g, L))} <span class="n">${count(g)}</span></label>`).join('')}
    </fieldset>` : ''}
    <div class="actions"><button type="button" class="cta small" data-sheet="done">${t('quizDone')}</button></div></form>`;
  const f = dlg.querySelector('form');
  const boxes = [...f.querySelectorAll('[name="gen"]')];
  // At least one generation stays in.
  const lock = () => { const on = boxes.filter((b) => b.checked); boxes.forEach((b) => { b.disabled = on.length === 1 && b.checked; }); };
  lock();
  f.addEventListener('change', () => {
    quiz.recall = f.recall.checked;
    localStorage.setItem('tree.quiz.recall', quiz.recall ? '1' : '0');
    inlaw.mode = f.mode.value;
    localStorage.setItem('tree.inlaw.mode', inlaw.mode);
    inlaw.gensOff = new Set(boxes.filter((b) => !b.checked).map((b) => Number(b.value)));
    localStorage.setItem('tree.inlaw.gensOff', JSON.stringify([...inlaw.gensOff]));
    lock();
  });
  dlg.querySelector('[data-sheet="done"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { nextInlaw(); render(); }, { once: true });
  dlg.showModal();
}

function inlawPage() {
  if (!inlaw.q) nextInlaw();
  const q = inlaw.q;
  const L = getLang();
  // The ⓘ: who isn't asked, so nobody wonders where they went.
  const root = rootCouple();
  const info = root ? t(hasMe() ? 'inlawInfoMine' : 'inlawInfo', L, coupleName(root, L)) : '';
  // The ⓘ sits at the end of the description line; tapping it shows the note under it.
  const head = hero({ left: quizLeft(), gear: 'inlaw-settings', body: `<div class="home-head"><h1 class="hello">${t('inlawTitle')}</h1><p class="dim">${t('inlawSub')}${info
    ? ` <button type="button" class="info-i" data-act="game-info" aria-expanded="false" aria-label="${esc(t('gameInfoLabel'))}">ⓘ</button></p><p class="game-note" hidden>${esc(info)}` : ''}</p></div>` });
  const bar = '';
  if (!q) {
    const msg = inlaw.none === 'empty' ? `<p class="empty">${t('inlawNone')}</p>`
      : restCard(t(inlaw.none === 'allKnown' ? 'inlawAllKnown' : 'caughtUp'), 'inlaw-practice');
    return `${head}<main class="content">${bar}${msg}</main>${nav('quiz')}`;
  }
  const pool = inlawQuestions(inlawPool());
  const known = pool.filter((x) => isKnown('inlaw', x.key)).length;
  const gensIn = inlaw.gensOff.size ? [...new Set(inlawAll().map(quizGen))].filter((g) => g && !inlaw.gensOff.has(g)) : [];
  const only = gensIn.length === 1 ? t('quizOnly', L, genLabel(gensIn[0], L)) : gensIn.length ? t('quizNGens', L, gensIn.length) : '';
  const done = q.answer != null;
  const ok = done && q.answer === q.rightId;
  const cls = (o) => (!done ? '' : o.id === q.rightId ? 'ok' : o.id === q.answer ? 'bad' : '');
  const kind = { f: 'F', m: 'M' }[sexOf(q.p)] ?? '';
  const askKey = q.ask === 'spouse' ? 'spouseAsk' : 'inlawAsk', thinkKey = q.ask === 'spouse' ? 'spouseThink' : 'inlawThink';
  // After the answer: whose husband or wife they are, and whose son- or daughter-in-law.
  const where = done || q.revealed ? quizWhere(q.p).map((x) => `<span>${esc(x.charAt(0).toUpperCase() + x.slice(1))}</span>`).join('') : '';
  // A daughter-in-law's last name is her husband's family's, which is the answer: her name before marriage
  // in brackets ("Mirel (Wolvovsky)"), or her first name alone when it isn't filled in.
  const maidenIn = (x) => (L === 'he' ? x.maiden_he || x.maiden : x.maiden || x.maiden_he);
  const shownName = q.ask === 'inlaw' && sexOf(q.p) === 'f' ? `${first(q.p)}${maidenIn(q.p) ? ` (${maidenIn(q.p)})` : ''}` : full(q.p);
  return `${head}<main class="content">
    <div class="card pad quiz">
      <p class="quiz-score">${esc(t('quizScore', L, inlaw.right, inlaw.total))}${inlaw.streak >= 3 ? ` · ${esc(t('quizStreak', L, inlaw.streak))}` : ''} · ${esc(t('quizKnown', L, known, pool.length))}${only ? ` <span class="quiz-only">(${esc(only)})</span>` : ''}</p>
      <div class="quiz-photo${q.pic.wide ? ' wide' : ''}"><img src="${esc(q.pic.src)}" alt="" /></div>
      <p class="quiz-name">${esc(shownName)}</p>
      ${quiz.recall ? (q.revealed
        // The advanced way, after the reveal: the answer, then you mark yourself (straight on to the next).
        ? `<p class="quiz-date">${esc(q.rightLabel)}</p>
      ${where ? `<p class="quiz-where">${where}</p>` : ''}
      <p class="quiz-ask">${t('quizDidKnow')}</p>
      <div class="quiz-opts two">
        <button type="button" class="quiz-opt ok" data-act="inlaw-answer" data-id="${q.rightId}">${t('quizKnew')}</button>
        <button type="button" class="quiz-opt bad" data-act="inlaw-answer" data-id="x">${t('quizMissed')}</button>
      </div>`
        : `<p class="quiz-ask">${t(`${thinkKey}${kind}`)}</p>
      <button type="button" class="cta" data-act="inlaw-reveal" autofocus>${t('inlawReveal')}</button>`)
      : `<p class="quiz-ask">${t(`${askKey}${kind}`)}</p>
      <div class="quiz-opts${q.ask === 'spouse' ? ' faces' : ''}">
        ${q.options.map((o) => {
          // "Married to whom": each option with its profile photo, which helps the faces stick.
          const face = q.ask === 'spouse' && person(o.id);
          return `<button type="button" class="quiz-opt ${face ? 'with-face' : ''} ${cls(o)}" data-act="inlaw-answer" data-id="${o.id}" ${done ? 'disabled' : ''}>${face ? avatar(face, 'sm', { camera: false }) : ''}<span class="he">${esc(o.label)}</span></button>`;
        }).join('')}
      </div>
      ${done ? `<p class="quiz-result ${ok ? 'ok' : 'bad'}">${esc(ok ? t('quizRight') : t('quizWrong', L, q.rightLabel))}</p>
      ${where ? `<p class="quiz-where">${where}</p>` : ''}
      <div class="quiz-actions">
        <a class="chip lilac" href="#/person/${q.p.id}">${t('openProfile')}</a>
        <button type="button" class="cta small" data-act="inlaw-next" autofocus>${t('quizNext')}</button>
      </div>` : ''}`}
    </div>
  </main>${nav('quiz')}`;
}

// ---------- the "whose child?" game ----------

// Someone born into the family, their photo and name: whose son or daughter? Four couples to pick
// from (the same family name and the parents' brothers and sisters first, the hardest), or think &
// reveal. Not the top couple's children (everyone knows them), nor your own close family's. Leans
// to the younger generations, where it's a real question: with younger ones in the tree, the top
// couple's grandchildren start out unchecked in the gear.
const kids = { q: null, right: 0, total: 0, streak: 0, recent: [], practice: false, none: null,
  // Generations left out (as in "Who's this?"); null until changed in the gear: then the default.
  gensOff: (() => { try { const s = localStorage.getItem('tree.kids.gensOff'); return s ? new Set(JSON.parse(s)) : null; } catch { return null; } })() };

/** Your close family's couples, whose children you know: your own, your parents' (your brothers
 *  and sisters), your husband's or wife's parents', and your brothers' and sisters' on both sides
 *  (nephews and nieces). */
function nearCouples() {
  const me = hasMe() && person(api.me);
  if (!me) return new Set();
  const sp = spouseOf(me.id);
  const near = new Set([coupleOf(me.id)?.id, me.parents, sp?.parents].filter(Boolean));
  for (const s of state.people.filter((x) => x.parents && (x.parents === me.parents || x.parents === sp?.parents))) {
    const c = coupleOf(s.id);
    if (c) near.add(c.id);
  }
  return near;
}
/** Everyone who can come up: born into the family (below the top couple's children), with a photo,
 *  living, with both parents living (the answer), and not your close family's. */
function kidsAll() {
  const near = nearCouples();
  return state.people.filter((p) => {
    const c = p.photo && !p.deceased && p.parents && couple(p.parents);
    return c && !c.root && !near.has(c.id) && bothLiving(c);
  });
}
/** The generations left out: as set in the gear, or to start with the top couple's grandchildren
 *  (generation 2) when there are at least a few younger ones. */
function kidsGensOff() {
  if (kids.gensOff) return kids.gensOff;
  const all = kidsAll();
  return all.filter((p) => quizGen(p) > 2).length >= 8 ? new Set([2]) : new Set();
}
const kidsPool = () => { const off = kidsGensOff(); return kidsAll().filter((p) => !off.has(quizGen(p))); };

function nextKid() {
  const pool = kidsPool().map((p) => ({ key: p.id, p }));
  const couples = parentCouples();
  if (!pool.length || couples.length < 4) { kids.q = null; kids.none = 'empty'; return; }
  const next = pickNext('kids', pool, kids.recent, kids.practice);
  if (!next.pick) { kids.q = null; kids.none = next.none; return; }
  kids.none = null;
  const { p, key } = next.pick;
  const L = getLang();
  // The wrong couples: the same family name first (else the name gives it away), then the
  // parents' brothers' and sisters' couples, then the same generation.
  const right = couple(p.parents);
  const born = (c) => [person(c.a), person(c.b)].find((x) => x?.parents && couple(x.parents));
  const surname = (c) => { const m = [person(c.a), person(c.b)].find((x) => x?.sex === 'm') ?? person(c.a); return last(m); };
  const sib = (c) => born(c)?.parents && born(c)?.parents === born(right)?.parents;
  const gen = (c) => quizGen(person(c.a));
  const tier = (c) => (surname(c) === surname(right) ? 0 : 4) + (sib(c) ? 0 : 2) + (gen(c) === gen(right) ? 0 : 1);
  const names = new Set([pairName(right, L)]);
  const wrong = [];
  for (const c of shuffle(couples.filter((c) => c.id !== right.id)).sort((a, b) => tier(a) - tier(b))) {
    if (names.has(pairName(c, L))) continue;
    names.add(pairName(c, L));
    wrong.push(c);
    if (wrong.length === 3) break;
  }
  kids.q = { p, key, pic: quizPic(p), options: shuffle([right, ...wrong]), rightId: right.id, rightLabel: pairName(right, L), answer: null };
}

/** The game's settings, behind the gear: the advanced way, and which generations are in it. */
function kidsSettings() {
  const dlg = $('#sheet');
  const L = getLang();
  const all = kidsAll();
  const off = kidsGensOff();
  const gens = [...new Set(all.map(quizGen))].filter(Boolean).sort((a, b) => a - b);
  const count = (g) => all.filter((p) => quizGen(p) === g).length;
  const root = rootCouple();
  dlg.innerHTML = `<form method="dialog" class="sheet-form quiz-settings"><h2>${t('quizSettings')}</h2>
    <label class="chk"><input type="checkbox" name="recall" ${quiz.recall ? 'checked' : ''} /> ${t('quizRecall')}</label>
    ${gens.length > 1 ? `<fieldset><legend>${t('quizGens')}</legend>
      ${root ? `<p>${esc(t('quizGensHint', L, coupleName(root, L)))}</p>` : ''}
      ${gens.map((g) => `<label class="chk"><input type="checkbox" name="gen" value="${g}" ${off.has(g) ? '' : 'checked'} /> ${esc(genLabel(g, L))} <span class="n">${count(g)}</span></label>`).join('')}
    </fieldset>` : ''}
    <div class="actions"><button type="button" class="cta small" data-sheet="done">${t('quizDone')}</button></div></form>`;
  const f = dlg.querySelector('form');
  const boxes = [...f.querySelectorAll('[name="gen"]')];
  // At least one generation stays in.
  const lock = () => { const on = boxes.filter((b) => b.checked); boxes.forEach((b) => { b.disabled = on.length === 1 && b.checked; }); };
  lock();
  f.addEventListener('change', () => {
    quiz.recall = f.recall.checked;
    localStorage.setItem('tree.quiz.recall', quiz.recall ? '1' : '0');
    if (boxes.length) {
      kids.gensOff = new Set(boxes.filter((b) => !b.checked).map((b) => Number(b.value)));
      localStorage.setItem('tree.kids.gensOff', JSON.stringify([...kids.gensOff]));
    }
    lock();
  });
  dlg.querySelector('[data-sheet="done"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { nextKid(); render(); }, { once: true });
  dlg.showModal();
}

function kidsPage() {
  if (!kids.q) nextKid();
  const q = kids.q;
  const L = getLang();
  // The ⓘ at the end of the description: who isn't asked.
  const root = rootCouple();
  const info = root ? t(hasMe() ? 'kidsInfoMine' : 'kidsInfo', L, coupleName(root, L)) : '';
  const head = hero({ left: quizLeft(), gear: 'kids-settings', body: `<div class="home-head"><h1 class="hello">${t('kidsTitle')}</h1><p class="dim">${t('kidsSub')}${info
    ? ` <button type="button" class="info-i" data-act="game-info" aria-expanded="false" aria-label="${esc(t('gameInfoLabel'))}">ⓘ</button></p><p class="game-note" hidden>${esc(info)}` : ''}</p></div>` });
  const bar = '';
  if (!q) {
    const msg = kids.none === 'empty' ? `<p class="empty">${t('kidsNone')}</p>`
      : restCard(t(kids.none === 'allKnown' ? 'kidsAllKnown' : 'caughtUp'), 'kids-practice');
    return `${head}<main class="content">${bar}${msg}</main>${nav('quiz')}`;
  }
  const pool = kidsPool();
  const known = pool.filter((p) => isKnown('kids', p.id)).length;
  const all = kidsAll(), off = kidsGensOff();
  const gensIn = off.size ? [...new Set(all.map(quizGen))].filter((g) => g && !off.has(g)) : [];
  const only = gensIn.length === 1 ? t('quizOnly', L, genLabel(gensIn[0], L)) : gensIn.length ? t('quizNGens', L, gensIn.length) : '';
  const done = q.answer != null;
  const ok = done && q.answer === q.rightId;
  const cls = (c) => (!done ? '' : c.id === q.rightId ? 'ok' : c.id === q.answer ? 'bad' : '');
  const kind = { f: 'F', m: 'M' }[sexOf(q.p)] ?? '';
  // After the answer: the birthday, and whose child and grandchild they are.
  const where = done || q.revealed ? [bornLine(q.p), ...quizWhere(q.p)].filter(Boolean).map((x) => `<span>${esc(x.charAt(0).toUpperCase() + x.slice(1))}</span>`).join('') : '';
  return `${head}<main class="content">
    <div class="card pad quiz">
      <p class="quiz-score">${esc(t('quizScore', L, kids.right, kids.total))}${kids.streak >= 3 ? ` · ${esc(t('quizStreak', L, kids.streak))}` : ''} · ${esc(t('quizKnown', L, known, pool.length))}${only ? ` <span class="quiz-only">(${esc(only)})</span>` : ''}</p>
      <div class="quiz-photo${q.pic.wide ? ' wide' : ''}"><img src="${esc(q.pic.src)}" alt="" /></div>
      ${'' /* Only the first name until answered: the family name is the father's, and would give the parents away. */}
      <p class="quiz-name">${esc(done || q.revealed ? full(q.p) : first(q.p))}</p>
      ${quiz.recall ? (q.revealed
        // The advanced way, after the reveal: the parents, then you mark yourself (straight on to the next).
        ? `<p class="quiz-date">${esc(q.rightLabel)}</p>
      ${where ? `<p class="quiz-where">${where}</p>` : ''}
      <p class="quiz-ask">${t('quizDidKnow')}</p>
      <div class="quiz-opts two">
        <button type="button" class="quiz-opt ok" data-act="kids-answer" data-id="${q.rightId}">${t('quizKnew')}</button>
        <button type="button" class="quiz-opt bad" data-act="kids-answer" data-id="x">${t('quizMissed')}</button>
      </div>`
        : `<p class="quiz-ask">${t(`kidsThink${kind}`)}</p>
      <button type="button" class="cta" data-act="kids-reveal" autofocus>${t('inlawReveal')}</button>`)
      : `<p class="quiz-ask">${t(`kidsAsk${kind}`)}</p>
      <div class="quiz-opts">
        ${q.options.map((c) => `<button type="button" class="quiz-opt ${cls(c)}" data-act="kids-answer" data-id="${c.id}" ${done ? 'disabled' : ''}><span class="he">${esc(pairName(c, L))}</span></button>`).join('')}
      </div>
      ${done ? `<p class="quiz-result ${ok ? 'ok' : 'bad'}">${esc(ok ? t('quizRight') : t('quizWrong', L, q.rightLabel))}</p>
      ${where ? `<p class="quiz-where">${where}</p>` : ''}
      <div class="quiz-actions">
        <a class="chip lilac" href="#/person/${q.p.id}">${t('openProfile')}</a>
        <button type="button" class="cta small" data-act="kids-next" autofocus>${t('quizNext')}</button>
      </div>` : ''}`}
    </div>
  </main>${nav('quiz')}`;
}

// ---------- learn a family ----------

// One household at a time: a couple, their children, and their children's husbands and wives (not
// the grandchildren: they're the next family). Pick the family, look at everyone (with the names
// hidden to test yourself), then practice: photo → name and name → photo, the wrong answers from
// the same family, so siblings get told apart. Answers count in "Who's this?" too (the same
// progress, game 'who'), and it says when you know everyone. Those who have passed away are left out.
const fam = { cid: (() => { try { return localStorage.getItem('tree.fam.couple'); } catch { return null; } })(),
  picking: false, tab: 'study', hide: false, shown: new Set(), q: null, recent: [], right: 0, total: 0, streak: 0 };

/** The household: the couple, then each child (oldest first) followed by their husband or wife. */
function famMembers(c) {
  const out = [person(c.a), person(c.b)];
  for (const k of childrenOf(c.id)) {
    out.push(k);
    const kc = coupleOf(k.id);
    if (kc && !kc.apart) out.push(person(kc.a === k.id ? kc.b : kc.a));
  }
  return out.filter((p) => p && !p.deceased);
}
/** Families to pick from: every couple with children, of whom both are living, by name. */
const famCouples = () => state.couples.filter((c) => bothLiving(c) && childrenOf(c.id).length).sort((a, b) => coupleName(a).localeCompare(coupleName(b)));
const famCouple = () => (fam.cid && couple(fam.cid) && bothLiving(couple(fam.cid)) ? couple(fam.cid) : null);

function nextFam() {
  const c = famCouple();
  const members = c ? famMembers(c).filter((p) => p.photo) : [];
  if (members.length < 2) { fam.q = null; return; }
  const pool = members.flatMap((p) => [{ key: p.id, p, ask: 'name' }, { key: `face:${p.id}`, p, ask: 'face' }]);
  if (pool.every((x) => isKnown('who', x.key))) { fam.q = null; fam.done = true; return; }
  fam.done = false;
  // Learning: ask the shakiest ones whether or not they're due (practice), until all are known.
  const { pick } = pickNext('who', pool.filter((x) => !isKnown('who', x.key)), fam.recent, true);
  const { p, ask, key } = pick;
  // The other answers: from the same family, the same sex first; a small family is filled in from
  // the same generation elsewhere.
  const same = (x) => !sexOf(p) || !sexOf(x) || sexOf(x) === sexOf(p);
  const inFam = shuffle(members.filter((x) => x.id !== p.id)).sort((a, b) => same(b) - same(a));
  const outside = shuffle(state.people.filter((x) => x.photo && !x.deceased && same(x) && !members.includes(x) && quizGen(x) === quizGen(p)));
  const others = [...inFam, ...outside].slice(0, 3);
  fam.q = { p, ask, key, options: shuffle([p, ...others]), answer: null };
}

/** The family picker: a search box and the families, with the couple's photos. */
function famPicker(head) {
  const L = getLang();
  const rows = famCouples().map((c) => {
    // Searchable by the couple's names and their children's.
    const words = famMembers(c).map((p) => `${full(p, 'he')} ${full(p, 'en')}`).join(' ').toLowerCase();
    return `<button type="button" class="person-row fam-pick" data-act="fam-pick" data-id="${c.id}" data-search="${esc(words)}">
      ${pair(c)}<span class="person-text"><span class="title">${esc(t('famOf', L, pairName(c, L)))}</span>
      <span class="sub">${esc(t('nMembers', L, famMembers(c).length))}</span></span></button>`;
  }).join('');
  return `${head}<main class="content">
    <p class="quiz-ask">${t('famPick')}</p>
    <input type="search" id="famq" class="fam-search" placeholder="${esc(t('famSearch'))}" autocomplete="off" />
    <div class="card list fam-list">${rows}</div>
  </main>${nav('quiz')}`;
}

function famPage() {
  const L = getLang();
  const c = famCouple();
  const head = hero({ left: quizLeft(), body: `<div class="home-head"><h1 class="hello">${t('famTitle')}</h1><p class="dim">${t('famSub')}</p></div>` });
  if (!c || fam.picking) return famPicker(head);
  const members = famMembers(c);
  const tabs = `<div class="seg quiz-scope" role="tablist">
      <label><input type="radio" name="famtab" value="study" ${fam.tab === 'study' ? 'checked' : ''} data-act="fam-tab" /><span>${t('famStudy')}</span></label>
      <label><input type="radio" name="famtab" value="practice" ${fam.tab === 'practice' ? 'checked' : ''} data-act="fam-tab" /><span>${t('famPractice')}</span></label>
    </div>`;
  // The family's name, and under it how long they've been married and their city.
  const married = yearsSince(c.w_day, c.w_month, c.w_year);
  const about = [married != null && married > 0 ? t('yearsMarried', L, married) : '', cityOf(person(c.a)) || cityOf(person(c.b)) || ''].filter(Boolean).join(' · ');
  const title = `<div class="fam-head"><div><h2>${esc(t('famOf', L, pairName(c, L)))}</h2>${about ? `<p class="fam-about">${esc(about)}</p>` : ''}</div>
    <button type="button" class="link" data-act="fam-change">${t('famChange')}</button></div>`;
  if (fam.tab === 'study') {
    // Everyone as a card: the parents, then each child with their husband or wife beside them.
    // Under the name: who they are (a child with their age), then the age of a parent, son- or
    // daughter-in-law, and the city when it isn't the parents' (a married child who moved out).
    const home = cityOf(person(c.a)) || cityOf(person(c.b));
    const card = (p) => {
      const named = !fam.hide || fam.shown.has(p.id);
      const n = p.parents === c.id ? null : yearsSince(p.h_day, p.h_month, p.h_year);
      const city = cityOf(p) && cityOf(p) !== home ? cityOf(p) : '';
      const meta = [n != null ? t(`ageIs${{ m: 'M', f: 'F' }[sexOf(p)] ?? ''}`, L, n) : '', city].filter(Boolean).join(' · ');
      return `<button type="button" class="fam-card" data-act="fam-card" data-id="${p.id}">${avatar(p, 'sm', { camera: false })}
        <span class="fam-name he">${named ? esc(quizName(p)) : '?'}</span>${named ? `<span class="fam-role">${esc(famRole(p, c, L))}</span>${meta ? `<span class="fam-role">${esc(meta)}</span>` : ''}` : ''}</button>`;
    };
    // Each row keeps its couple, for the sign between the two cards.
    const rows = [Object.assign([person(c.a), person(c.b)].filter((p) => p && !p.deceased), { couple: c })];
    for (const k of childrenOf(c.id).filter((x) => !x.deceased)) {
      const kc = coupleOf(k.id);
      const sp = kc && !kc.apart ? person(kc.a === k.id ? kc.b : kc.a) : null;
      rows.push(Object.assign([k, sp && !sp.deceased ? sp : null].filter(Boolean), { couple: kc }));
    }
    // The same rules as the heart elsewhere: none for a couple who are apart, a ring while engaged.
    const sign = (cc) => (!cc || cc.apart ? '' : `<span class="heart fam-heart${isEngaged(cc) ? ' ring' : ''}" aria-hidden="true">${isEngaged(cc) ? '💍' : '♥'}</span>`);
    return `${head}<main class="content">${title}${tabs}
      <label class="chk fam-hide"><input type="checkbox" data-act="fam-hide" ${fam.hide ? 'checked' : ''} /> ${t('famHide')}</label>
      ${fam.hide ? `<p class="quiz-ask">${t('famTapHint')}</p>` : ''}
      <div class="fam-grid">${rows.map((r) => `<div class="fam-row${r.length === 1 ? ' one' : ''}">${r.map(card).join('')}${r.length === 2 ? sign(r.couple) : ''}</div>`).join('')}</div>
      ${c.photo ? `<div class="card family-photo fam-photo">
        <button type="button" class="fam-img" data-act="zoom-family" data-cid="${c.id}" aria-label="${esc(t('famOf', L, pairName(c, L)))}"><img src="${esc(c.photo)}" alt="" /></button>
      </div>` : ''}
    </main>${nav('quiz')}`;
  }
  // Practice.
  if (!fam.q && !fam.done) nextFam();
  const withPhoto = members.filter((p) => p.photo);
  const keys = withPhoto.flatMap((p) => [p.id, `face:${p.id}`]);
  const known = keys.filter((k) => isKnown('who', k)).length;
  if (!fam.q) {
    const msg = fam.done ? `<div class="card pad quiz"><p class="quiz-result ok">${esc(t('famDone', L, pairName(c, L)))}</p>
        <div class="quiz-actions"><button type="button" class="chip lilac" data-act="fam-change">${t('famChange')}</button></div></div>`
      : `<p class="empty">${t('famNoPhotos')}</p>`;
    return `${head}<main class="content">${title}${tabs}${msg}</main>${nav('quiz')}`;
  }
  const q = fam.q;
  const done = q.answer != null;
  const ok = done && q.answer === q.p.id;
  const where = done || q.revealed ? [famRole(q.p, c, L, false), bornLine(q.p)].filter(Boolean).map((x) => `<span>${esc(x.charAt(0).toUpperCase() + x.slice(1))}</span>`).join('') : '';
  const cls = (o) => (!done ? '' : o.id === q.p.id ? 'ok' : o.id === q.answer ? 'bad' : '');
  const next = `<div class="quiz-actions"><button type="button" class="cta small" data-act="fam-next" autofocus>${t('quizNext')}</button></div>`;
  const marks = `<p class="quiz-ask">${t('quizDidKnow')}</p><div class="quiz-opts two">
        <button type="button" class="quiz-opt ok" data-act="fam-answer" data-id="${q.p.id}">${t('quizKnew')}</button>
        <button type="button" class="quiz-opt bad" data-act="fam-answer" data-id="x">${t('quizMissed')}</button></div>`;
  let body;
  if (q.ask === 'face') {
    body = `<p class="quiz-name he">${esc(quizName(q.p))}</p>` + (quiz.recall
      ? (q.revealed ? `<div class="quiz-photo"><img src="${esc(q.p.photo)}" alt="" /></div>${where ? `<p class="quiz-where">${where}</p>` : ''}${marks}`
        : `<p class="quiz-ask">${t('faceThink')}</p><button type="button" class="cta" data-act="fam-reveal" autofocus>${t('faceReveal')}</button>`)
      : `<p class="quiz-ask">${t('faceAsk')}</p><div class="quiz-opts faces">
        ${q.options.map((o) => `<button type="button" class="quiz-opt with-face ${cls(o)}" data-act="fam-answer" data-id="${o.id}" ${done ? 'disabled' : ''}>${avatar(o, 'sm', { camera: false })}${done ? `<span class="he">${esc(quizName(o))}</span>` : ''}</button>`).join('')}
      </div>${done ? `<p class="quiz-result ${ok ? 'ok' : 'bad'}">${esc(ok ? t('quizRight') : t('faceWrong'))}</p>${where ? `<p class="quiz-where">${where}</p>` : ''}${next}` : ''}`);
  } else {
    body = `<div class="quiz-photo"><img src="${esc(q.p.photo)}" alt="" /></div>` + (quiz.recall
      ? (q.revealed ? `<p class="quiz-name he">${esc(quizName(q.p))}</p>${where ? `<p class="quiz-where">${where}</p>` : ''}${marks}`
        : `<p class="quiz-ask">${t('quizThink')}</p><button type="button" class="cta" data-act="fam-reveal" autofocus>${t('quizReveal')}</button>`)
      : `<div class="quiz-opts">
        ${q.options.map((o) => `<button type="button" class="quiz-opt ${cls(o)}" data-act="fam-answer" data-id="${o.id}" ${done ? 'disabled' : ''}><span class="he">${esc(quizName(o))}</span></button>`).join('')}
      </div>${done ? `<p class="quiz-result ${ok ? 'ok' : 'bad'}">${esc(ok ? t('quizRight') : t('quizWrong', L, quizName(q.p)))}</p>${where ? `<p class="quiz-where">${where}</p>` : ''}${next}` : ''}`);
  }
  return `${head}<main class="content">${title}${tabs}
    <div class="card pad quiz">
      <p class="quiz-score">${esc(t('quizScore', L, fam.right, fam.total))}${fam.streak >= 3 ? ` · ${esc(t('quizStreak', L, fam.streak))}` : ''} · ${esc(t('quizKnown', L, known, keys.length))}</p>
      ${body}
    </div>
  </main>${nav('quiz')}`;
}

/** Who someone is in the household: "Mother" / "Son" / "Son-in-law, husband of Rivky". */
function famRole(p, c, l = getLang(), withAge = true) {
  const sx = { m: 'M', f: 'F' }[sexOf(p)] ?? '';
  if (p.id === c.a || p.id === c.b) return t(`famParent${sx}`, l);
  // A child with their age: "בן 12" says both.
  if (p.parents === c.id) { const n = withAge ? yearsSince(p.h_day, p.h_month, p.h_year) : null; return n != null ? t(`ageIs${sx}`, l, n) : t(`famChild${sx}`, l); }
  const sp = spouseOf(p.id);
  return sp ? t(`famInLaw${sx}`, l, first(sp, l)) : '';
}

// ---------- search ----------

const plainHe = (s) => String(s ?? '').replace(/[֑-ׇ"'״׳`]/g, '').toLowerCase();
// "בן יוסף", "בת חיים", "son of Yosef", "sons of Sima", "בני שמחה": what follows is a parent's name.
const CHILD_OF = /(?:^|\s)(?:בן|בת|בר|ב"ר|בני|בנות|ילדי|(?:sons?|daughters?|child|children|kids) of)(?:\s|$)/i;
const words = (...xs) => xs.filter(Boolean).flatMap((x) => plainHe(x).split(/[\s\-]+/)).filter(Boolean);

/** The child of the top couple a person descends from (or married into the family of). */
function branchOf(p) {
  const root = rootCouple();
  for (let cur = p, i = 0; cur && i < 12; i++) {
    if (cur.parents === root?.id) return cur;
    if (!cur.parents) { const sp = spouseOf(cur.id); if (!sp || !sp.parents) return null; cur = sp; continue; }
    const c = couple(cur.parents);
    cur = person(c?.a)?.parents ? person(c.a) : person(c?.b) ?? person(c?.a);
  }
  return null;
}

/**
 * Both readings of the words typed: as a name ("בת שבע", "Bas Sheva Lipsh") and, where there is a
 * "בן/בת/son of", as "<child> of <parent>". Name matches come first, so a name that begins with
 * בן or בת (בת שבע, בן ציון) is found and not taken for "daughter of שבע".
 */
function search(q) {
  const raw = q.trim();
  if (!raw) return [];
  const m = raw.match(CHILD_OF);
  const byName = matchPeople(words(raw), []);
  // "son(s) of / בן / בני" keeps the sons, "daughter(s) of / בת / בנות" the daughters (when known), "children of / ילדי" both.
  const kind = m && (/^\s*(בן|בני|בר|ב"ר|sons?\b)/i.test(m[0]) ? 'm' : /^\s*(בת|בנות|daughters?\b)/i.test(m[0]) ? 'f' : null);
  const byParent = m ? matchPeople(words(raw.slice(0, m.index)), words(raw.slice(m.index + m[0].length)))
    .filter((p) => !kind || !p.sex || p.sex === kind) : [];
  const seen = new Set(byName.map((p) => p.id));
  return byName.concat(byParent.filter((p) => !seen.has(p.id))).slice(0, 60);
}

/** People whose own names start with every word of `own` and whose parents' names with every word of `parent`. */
function matchPeople(own, parent) {
  if (!own.length && !parent.length) return [];
  const hit = (list, tok) => (list.includes(tok) || [...(same.get(tok) ?? [])].some((w) => list.includes(w)) ? 2 : list.some((w) => w.startsWith(tok)) ? 1 : 0);
  const out = [];
  for (const p of state.people) {
    const mine = words(p.he_first, p.he_full, p.en_first, p.he_last, p.en_last, p.maiden, p.maiden_he, p.nickname);
    const c = p.parents && couple(p.parents);
    const theirs = c ? words(person(c.a)?.he_first, person(c.a)?.he_full, person(c.a)?.en_first, person(c.b)?.he_first, person(c.b)?.he_full, person(c.b)?.en_first) : [];
    let score = 0, ok = true;
    for (const tok of own) { const h = hit(mine, tok); if (!h) { ok = false; break; } score += h; }
    for (const tok of parent) { if (!ok) break; const h = hit(theirs, tok); if (!h) { ok = false; break; } score += h; }
    if (ok) out.push([score, p]);
  }
  return out.sort((a, b) => b[0] - a[0] || byBirth(a[1], b[1])).map(([, p]) => p);
}

function personCard(p, extra = '') {
  const sp = spouseOf(p.id);
  const c = p.parents && couple(p.parents);
  const br = branchOf(p);
  const meta = [
    c && !c.root ? `${t('parents')}: ${coupleName(c)}` : '',
    br && br.id !== p.id ? t('branch', getLang(), first(br)) : '',
  ].filter(Boolean).join(' · ');
  return `<a class="card pad result" href="#/person/${p.id}">
    <span class="person-row">
      ${avatar(p, 'md', { camera: false })}
      <span class="person-text">
        <span class="title he">${esc(withZl(p, named(p)))}${p.id === api.me ? ` <span class="chip green">${t('you')}</span>` : ''}</span>
        <span class="sub">${nameLine(fullIn(p, otherLang()), sp)}</span>
        ${meta ? `<span class="sub">${esc(meta)}</span>` : ''}
        ${extra}
      </span>
    </span>
  </a>`;
}

function searchResults() {
  const q = state.q ?? '';
  const status = searchStatus();
  if (!q.trim()) return status + `<p class="empty">${t('searchHint')}</p>`;
  const off = state.offBranches;
  // All faces on (the default) = the whole family, the top couple included. Some off = only the ones still on.
  const found = search(q).filter((p) => !off.size || (branchOf(p) && !off.has(branchOf(p).id)));
  const roots = hasRoots() ? searchRoots(q) : [];
  const tree = found.map((p) => personCard(p, birthdayLine(p))).join('');
  if (state.wider && roots.length) {
    return status + tree + `<div class="sec-head"><h2>${t('rootsGroup')}</h2></div>` + roots.map(rootsCard).join('');
  }
  if (!found.length && roots.length) {
    return status + `<p class="empty">${t('noResults')}</p><button type="button" class="card pad more-wider" data-act="wider-on">${t('nMoreWider', getLang(), roots.length)} · <b>${t('showThem')}</b></button>`;
  }
  return status + (tree || `<p class="empty">${t('noResults')}</p>`);
}

// ---------- earlier roots (the wider family) ----------

const hasRoots = () => Boolean(state.roots?.people.length);
/** Whether the site has the drawn tree (#/chart): where there are earlier roots. Before they've loaded, as it
 *  was on the last visit, so its buttons are there at once. */
const hasChart = () => (state.roots ? hasRoots() : storeGet('tree.hasRoots') === '1');
let sameOne = new Map();   // the same, but only from groups of one-word spellings (משה / Moses / Mosche): 'משה יוסף' must not tie יוסף to משה
let same = new Map();   // a spelling -> the spellings that go with it (from the roots' spelling groups)
let rootsLoading = null;
/** Loads the roots once, then redraws the screen that wanted them. */
function loadRoots() {
  if (state.roots || rootsLoading) return;
  const use = (d) => {
    const again = Boolean(state.roots);   // the fresh ones, replacing the kept ones
    const byId = new Map(d.people.map((p) => [p.id, p]));
    state.roots = { ...d, byId, byMain: new Map(d.people.filter((p) => p.main_person).map((p) => [p.main_person, p])) };
    // Spellings that go together (פלדמן / פעלדמן / Feldman, באשא / באשע): each one-word spelling -> all of its group.
    same = new Map(); sameOne = new Map();
    for (const g of d.spellings ?? []) {
      const ws = [...new Set(g.flatMap((x) => words(x)).filter((w) => w.length > 1))];
      for (const w of ws) same.set(w, new Set([...(same.get(w) ?? []), ...ws]));
      if (g.every((x) => words(x).length === 1)) for (const w of ws) sameOne.set(w, new Set([...(sameOne.get(w) ?? []), ...ws]));
    }
    kinCache = null;
    storeSet('tree.hasRoots', d.people.length ? '1' : '0');
    // On search, redraw only the controls and results, so typing isn't interrupted.
    if (route()[0] === 'search' && $('#results')) { $('#roots-controls').innerHTML = searchControls(); $('#results').innerHTML = searchResults(); }
    else if (again && (document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName))) { /* not under someone typing or with a window open */ }
    else if (['roots', 'person', 'chart', 'famous'].includes(route()[0]) || (route()[0] === 'tree' && !again)) render();
  };
  // At once from what this browser kept last time; the fresh ones replace them when they come (if they changed).
  const fresh = api.roots();
  rootsLoading = api.rootsCached().then(async (old) => {
    if (old) use(old.data);
    const d = await fresh;
    if (old && (!api.rootsText || api.rootsText === old.text)) return;   // didn't come, or the same
    use(d);
  }).catch(() => { state.roots ??= { people: [], couples: [], byId: new Map(), byMain: new Map() }; });
}
let kinCache = null;
/** One graph of the tree and the roots, for relationships (rebuilt when either changes). */
function kin() {
  const key = `${state.people.length}:${state.couples.length}:${state.roots?.people.length ?? 0}`;
  if (kinCache?.key !== key) kinCache = { key, g: kinGraph(state.people, state.couples, state.roots?.people ?? [], state.roots?.couples ?? []) };
  return kinCache.g;
}
/** A title before the name (ר׳, הרב, הרבנית / R', Rabbi) and הכהן / הלוי between the first name and the family name. */
const rootsTitle = (p, l = getLang()) => (l === 'he' ? p.title_he || p.title_en : p.title_en || p.title_he) ?? '';
const rootsTribe = (p, l = getLang()) => (p.tribe ? t(p.tribe === 'levi' ? 'tribeLevi' : 'tribeKohen', l) : '');
/** The bare name (first and family), for where there is little room: a card on the drawn tree. */
const rootsPlain = (p, l = getLang()) => (l === 'he'
  ? [p.he_first || p.en_first, p.he_last || p.en_last] : [p.en_first || p.he_first, p.en_last || p.he_last]).filter(Boolean).join(' ');
/** The name in full: the title, the first name, הכהן / הלוי, the family name. */
const rootsFull = (p, l = getLang()) => [rootsTitle(p, l), ...(l === 'he'
  ? [p.he_first || p.en_first, rootsTribe(p, l), p.he_last || p.en_last] : [p.en_first || p.he_first, rootsTribe(p, l), p.en_last || p.he_last]),
  p.hyd ? (l === 'he' ? 'הי״ד' : 'HY"D') : rootsZl(p, l)].filter(Boolean).join(' ');   // הי"ד after the name, in place of ז"ל
/** ז"ל / z"l for someone in the extended family who passed away within the last 100 years (by Geni's year, or
 *  the Hebrew one); not with an unknown year, and not beside הי"ד. */
const rootsZl = (p, l = getLang()) => {
  if (!p.died || p.hyd) return '';
  const ago = p.died.y ? new Date().getFullYear() - p.died.y : p.died.h?.h_year ? THIS_YEAR - p.died.h.h_year : null;
  return ago != null && ago <= 100 ? t(p.sex === 'F' ? 'ah' : 'zl', l).trim() : '';
};
const rootsWithZl = (p, s, l = getLang()) => [s, rootsZl(p, l)].filter(Boolean).join(' ');
/** What someone is known as (אדמו״ר הזקן / The Alter Rebbe), when they are. */
const rootsKnown = (p, l = getLang()) => (l === 'he' ? p.known_he || p.known_en : p.known_en || p.known_he) ?? '';
/** How someone is shown: what they are known as, or the name in full. */
const rootsName = (p, l = getLang()) => rootsKnown(p, l) || rootsFull(p, l);

/** Roots people matching the words typed (names in both languages and aliases), not ones already in the tree. */
function searchRoots(q) {
  const toks = words(q);
  if (!toks.length) return [];
  const out = [];
  for (const p of state.roots.people) {
    if (p.hidden || p.main_person) continue;
    const mine = words(p.he_first, p.he_last, p.en_first, p.en_last, ...(p.aliases ?? []));
    let score = 0, ok = true;
    for (const tok of toks) {
      const h = mine.includes(tok) || [...(same.get(tok) ?? [])].some((w) => mine.includes(w)) ? 2 : mine.some((w) => w.startsWith(tok)) ? 1 : 0;
      if (!h) { ok = false; break; }
      score += h;
    }
    if (ok) out.push([score, p]);
  }
  // The best matches, closest relatives first, then cut down (sorting before the cut, so a common family name,
  // a hundred people of one family name, doesn't drop the ones you're looking for); a few hundred are worked out at most.
  const top = out.sort((a, b) => b[0] - a[0]).slice(0, 400);
  const dist = (p) => { const v = viewerFor(p.id); return v ? relations(kin(), v, p.id)[0]?.dist ?? 99 : 99; };
  return top.map(([sc, p]) => [sc, dist(p), p]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 150).map(([, , p]) => p);
}

/** Who relationships are shown to: you, when the app knows who you are; otherwise whichever of the top
 *  couple is closer. */
function viewerFor(targetId) {
  if (api.me && person(api.me)) return api.me;
  const rc = rootCouple();
  const cands = [rc?.a, rc?.b].filter(Boolean);
  return cands.map((v) => [v, relations(kin(), v, targetId)[0]?.dist ?? 99]).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
}
const closestLabel = (targetId) => {
  const v = viewerFor(targetId);
  const r = v && relations(kin(), v, targetId)[0];
  return r ? r.label[getLang()] : '';
};

/** The person's Geni profile: ids imported from Geni are Geni page names ("profile-123"); ids from a GEDCOM are Geni's
 *  number ("geni-6000000012345"), whose page is /people/p/<number>. Not for the hidden links ("geni-fam-…"). */
const geniUrl = (p) => (p.id.startsWith('profile-') ? `https://www.geni.com/${p.id}`
  : /^geni-\d+$/.test(p.id) ? `https://www.geni.com/people/p/${p.id.slice(5)}` : null);
const rootsGalleryOf = (pid) => (state.roots?.photos ?? []).filter((g) => g.person === pid && !g.kind);
const rootsMatzeivaOf = (pid) => (state.roots?.photos ?? []).filter((g) => g.person === pid && g.kind === 'matzeiva').at(-1);
/** A page of a book they wrote (its title page, as a rule): one picture, kept like the headstone's. */
const rootsBookOf = (pid) => (state.roots?.photos ?? []).filter((g) => g.person === pid && g.kind === 'book').at(-1);
/** Its row on an extended-family profile: the page (tap to see it large), or a button to add one. */
function bookRow(p) {
  const g = rootsBookOf(p.id);
  return `<div class="info-row matzeiva-row">
    <span class="tile sm lilac" aria-hidden="true">📖</span>
    <span class="info-text"><span class="label">${t('bookPage')}</span>
      ${g ? '' : `<span class="matzeiva-links"><button type="button" class="value add" data-act="roots-book-add" data-id="${esc(p.id)}">${t('addBookPage')}</button></span>`}</span>
    ${g ? `<button type="button" class="thumb matzeiva-thumb" data-act="roots-book-zoom" data-id="${esc(p.id)}" aria-label="${esc(t('bookPage'))}"><img src="${esc(api.rootsGalleryUrl(g))}" alt="" loading="lazy" /></button>` : ''}
  </div>`;
}
/** The picture on someone's card in the drawn tree: their own; or, so the card isn't blank, a page of a book they
 *  wrote, or else their headstone. */
function t2pic(n) {
  if (n.t) return n.t.photo || matzeivaOf(n.id)?.url || null;
  const own = api.rootsPhotoUrl(n.r);
  if (own) return own;
  const g = rootsBookOf(n.id) ?? rootsMatzeivaOf(n.id);
  return g ? api.rootsGalleryUrl(g) : null;
}
/** The headstone (מצבה) row on the profile of someone who passed away: the photo (tap to see it large), or a
 *  button to add one. `act` names the clicks for the tree ('matzeiva') or the roots ('roots-matzeiva'). */
function matzeivaRow(url, act, id, burial = '') {
  return `<div class="info-row matzeiva-row">
    <span class="tile sm lilac" aria-hidden="true">🪦</span>
    <span class="info-text"><span class="label">${t('matzeiva')}</span>
      ${burial ? `<span class="value" dir="auto">${esc(burial)}</span>` : ''}
      <span class="matzeiva-links">
        ${url ? '' : `<button type="button" class="value add" data-act="${act}-add" data-id="${esc(id)}">${t('addMatzeiva')}</button>`}
        <button type="button" class="value add" data-act="burial-edit" data-kind="${act}" data-id="${esc(id)}">${t(burial ? 'editBurial' : 'addBurial')}</button>
      </span></span>
    ${url ? `<button type="button" class="thumb matzeiva-thumb" data-act="${act}-zoom" data-id="${esc(id)}" aria-label="${esc(t('matzeiva'))}"><img src="${esc(url)}" alt="" loading="lazy" /></button>` : ''}
  </div>`;
}
/** Where someone is buried: free text, for the tree ('matzeiva') or the roots ('roots-matzeiva'). */
function openBurialSheet(kind, id) {
  const roots = kind === 'roots-matzeiva';
  const p = roots ? state.roots.byId.get(id) : person(id);
  const dlg = $('#sheet');
  dlg.innerHTML = `<form method="dialog" class="sheet-form">
    <h2>${t('burialTitle')} · <bdi>${esc(roots ? rootsName(p) : withZl(p, full(p)))}</bdi></h2>
    <label class="field"><input name="burial" value="${esc(p.burial ?? '')}" maxlength="250" dir="auto" autocomplete="off" placeholder="${esc(t('burialHint'))}" /></label>
    <p class="err" hidden></p>
    <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button><button class="cta small">${t('save')}</button></div>
  </form>`;
  const f = dlg.querySelector('form');
  dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      if (roots) Object.assign(p, await api.saveRoots(id, { field: 'burial', burial: f.burial.value }));
      else { await api.savePerson({ ...p, burial: f.burial.value.trim() || null }); await refresh(); }
      dlg.close(); render();
    } catch (err) { const e = f.querySelector('.err'); e.textContent = err.message; e.hidden = false; }
  });
  dlg.showModal();
  f.burial.focus();
}
/** The headstone photo, large: change (a new one replaces it), download, remove. */
function matzeivaZoom(g, url, download, pickTarget, remove, name, what = 'matzeiva') {
  showLarge([{ src: url, caption: `${t(what)} · ${name}`, wide: true, download, onChange: () => pickPhoto(pickTarget),
    onDelete: async () => { if (!confirm(t('deletePhotoConfirm'))) return false; try { await remove(); return true; } catch (err) { alert(t('saveErr') + err.message); return false; } } }]);
}

/** "More photos" on a roots page, like the tree's: thumbnails, and a button to add one. */
function rootsGalleryRow(p) {
  const pics = rootsGalleryOf(p.id);
  const offset = p.photo_v ? 1 : 0;
  return `<div class="info-row gallery-row">
    <span class="tile sm pink" aria-hidden="true">🖼️</span>
    <span class="info-text"><span class="label">${t('morePhotos')}</span>
      <span class="value ${pics.length ? '' : 'add quiet'}">${esc(pics.length ? t('nPhotos', getLang(), pics.length) : t('morePhotosHint'))}</span></span>
  </div>
  <div class="gallery">
    ${pics.map((g, i) => `<button type="button" class="thumb" data-act="roots-zoom" data-id="${esc(p.id)}" data-i="${i + offset}" aria-label="${esc(`${t('viewPhoto')} ${i + 1}`)}"><img src="${esc(api.rootsGalleryUrl(g))}" alt="" loading="lazy" /></button>`).join('')}
    <button type="button" class="thumb add-thumb" data-act="roots-add-gallery" data-id="${esc(p.id)}" aria-label="${esc(t('addMorePhoto'))}">${ICON.plus}<span>${t('addMorePhoto')}</span></button>
  </div>`;
}
/** Someone who heads a sister family's tree (the brother or sister of this family's own top couple): what their
 *  tree profile holds there, shown here to see: their more pictures and their documents and videos. */
function kinTreeCard(p) {
  if (!p.kin_tree) return '';
  const pics = (state.roots?.kin_photos ?? []).filter((g) => g.person === p.kin_tree);
  const items = itemsRow(p.kin_tree, true);
  if (!pics.length && !items) return '';
  return `<div class="card list items-card">
    ${pics.length ? `<div class="info-row gallery-row"><span class="tile sm pink" aria-hidden="true">🖼️</span><span class="info-text"><span class="label">${t('morePhotos')}</span><span class="value">${esc(t('nPhotos', getLang(), pics.length))}</span></span></div>
    <div class="gallery">${pics.map((g) => `<a class="thumb" href="/api/gallery/${g.id}" target="_blank" rel="noopener"><img src="/api/gallery/${g.id}" alt="" loading="lazy" /></a>`).join('')}</div>` : ''}
    ${items}
  </div>`;
}
/** A roots person's pictures, large: the profile photo, then the more photos (with their captions). */
function rootsZoom(pid, start = 0) {
  const p = state.roots.byId.get(pid);
  const name = rootsName(p);
  const items = [
    ...(p.photo_v ? [{ src: api.rootsPhotoUrl(p), caption: name, onChange: () => pickPhoto(`roots:${pid}`), download: `/api/roots/${encodeURIComponent(pid)}/photo?size=original`,
      onDelete: async () => {
        if (!confirm(t('deleteProfilePhotoConfirm'))) return false;
        try { await api.removeRootsPhoto(pid); p.photo_v = null; render(); return true; } catch (err) { alert(t('saveErr') + err.message); return false; }
      } }] : []),
    ...rootsGalleryOf(pid).map((g) => ({
      src: api.rootsGalleryUrl(g), caption: [name, g.caption].filter(Boolean).join(' · '), wide: true, download: api.rootsGalleryUrl(g, true),
      onDelete: async () => {
        if (!confirm(t('deletePhotoConfirm'))) return false;
        try { await api.deleteRootsGalleryPhoto(g.id); state.roots.photos = state.roots.photos.filter((x) => x.id !== g.id); render(); return true; }
        catch (err) { alert(t('saveErr') + err.message); return false; }
      },
    })),
  ];
  if (items.length) showLarge(items, start);
}

/** A roots person's circle: their photo, or the first letter of their name. With `camera`, a button to add
 *  or change the photo (on their roots page). */
function rootsAv(p, size = 'md', { camera = false } = {}) {
  const url = api.rootsPhotoUrl(p);
  const inner = url ? (camera ? `<button type="button" class="av-zoom" data-act="roots-zoom" data-id="${esc(p.id)}" data-i="0"><img src="${esc(url)}" alt="" /></button>` : `<img src="${esc(url)}" alt="" loading="lazy" />`) : esc((rootsName(p) || '?').trim()[0] ?? '?');
  const cam = camera ? `<button type="button" class="cam" data-act="roots-photo" data-id="${esc(p.id)}" aria-label="${esc(t(url ? 'changePhoto' : 'addPhoto'))}">${ICON.camera}</button>` : '';
  return `<span class="av av-${size} roots-av${url ? ' has-photo' : ''}"><span class="av-face" aria-hidden="true">${inner}</span>${cam}</span>`;
}

function rootsCard(p) {
  const rel = closestLabel(p.id);
  const years = [p.born?.y, p.died?.y].some(Boolean) ? `${p.born?.y ?? ''}–${p.died?.y ?? ''}` : '';
  return `<a class="card pad result" href="#/roots/${encodeURIComponent(p.id)}">
    <span class="person-row">
      ${rootsAv(p, 'md')}
      <span class="person-text">
        <span class="title he"><bdi>${esc(rootsName(p))}</bdi></span>
        <span class="sub"><bdi>${esc(rootsName(p, otherLang()))}</bdi>${years ? ` · ${years}` : ''}</span>
        ${rel ? `<span class="sub rel-line">${esc(rel)}</span>` : ''}
      </span>
    </span>
  </a>`;
}

/** The top couple's children who have a family of their own (a husband or wife, or children). */
function branchHeads() {
  const rc = rootCouple();
  return rc ? childrenOf(rc.id).filter((k) => coupleOf(k.id)) : [];
}
/** Faces (zoom in to branches) and "+ Wider family" (zoom out), above the results. Only on a site with roots. */
function searchControls() {
  if (!hasRoots()) return '';
  const rc = rootCouple();
  const [a, b] = [person(rc?.a), person(rc?.b)];
  const faces = branchHeads().map((k) => `<button type="button" class="branch-face${state.offBranches.has(k.id) ? '' : ' on'}" data-act="branch" data-id="${k.id}" aria-pressed="${!state.offBranches.has(k.id)}">
      ${avatar(k, 'sm', { camera: false })}<span>${esc(withZl(k, first(k)))}</span></button>`).join('');
  return `<div class="branch-row" role="group">${faces}</div>
  <button type="button" class="wider-toggle${state.wider ? ' on' : ''}" data-act="wider" aria-pressed="${state.wider}">
    <span class="box" aria-hidden="true">${state.wider ? '✓' : ''}</span>
    <span><b>${t('wider')}</b><small>${esc(t('widerHint', getLang(), a ? first(a) : '', b ? first(b) : ''))}</small></span>
  </button>${famousOf().length ? `<a class="link famous-link" href="#/famous">${t('famousLink')} ›</a>` : ''}`;
}
function searchStatus() {
  if (!hasRoots()) return '';
  const on = branchHeads().filter((k) => !state.offBranches.has(k.id));
  const parts = !state.offBranches.size ? [t('everyone')] : on.map((k) => t('familyOfN', getLang(), first(k)));
  if (state.wider) parts.push(t('theWider'));
  if (!parts.length) parts.push(t('nobodySelected'));
  return `<p class="dim search-status">${esc(t('searching', getLang(), parts.join(' + ')))}</p>`;
}

/** Famous ancestors in the extended family: those with a few words on who they were (notable_he/en). Only a site
 *  whose extended family has them shows the link and the list. */
const famousOf = () => (state.roots?.people ?? []).filter((p) => !p.hidden && (p.notable_he || p.notable_en));
/** The closest famous person to someone in the extended family who isn't famous themselves, when it is within two
 *  generations (their child or grandchild, parent or grandparent, brother or sister, nephew, uncle; or the husband
 *  or wife of one of those), so the page says where you have landed. Returns { f, he, en } or null. */
const NEAR = {   // by the steps up from the famous person and from this person to whom they share: [a man, a woman]
  '01': { en: ['Son', 'Daughter'], of: ['a son', 'a daughter'], he: [['בנו', 'בתו'], ['בנה', 'בתה']] },
  '02': { en: ['Grandson', 'Granddaughter'], of: ['a grandson', 'a granddaughter'], he: [['נכד', 'נכדה'], ['נכד', 'נכדה']] },
  '10': { en: ['Father', 'Mother'], of: ['the father', 'the mother'], he: [['אביו', 'אמו'], ['אביה', 'אמה']] },
  '20': { en: ['Grandfather', 'Grandmother'], of: ['the grandfather', 'the grandmother'], he: [['סבו', 'סבתו'], ['סבה', 'סבתה']] },
  '11': { en: ['Brother', 'Sister'], of: ['a brother', 'a sister'], he: [['אחיו', 'אחותו'], ['אחיה', 'אחותה']] },
  '12': { en: ['Nephew', 'Niece'], of: ['a nephew', 'a niece'], he: [['אחיין', 'אחיינית'], ['אחיין', 'אחיינית']] },
  '21': { en: ['Uncle', 'Aunt'], of: ['an uncle', 'an aunt'], he: [['דוד', 'דודה'], ['דוד', 'דודה']] },
};
function nearFamous(p) {
  const R = state.roots;
  if (!R || p.notable_he || p.notable_en) return null;
  const cById = (R.coupleById ??= new Map(R.couples.map((c) => [c.id, c])));
  const parentsOf = (x) => { const c = x.parents && cById.get(x.parents); return c ? [c.a, c.b].map((i) => R.byId.get(i)).filter(Boolean) : []; };
  const spousesOf = (x) => R.couples.filter((c) => c.a === x.id || c.b === x.id).map((c) => R.byId.get(c.a === x.id ? c.b : c.a)).filter(Boolean);
  const up2 = (x) => { const m = new Map([[x.id, 0]]); for (const a of parentsOf(x)) { if (!m.has(a.id)) m.set(a.id, 1); for (const b of parentsOf(a)) if (!m.has(b.id)) m.set(b.id, 2); } return m; };
  /** The steps up from f and from x to the nearest person both come from (x itself, or f itself, counts), up to three in all. */
  const tie = (f, x) => {
    if (f.id === x.id) return null;
    const a = up2(f), b = up2(x); let best = null;
    for (const [k, u] of a) if (b.has(k) && (!best || u + b.get(k) < best[0] + best[1])) best = [u, b.get(k)];
    return best && best[0] + best[1] <= 3 ? best : null;
  };
  const w = p.sex === 'F' ? 1 : 0;
  const mine = spousesOf(p);
  let best = null;
  const take = (dist, f, he, en) => { if (!best || dist < best.dist) best = { dist, f, he, en }; };
  for (const f of famousOf()) {
    if (f.id === p.id) continue;
    const fw = f.sex === 'F' ? 1 : 0;
    const b = tie(f, p);
    if (b) { const n = NEAR[b.join('')]; take(b[0] + b[1], f, `${n.he[fw][w]} של`, `${n.en[w]} of`); continue; }
    if (mine.includes(f)) { take(1.5, f, w ? 'אשתו של' : 'בעלה של', w ? 'Wife of' : 'Husband of'); continue; }
    if (spousesOf(f).some((s) => parentsOf(s).includes(p))) { take(2.5, f, `${[['חותנו', 'חותנתו'], ['חמיה', 'חמותה']][fw][w]} של`, `${w ? 'Mother' : 'Father'}-in-law of`); continue; }
    for (const s of mine) {   // the husband or wife of someone close to them
      const m = tie(f, s);
      if (!m) continue;
      const n = NEAR[m.join('')], sw = s.sex === 'F' ? 1 : 0;
      if (m.join('') === '01') take(2.5, f, `${w ? 'כלה' : 'חתן'} של`, `${w ? 'Daughter' : 'Son'}-in-law of`);
      else take(m[0] + m[1] + 1.5, f, `${w ? 'אשתו' : 'בעלה'} של ${n.he[fw][sw]} של`, `${w ? 'Wife' : 'Husband'} of ${n.of[sw]} of`);
    }
  }
  return best;
}
function famousPage() {
  loadRoots();
  const L = getLang();
  // Ancestors (closest generation first), then relatives who aren't ancestors (closest first).
  const items = famousOf().map((p) => {
    const v = viewerFor(p.id);
    const rs = v ? relations(kin(), v, p.id) : [];
    const b = rs.find((r) => r.kind === 'blood');
    return { p, anc: Boolean(b && b.down === 0), dist: rs[0]?.dist ?? 99 };
  }).sort((x, y) => x.dist - y.dist);
  const row = ({ p }) => `<a class="person-row line" href="#/roots/${encodeURIComponent(p.id)}">
      ${rootsAv(p, 'md')}
      <span class="person-text"><span class="title"><bdi>${esc(rootsName(p))}</bdi></span>
        <span class="sub">${esc((L === 'he' ? p.notable_he || p.notable_en : p.notable_en || p.notable_he) ?? '')}</span>
        <span class="sub rel">${esc(closestLabel(p.id))}</span></span>
    </a>`;
  const part = (title, list) => (list.length ? `<div class="sec-head"><h2>${title}</h2></div><div class="card list">${list.map(row).join('')}</div>` : '');
  return hero({
    left: backBtn(),
    body: `<div class="home-head"><h1 class="hello">${t('famousTitle')}</h1><p class="dim">${t('famousSub')}</p></div>`,
  }) + `<main class="content">
    ${items.length ? part(t('famousAncestors'), items.filter((x) => x.anc)) + part(t('famousRelatives'), items.filter((x) => !x.anc)) : `<p class="empty">${t('rootsLoading')}</p>`}
  </main>${nav('search')}`;
}
/** A calendar date from Geni ({y, m, d, approx, place}) in the page's language. */
function civilDate(x, l = getLang()) {
  if (!x?.y) return '';
  const opts = x.d ? { day: 'numeric', month: 'long', year: 'numeric' } : x.m ? { month: 'long', year: 'numeric' } : { year: 'numeric' };
  const s = new Intl.DateTimeFormat(l === 'he' ? 'he-IL' : 'en-US', opts).format(new Date(Date.UTC(x.y, (x.m ?? 1) - 1, x.d ?? 1)));
  return x.approx ? `${t('approx', l)} ${s}` : s;
}

/** A relationship's line as a small tree (decided 2026-11-17, design A): the highest point (the shared
 *  ancestor, ★) on top; the way up from the one it's seen from in the right column, the way down to the
 *  relative in the left, one row per generation; a marriage a dashed step (the spouse a row up on the way
 *  up, a row down on the way down). Borders by sex; the relative stands out, their row banded. A line that
 *  doesn't fit the grid falls back to the list (pathList). */
function pathSteps(r) {
  const g = kin(), L = getLang(), path = r.path ?? [];
  if (path.length < 2) return pathList(r);
  const sexF = (id) => g.node.get(id)?.sex === 'F';
  const isParent = (from, to) => g.parentsOf.get(from)?.ids.includes(to);
  const isChild = (from, to) => g.parentsOf.get(to)?.ids.includes(from);
  // Each step: up (to a parent), down (to a child), or marriage.
  const steps = path.slice(1).map((to, i) => (isParent(path[i], to) ? 'up' : isChild(path[i], to) ? 'down' : 'wed'));
  // Rows: up = a row higher, down = a row lower, a marriage stays in the same row (husband and wife side by side).
  const rows = [0];
  steps.forEach((s, i) => { rows.push(rows[i] + (s === 'down' ? 1 : s === 'up' ? -1 : 0)); });
  const min = Math.min(...rows);
  const at = rows.map((x) => x - min);
  // Very distant ties (more than eight generations from the top of the line down to either end): the list.
  if (Math.max(...at) > 8) return pathList(r);
  const apexI = at.indexOf(0);
  // Every top of a climb (a parent the line goes up to and back down from: the shared ancestor, or an
  // in-law's parent further along) stands over the two of them, as a fork.
  const tops = new Set(steps.flatMap((s, i) => (i > 0 && steps[i - 1] === 'up' && s === 'down' ? [i] : [])));
  const twoCols = tops.size > 0;
  // Columns, in half-card steps along the path: a marriage moves a whole card on; over a top, the way down
  // starts a whole card on, and the top person sits half a card on, over the two of them.
  const x = [0];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    x.push(x[i] + (s === 'wed' ? 2 : tops.has(i + 1) || tops.has(i) ? 1 : 0));
  }
  const span = Math.max(...x) + 2;   // in half-cards (a wide one scrolls sideways)
  const taken = new Map();
  for (let i = 0; i < path.length; i++) {
    for (const k of [`${at[i]}:${x[i]}`, `${at[i]}:${x[i] + 1}`]) { if (taken.has(k)) return pathList(r); taken.set(k, i); }
  }
  // Tree people link to their profile, extended-family people to their page there; a card holds the first name
  // (or what a well-known figure is known as).
  const info = (id) => {
    const tp = person(id);
    if (tp) return { name: withZl(tp, first(tp)), href: `#/person/${id}` };
    const rp = state.roots?.byId.get(g.node.get(id)?.rootsId ?? id) ?? state.roots?.byId.get(id);
    if (!rp || rp.hidden) return { name: t('unknownPerson'), href: null };
    return { name: rootsWithZl(rp, rootsKnown(rp, L) || (L === 'he' ? rp.he_first || rp.en_first : rp.en_first || rp.he_first) || t('unknownPerson'), L), href: `#/roots/${encodeURIComponent(rp.id)}` };
  };
  // What each one is: on the way up, to the one it's seen from (סבא, סבא רבא (דור 4)) while the way up is
  // by blood; otherwise to the one before (בנו, אשתו, אבא של הרבנית).
  const anc = (d, f) => {
    if (L !== 'he') return d === 1 ? (f ? 'mother' : 'father') : d === 2 ? (f ? 'grandmother' : 'grandfather') : `great-grand${f ? 'mother' : 'father'}${d >= 4 ? ` (Generation ${d})` : ''}`;
    return d === 1 ? (f ? 'אמא' : 'אבא') : d === 2 ? (f ? 'סבתא' : 'סבא') : `${f ? 'סבתא רבה' : 'סבא רבא'}${d >= 4 ? ` (דור ${d})` : ''}`;
  };
  const rel = (i) => {
    const prev = path[i - 1], id = path[i], f = sexF(id), pf = sexF(prev), s = steps[i - 1];
    if (i <= apexI && steps.slice(0, i).every((x) => x === 'up')) return anc(i, f);
    if (L !== 'he') {
      const w = s === 'up' ? (f ? 'mother' : 'father') : s === 'down' ? (f ? 'daughter' : 'son') : (f ? 'wife' : 'husband');
      return `${pf ? 'her' : 'his'} ${w}`;
    }
    if (s === 'down') return f ? (pf ? 'בתה' : 'בתו') : (pf ? 'בנה' : 'בנו');
    if (s === 'wed') return f ? 'אשתו' : 'בעלה';
    return `${f ? 'אמא' : 'אבא'} של ${info(prev).name}`;
  };
  const last = path.length - 1;
  const cells = path.map((id, i) => {
    const me = info(id), f = sexF(id);
    const kind = i === 0 ? 'self' : i === last ? 'target' : i === apexI && tops.has(i) ? 'apex' : '';
    const label = i === 0 ? '' : `${i === apexI && tops.has(i) ? '★ ' : ''}${rel(i)}`;
    const name = me.href ? `<a href="${me.href}">${esc(me.name)}</a>` : `<span>${esc(me.name)}</span>`;
    const wed = i > 0 && steps[i - 1] === 'wed' ? ' wed' : '';
    return `<div class="pt-card ${f ? 'f' : 'm'} ${kind}${wed}" style="grid-row: ${at[i] * 2 + 1}; grid-column: ${x[i] + 1} / span 2"><bdi>${name}</bdi>${label ? `<span class="pt-role">${esc(label)}</span>` : ''}</div>`;
  });
  // The lines, in the gap rows: straight down within a column, and a fork from the top person to both ways.
  const lines = [];
  for (let i = 0; i < last; i++) {
    if (steps[i] === 'wed') continue;
    const r1 = Math.min(at[i], at[i + 1]);
    const top = tops.has(i) ? i : tops.has(i + 1) ? i + 1 : null;
    if (top != null) {
      if (tops.has(i)) continue;   // drawn with the way up to it
      lines.push({ html: `<div class="pt-fork" style="grid-row: ${r1 * 2 + 2}; grid-column: ${x[top]} / span 4" aria-hidden="true"><span></span><span></span></div>` });
    } else {
      lines.push({ html: `<div class="pt-link" style="grid-row: ${r1 * 2 + 2}; grid-column: ${x[i] + 1} / span 2" aria-hidden="true"></div>` });
    }
  }
  const rowsN = Math.max(...at) + 1;
  // the person's own row softly marked, where the line branches (in a straight line it's clear enough)
  const band = twoCols ? `<div class="pt-band" style="grid-row: ${at[last] * 2 + 1}; grid-column: 1 / -1" aria-hidden="true"></div>` : '';
  return `<div class="pt-scroll"><div class="pt-tree${span > 6 ? ' wide' : ''}" style="grid-template-columns: repeat(${span}, minmax(${span > 6 ? 31 : 38}px, 1fr)); grid-template-rows: repeat(${rowsN * 2 - 1}, auto); max-width: ${span * 80}px">${band}${lines.map((l) => l.html).join('')}${cells.join('')}</div></div>`;
}

/** The line as a list, one step a row (the fallback of pathSteps): each person with how they're linked to the one
 *  before ("Yosef · Bashi's father"), the shared ancestor marked. */
function pathList(r) {
  const g = kin(), L = getLang();
  const info = (id) => {
    const tp = person(id);
    if (tp) return { name: withZl(tp, first(tp)), full: withZl(tp, named(tp)), href: `#/person/${id}` };
    const rp = state.roots.byId.get(g.node.get(id)?.rootsId ?? id) ?? state.roots.byId.get(id);
    if (!rp || rp.hidden) return { name: t('unknownPerson'), full: t('unknownPerson'), href: null };
    return { name: rootsWithZl(rp, (L === 'he' ? rp.he_first || rp.en_first : rp.en_first || rp.he_first) ?? '', L), full: rootsName(rp), href: `#/roots/${encodeURIComponent(rp.id)}` };
  };
  const f = (id) => g.node.get(id)?.sex === 'F';
  const word = (from, to) => {
    if (g.parentsOf.get(from)?.ids.includes(to)) return f(to) ? ['mother', 'אמא'] : ['father', 'אבא'];
    if (g.parentsOf.get(to)?.ids.includes(from)) return f(to) ? ['daughter', 'בת'] : ['son', 'בן'];
    return f(to) ? ['wife', 'אשה'] : ['husband', 'בעל'];
  };
  const YOURS_HE = { אמא: 'אמא שלך', אבא: 'אבא שלך', בת: 'הבת שלך', בן: 'הבן שלך', אשה: 'אשתך', בעל: 'בעלך' };
  return `<ol class="path-steps">${r.path.map((id, i) => {
    const me = info(id);
    let role;
    if (i === 0) role = id === api.me ? t('you') : '';
    else {
      const [en, he] = word(r.path[i - 1], id);
      const prev = info(r.path[i - 1]).name;
      role = i === 1 && r.path[0] === api.me ? (L === 'he' ? YOURS_HE[he] : `your ${en}`) : (L === 'he' ? `${he} של ${prev}` : `${prev}'s ${en}`);
    }
    const shared = id === r.via;
    const name = me.href ? `<a href="${me.href}">${esc(me.full)}</a>` : `<span>${esc(me.full)}</span>`;
    return `<li class="${shared ? 'shared' : ''}"><bdi>${name}</bdi>${role ? ` <span class="role">· ${esc(role)}</span>` : ''}${shared ? ` <span class="star">★ ${t(f(id) ? 'sharedAncestress' : 'sharedAncestor')}</span>` : ''}</li>`;
  }).join('')}</ol>`;
}

function rootsRow(p) {
  return `<a class="person-row line" href="#/roots/${encodeURIComponent(p.id)}">
    ${rootsAv(p, 'sm')}
    <span class="person-text"><span class="title he"><bdi>${esc(rootsName(p))}</bdi></span><span class="sub"><bdi>${esc(rootsName(p, otherLang()))}</bdi></span></span>
  </a>`;
}
const rootsLink = (x) => (x.main_person && person(x.main_person) ? `<a class="person-row line" href="#/person/${x.main_person}">${avatar(person(x.main_person), 'sm', { camera: false })}<span class="person-text"><span class="title he">${esc(withZl(person(x.main_person), named(person(x.main_person))))}</span></span></a>` : rootsRow(x));

/** A note as HTML: the Hebrew and English sentences of a bilingual note each on their own line (so neither runs
 *  into the other's direction), web addresses as links. */
function noteHtml(text) {
  const he = (x) => /[א-ת]/.test(x.replace(/https?:\/\/\S+/g, ''));
  const groups = [];
  for (const sentence of text.split(/(?<=[.!?)])\s+/)) {
    const last = groups.at(-1);
    if (last && he(last.text) === he(sentence)) last.text += ` ${sentence}`; else groups.push({ text: sentence });
  }
  return groups.map((g) => `<p dir="auto">${esc(g.text).replace(/https?:\/\/[^\s<)]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.length > 50 ? `${u.slice(0, 47)}…` : u}</a>`)}</p>`).join('');
}

/** An About text as HTML: paragraphs and line breaks kept, web addresses as links, everything else escaped. */
function aboutHtml(text) {
  return text.split(/\n{2,}/).map((para) => `<p dir="auto">${esc(para).replace(/\n/g, '<br>')
    .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.length > 60 ? `${u.slice(0, 57)}…` : u}</a>`)}</p>`).join('');
}

/** Editing a roots person: names (both languages) or the Hebrew yahrzeit. Anyone can, as on the tree;
 *  the server keeps the old names as aliases and logs every change. */
function openRootsSheet(field, id) {
  const p = state.roots.byId.get(id);
  if (!p) return;
  const dlg = $('#sheet');
  const L = getLang();
  const input = (name, label, value) => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value ?? '')}" dir="auto" maxlength="120" autocomplete="off" /></label>`;
  const h = p.died?.h ?? {};
  const monthOpts = (sel) => `<option value="">—</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === sel ? 'selected' : ''}>${new Intl.DateTimeFormat(L === 'he' ? 'he-IL' : 'en-US', { month: 'long' }).format(new Date(2000, i, 1))}</option>`).join('')}`;
  const dateRow = (k, x) => `<div class="field-row">
      <label class="field"><span>${t('day')}</span><input type="number" name="${k}_d" min="1" max="31" value="${x?.d ?? ''}" /></label>
      <label class="field grow"><span>${t('month')}</span><select name="${k}_m">${monthOpts(x?.m)}</select></label>
      <label class="field"><span>${t('year')}</span><input type="number" name="${k}_y" min="1000" max="2100" value="${x?.y ?? ''}" /></label>
      <label class="chk"><input type="checkbox" name="${k}_approx" ${x?.approx ? 'checked' : ''} /> ${t('approxDate')}</label>
    </div>
    <div class="field-row heb-row">
      <label class="field"><span>${t('hebDay')}</span><select name="${k}_hd"><option value="">—</option>${Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}" ${i + 1 === x?.h?.h_day ? 'selected' : ''}>${dayName(i + 1, L)}</option>`).join('')}</select></label>
      <label class="field grow"><span>${t('hebMonth')}</span><select name="${k}_hm"><option value="">—</option>${pickerMonths(x?.h?.h_year ?? null).map((m) => `<option value="${m}" ${m === x?.h?.h_month ? 'selected' : ''}>${monthName(m, x?.h?.h_year || LEAP_REF, L)}</option>`).join('')}</select></label>
      <label class="field"><span>${t('hebYear')}</span><input type="number" name="${k}_hy" min="5000" max="6100" value="${x?.h?.h_year ?? ''}" /></label>
    </div>
    <div class="field-row">${input(`${k}_place`, t('place'), x?.place)}</div>`;
  if (field === 'notable') {
    dlg.innerHTML = `<form method="dialog" class="sheet-form">
      <h2>${t('notableTitle')} · <bdi>${esc(rootsName(p))}</bdi></h2>
      <label class="field"><span>עברית</span><input name="notable_he" dir="rtl" maxlength="200" autocomplete="off" value="${esc(p.notable_he ?? '')}" /></label>
      <label class="field"><span>English</span><input name="notable_en" dir="ltr" maxlength="200" autocomplete="off" value="${esc(p.notable_en ?? '')}" /></label>
      <p class="err" hidden></p>
      <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button><button class="cta small">${t('save')}</button></div>
    </form>`;
    const f = dlg.querySelector('form');
    dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { Object.assign(p, await api.saveRoots(id, { field, notable_he: f.notable_he.value, notable_en: f.notable_en.value })); dlg.close(); render(); }
      catch (err) { const e = f.querySelector('.err'); e.textContent = err.message; e.hidden = false; }
    });
    dlg.showModal();
    return;
  }
  if (field === 'about') {
    dlg.innerHTML = `<form method="dialog" class="sheet-form">
      <h2>${t('aboutTitle')} · <bdi>${esc(rootsName(p))}</bdi></h2>
      <label class="field"><textarea name="about" rows="10" maxlength="8000" dir="auto">${esc(p.about ?? '')}</textarea></label>
      <p class="err" hidden></p>
      <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button><button class="cta small">${t('save')}</button></div>
    </form>`;
    const f = dlg.querySelector('form');
    dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { Object.assign(p, await api.saveRoots(id, { field, about: f.about.value })); dlg.close(); render(); }
      catch (err) { const e = f.querySelector('.err'); e.textContent = err.message; e.hidden = false; }
    });
    dlg.showModal();
    return;
  }
  if (field === 'dates') {
    const F = p.sex === 'F';
    dlg.innerHTML = `<form method="dialog" class="sheet-form">
      <h2>${t('datesNote')} · <bdi>${esc(rootsName(p))}</bdi></h2>
      <h3>${t(F ? 'bornF' : 'bornM')}</h3>${dateRow('born', p.born)}
      <label class="chk"><input type="checkbox" name="living" ${p.died ? '' : 'checked'} /> ${t(F ? 'livingF' : 'livingM')}</label>
      <div class="died-part" ${p.died ? '' : 'hidden'}><h3>${t(F ? 'diedF' : 'diedM')}</h3>${dateRow('died', p.died)}</div>
      <label class="field"><span>${t('noteLabel')}</span><textarea name="note" rows="2" maxlength="300" dir="auto">${esc(p.note ?? '')}</textarea></label>
      <p class="err" hidden></p>
      <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button><button class="cta small">${t('save')}</button></div>
    </form>`;
    const f = dlg.querySelector('form');
    f.living.addEventListener('change', () => { dlg.querySelector('.died-part').hidden = f.living.checked; });
    dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const d = (k) => ({ d: f[`${k}_d`].value, m: f[`${k}_m`].value, y: f[`${k}_y`].value, place: f[`${k}_place`].value, approx: f[`${k}_approx`].checked,
        h: { h_day: f[`${k}_hd`].value, h_month: f[`${k}_hm`].value, h_year: f[`${k}_hy`].value } });
      try {
        const saved = await api.saveRoots(id, { field, born: d('born'), died: d('died'), living: f.living.checked, note: f.note.value });
        Object.assign(p, saved); kinCache = null; dlg.close(); render();
      } catch (err) { const e = f.querySelector('.err'); e.textContent = err.message; e.hidden = false; }
    });
    dlg.showModal();
    return;
  }
  const body = field === 'names'
    ? `<div class="field-row">${input('he_first', t('heFirst'), p.he_first)}${input('he_last', t('heLast'), p.he_last)}</div>
       <div class="field-row">${input('en_first', t('enFirst'), p.en_first)}${input('en_last', t('enLast'), p.en_last)}</div>
       ${(() => {   // A title and a "known as" are for the few rabbis and well-known figures: out of the way for everyone else, and said plainly.
         const box = (name, label, value, hint, dir) => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value ?? '')}" placeholder="${esc(hint)}" dir="${dir}" maxlength="120" autocomplete="off" /></label>`;
         return `<details class="more-fields" ${p.title_he || p.title_en || p.known_he || p.known_en ? 'open' : ''}><summary>${t('rabbiFields')}</summary>
           <p class="dim-text">${t('titleHint')}</p>
           <div class="field-row">${box('title_he', t('titleHe'), p.title_he, 'ר׳ · הרב · הרבנית', 'rtl')}${box('title_en', t('titleEn'), p.title_en, "R' · Rabbi · Rebbetzin", 'ltr')}</div>
           <p class="dim-text">${t('knownHint')}</p>
           <div class="field-row">${box('known_he', t('knownHe'), p.known_he, 'אדמו״ר הזקן · הרמ״א', 'rtl')}${box('known_en', t('knownEn'), p.known_en, 'The Alter Rebbe · The Rema', 'ltr')}</div>
         </details>`;
       })()}
       <div class="seg" role="radiogroup" aria-label="${t('tribeLevi')} / ${t('tribeKohen')}">${[['', t('tribeNone')], ['levi', t('tribeLevi')], ['kohen', t('tribeKohen')]].map(([v, label]) => `
         <label><input type="radio" name="tribe" value="${v}" ${(p.tribe ?? '') === v ? 'checked' : ''} /><span>${label}</span></label>`).join('')}</div>
       ${p.hyd || (p.died?.y >= 1939 && p.died?.y <= 1945) ? `<label class="chk"><input type="checkbox" name="hyd" ${p.hyd ? 'checked' : ''} /> ${t('hydCheck')}</label>` : ''}
       <p>${t('oldNameKept')}</p>`
    : `<div class="field-row">
        <label class="field"><span>${t('day')}</span><select name="h_day"><option value="">—</option>${Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}" ${i + 1 === h.h_day ? 'selected' : ''}>${dayName(i + 1, L)}</option>`).join('')}</select></label>
        <label class="field grow"><span>${t('month')}</span><select name="h_month"><option value="">—</option>${pickerMonths(h.h_year ?? null).map((m) => `<option value="${m}" ${m === h.h_month ? 'selected' : ''}>${monthName(m, h.h_year || LEAP_REF, L)}</option>`).join('')}</select></label>
        <label class="field"><span>${t('yearIfKnown')}</span><input type="number" name="h_year" min="5000" max="6100" value="${h.h_year ?? ''}" /></label>
      </div>`;
  dlg.innerHTML = `<form method="dialog" class="sheet-form">
    <h2>${esc(field === 'names' ? t('editName') : t('yahrzeit'))} · <bdi>${esc(rootsFull(p))}</bdi></h2>
    ${body}
    <p class="err" hidden></p>
    <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button><button class="cta small">${t('save')}</button></div>
  </form>`;
  dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const data = field === 'names'
      ? { field, he_first: f.he_first.value, he_last: f.he_last.value, en_first: f.en_first.value, en_last: f.en_last.value, title_he: f.title_he.value, title_en: f.title_en.value, known_he: f.known_he.value, known_en: f.known_en.value, tribe: f.tribe.value, ...(f.hyd && { hyd: f.hyd.checked }) }   // הי"ד only offered for a death in 1939–1945 (or already marked)
      : { field, h_day: f.h_day.value, h_month: f.h_month.value, h_year: f.h_year.value, clear: !f.h_day.value && !f.h_month.value };
    try {
      const saved = await api.saveRoots(id, data);
      Object.assign(p, saved);
      kinCache = null;
      dlg.close();
      render();
    } catch (err) {
      const e = f.querySelector('.err'); e.textContent = err.message; e.hidden = false;
    }
  });
  dlg.showModal();
}

function rootsPage(id) {
  if (!state.roots) { loadRoots(); return hero({ left: backBtn() }) + `<main class="content"><p class="empty">${t('rootsLoading')}</p></main>${nav('search')}`; }
  const p = state.roots.byId.get(decodeURIComponent(id ?? ''));
  if (!p || p.hidden) return notFound();
  const L = getLang();
  const v = viewerFor(p.id);
  const rels = v ? relations(kin(), v, p.id) : [];
  const n = v ? dor(kin(), v, p.id) : null;
  const toName = (x) => (person(x) ? first(person(x)) : '');
  const F = p.sex === 'F';
  // Geni's places are long English addresses ("Brooklyn, New York, Kings County, …"): the town is enough,
  // kept apart from the Hebrew around it.
  const town = (x) => x?.place?.split(',')[0].replace(/\(.*?\)/g, '').trim();
  const place = (x) => (town(x) ? ` · \u2068${town(x)}\u2069` : '');
  const dates = [
    p.born?.y || p.born?.h || p.born?.place ? `${t(F ? 'bornF' : 'bornM')} ${[civilDate(p.born), p.born?.h && formatDate(p.born.h, L)].filter(Boolean).join(' · ')}${place(p.born)}`.trim() : '',
    // With a Hebrew date from the family: one line, it is also the yahrzeit. Otherwise Geni's calendar
    // date, and a converted yahrzeit marked "about" (Geni doesn't say whether it was after sunset).
    p.died?.h ? `🕯️ ${t(F ? 'diedF' : 'diedM')} ${[civilDate(p.died), formatDate(p.died.h, L)].filter(Boolean).join(' · ')}${place(p.died)}`
      : p.died?.y || p.died?.place ? `${t(F ? 'diedF' : 'diedM')} ${civilDate(p.died) || ''}${place(p.died)}`.trim() : '',
    !p.died?.h && p.died?.d && p.died?.m && p.died?.y ? `🕯️ ${t('yahrzeitAbout', L, formatDate(fromCivil(`${p.died.y}-${p.died.m}-${p.died.d}`), L))}` : '',
  ].filter(Boolean);
  const R = state.roots;
  const pc = p.parents && R.couples.find((c) => c.id === p.parents);
  const parents = pc ? [pc.a, pc.b].map((x) => R.byId.get(x)).filter((x) => x && !x.hidden) : [];
  const mine = R.couples.filter((c) => c.a === p.id || c.b === p.id);
  const spouses = mine.map((c) => R.byId.get(c.a === p.id ? c.b : c.a)).filter(Boolean);
  const kids = R.people.filter((x) => mine.some((c) => c.id === x.parents) && !x.hidden);
  // Brothers and sisters: the same parents, oldest first.
  const sibs = p.parents ? R.people.filter((x) => x.parents === p.parents && x.id !== p.id && !x.hidden).sort((a, b) => (a.born?.y ?? 9999) - (b.born?.y ?? 9999)) : [];
  const section = (title, list) => (list.length ? `<div class="sec-head"><h2>${title}</h2></div><div class="card list">${list.map(rootsLink).join('')}</div>` : '');
  const fromKin = p.kind === 'kin';   // from a sister family's tree (shown here, changed there)
  const near = nearFamous(p);
  const nearWords = near && ((L === 'he' ? near.f.notable_he || near.f.notable_en : near.f.notable_en || near.f.notable_he) ?? '');
  return hero({
    left: backBtn(),
    body: `<div class="profile-head">
      ${rootsAv(p, 'xl', { camera: !fromKin })}
      <div class="name-line"><h1 class="hello"><bdi>${esc(rootsName(p))}</bdi></h1>${fromKin ? '' : `<button type="button" class="pencil on-hero" data-act="roots-edit" data-field="names" data-id="${esc(p.id)}" aria-label="${esc(t('editName'))}">✏️</button>`}</div>
      ${rootsKnown(p) ? `<p class="dim"><bdi>${esc(rootsFull(p))}</bdi></p>` : ''}
      <p class="dim"><bdi>${esc(rootsName(p, otherLang()))}</bdi></p>
    </div>`,
  }) + `<main class="content">
    <div class="sec-head"><h2>${esc(v && v === api.me ? t('howRelated') : t('howRelatedTo', L, toName(v)))}</h2></div>
    <div class="card pad rel-card">
      ${rels.length ? rels.map((r) => `<details class="rel">
        <summary><b>${esc(r.label[L])}</b>${r.label.line ? `<span class="dim"> · ${esc(r.label.line[L])}</span>` : ''}</summary>
        ${pathSteps(r)}
      </details>`).join('') : `<p class="dim">${t('notRelated')}</p>`}
      ${n ? `<p class="dor">${t('dorLine', L, n, `<bdi>${esc(rootsName(p))}</bdi>`)}</p>` : ''}
      ${near ? `<p class="dor near"><bdi>${esc(near[L])}</bdi> <a href="#/roots/${encodeURIComponent(near.f.id)}"><bdi>${esc(rootsName(near.f))}</bdi></a>${nearWords && nearWords !== rootsName(near.f) ? `<span class="dim"> · <bdi>${esc(nearWords)}</bdi></span>` : ''}</p>` : ''}
    </div>
    ${hasChart() ? `<div class="card list"><a class="info-row t2-row" href="#/chart/${encodeURIComponent(p.id)}">
      <span class="tile sm lilac" aria-hidden="true">🌳</span>
      <span class="info-text"><span class="value">${t('viewInTree')}</span></span>
      <span class="link" aria-hidden="true">›</span></a></div>` : ''}
    <div class="sec-head"><h2>${t('datesNote')}</h2>${fromKin ? '' : `<button type="button" class="link" data-act="roots-edit" data-field="dates" data-id="${esc(p.id)}">${t('edit')}</button>`}</div>
    <div class="card pad dates-card">${dates.map((d) => `<p>${esc(d)}</p>`).join('') || `<p class="dim-text">${t('noDates')}</p>`}
      ${p.note ? `<div class="note">${noteHtml(p.note)}</div>` : ''}
</div>
    ${!fromKin && (p.notable_he || p.notable_en) ? `<div class="sec-head"><h2>${t('notableTitle')}</h2><button type="button" class="link" data-act="roots-edit" data-field="notable" data-id="${esc(p.id)}">${t('edit')}</button></div>
    <div class="card pad" dir="auto">${esc((getLang() === 'he' ? p.notable_he || p.notable_en : p.notable_en || p.notable_he) ?? '')}</div>` : ''}
    ${fromKin ? '' : `<div class="sec-head"><h2>${t('aboutTitle')}</h2><button type="button" class="link" data-act="roots-edit" data-field="about" data-id="${esc(p.id)}">${t(p.about ? 'edit' : 'add')}</button></div>
    ${p.about ? `<div class="card pad about-card" dir="auto">${aboutHtml(p.about)}</div>` : ''}
    <div class="card list">${p.died ? matzeivaRow(rootsMatzeivaOf(p.id) && api.rootsGalleryUrl(rootsMatzeivaOf(p.id)), 'roots-matzeiva', p.id, p.burial) : ''}${bookRow(p)}${rootsGalleryRow(p)}</div>`}
    ${parents.length ? `<div class="sec-head"><h2>${t('parents')}${p.parents_note ? ` <span class="unsure" title="${esc(t('parentsUnsure'))}">★</span>` : ''}</h2></div>
    <div class="card list">${parents.map(rootsLink).join('')}</div>
    ${p.parents_note ? `<div class="card pad about-card unsure-card" dir="auto"><p><b>★ ${t('parentsUnsure')}</b></p>${aboutHtml(p.parents_note)}</div>` : ''}` : ''}
    ${section(t('siblings'), sibs)}
    ${section(t('spouse'), spouses)}
    ${section(t('children'), kids)}
    ${sameNameSection(null, p)}
    ${fromKin ? '' : `<div class="card list items-card">${itemsRow(p.id)}</div>`}
    ${kinTreeCard(p)}
    ${geniUrl(p) ? `<p class="dim"><a href="${esc(geniUrl(p))}" target="_blank" rel="noopener">${t('fromGeni')}</a></p>` : ''}
  </main>${nav('search')}`;
}

function searchPage() {
  loadRoots();
  return hero({
    left: `<div class="title-block"><h1 class="hero-title">${t('searchTitle')}</h1><p class="dim">${t('searchTitle', otherLang())}</p></div>`,
    body: `<label class="search-box">${ICON.search}<input id="q" type="search" value="${esc(state.q ?? '')}" placeholder="${esc(t('searchPh'))}" aria-label="${esc(t('searchTitle'))}" autocomplete="off" enterkeyhint="search" /></label>`,
  }) + `<main class="content"><div id="roots-controls">${searchControls()}</div><div id="results" aria-live="polite">${searchResults()}</div>${localNote()}</main>${nav('search')}`;
}

// ---------- the tree ----------

/** Everyone in a couple's family: the two of them, their children and on down, each with the husband
 *  or wife who married in. The top couple's number is the whole tree. */
const members = (c) => [c.a, c.b].filter((id) => person(id)).length + childrenOf(c.id).reduce((n, k) => { const kc = coupleOf(k.id); return n + (kc ? members(kc) : 1); }, 0);

/** Couples on the way from the top of the tree down to `id`, so that branch starts open. */
function pathTo(id) {
  const open = new Set();
  for (let p = person(id), i = 0; p && i < 12; i++) {
    const c = p.parents ? couple(p.parents) : null;
    if (!c) { const sp = spouseOf(p.id); if (sp?.parents && sp !== p) { p = sp; continue; } break; }
    open.add(c.id);
    p = person(c.a)?.parents ? person(c.a) : person(c.b);
  }
  return open;
}

function treeNode(c) {
  const a = person(c.a), b = person(c.b);
  const kids = childrenOf(c.id);
  const mine = [c.a, c.b].includes(api.me);
  // Each avatar opens that person; the names open or close the branch below.
  const avLink = (p) => `<a class="tree-av" href="#/person/${p.id}" aria-label="${esc(full(p))}">${avatar(p, 'sm', { camera: false })}</a>`;
  const people = `<span class="pair">${avLink(a)}${b ? `${heart(c)}${avLink(b)}` : ''}</span>`;
  const other = [[a, b], [b, a]].filter(([p]) => p).map(([p, o]) => firstIn(p, otherLang()) && inCouple(p, o, firstIn(p, otherLang()), otherLang())).filter(Boolean).join(' & ');
  const names = `<span class="tree-names"><span class="title he">${esc(inCouple(a, b, first(a)))}${b ? ` & ${esc(inCouple(b, a, first(b)))}` : ''}</span>
    ${other ? `<span class="sub"><bdi>${esc(other)}</bdi></span>` : ''}</span>`;
  const you = mine ? `<span class="chip green">${t('you')}</span>` : '';
  // The eye opens the person's page, where everything about them can be edited; a couple's asks
  // whose page first. It doesn't open or close the branch.
  const pencil = b
    ? `<button type="button" class="pencil view" data-act="edit-couple" data-cid="${c.id}" aria-label="${esc(`${t('openProfile')}: ${coupleName(c)}`)}">${ICON.eye}</button>`
    : `<a class="pencil view" href="#/person/${a.id}" aria-label="${esc(`${t('openProfile')}: ${first(a)}`)}">${ICON.eye}</a>`;
  if (!kids.length) return `<div class="tree-leaf couple">${people}<a class="tree-names-link" href="#/person/${a.id}">${names}</a>${you}${pencil}</div>`;
  const open = state.treeOpen.has(c.id);
  return `<details class="tree-node" data-couple="${c.id}" ${open ? 'open' : ''}>
    <summary>${people}${names}${you}<span class="tree-count" title="${esc(t('nMembers', getLang(), members(c)))}"><span class="sr-only">${esc(t('nMembers', getLang(), members(c)))}</span><span aria-hidden="true">${members(c)}</span></span>${pencil}</summary>
    <div class="tree-kids">${kids.map((k) => {
      const kc = coupleOf(k.id);
      if (kc) return treeNode(kc);
      return `<div class="tree-leaf"><a class="tree-leaf-link" href="#/person/${k.id}">${avatar(k, 'xs', { camera: false })}<span class="title he">${esc(withZl(k, first(k)))}</span>${k.id === api.me ? `<span class="chip green">${t('you')}</span>` : ''}</a>
        <a class="pencil view" href="#/person/${k.id}" aria-label="${esc(`${t('openProfile')}: ${first(k)}`)}">${ICON.eye}</a></div>`;
    }).join('')}</div>
  </details>`;
}

// ---------- PDF export (pdf.js lays the pages out; these say what goes on them) ----------

/** One person for the PDF: full name with the namesake tag where it's needed, and ז"ל. */
const pdfName = (x, L) => withZl(x, named(x, L), L);
const pdfBirthday = (x, L) => (x.h_day ? `${t('birthday', L)} ${formatDate(x, L)}` : '');
/** Someone's dates for the family book: birthday, and the yahrzeit of someone ז"ל. */
const pdfDates = (x, L) => [pdfBirthday(x, L), x.d_day ? `${t('yahrzeit', L)} ${formatDate({ h_day: x.d_day, h_month: x.d_month, h_year: x.d_year }, L)}` : '']
  .filter(Boolean).join(', ');

/** The family book: every couple from the top down, their children indented under them, in birth order. */
function familyBookBlocks(L) {
  const blocks = [], seen = new Set();
  const walk = (c, depth, born = null) => {
    if (!c || seen.has(c.id)) return;
    seen.add(c.id);
    const pair = [person(c.a), person(c.b)].filter(Boolean);
    if (born) pair.sort((x, y) => (x.id === born.id ? -1 : y.id === born.id ? 1 : 0));   // the one born into the family first
    const sub = [
      pair.map((x) => pdfDates(x, L) && (pair.length > 1 ? `${first(x, L)}: ${pdfDates(x, L)}` : pdfDates(x, L))).filter(Boolean).join(' · '),
      c.w_day ? `${t(isEngaged(c) ? 'wedding' : 'anniversary', L)} ${formatDate({ h_day: c.w_day, h_month: c.w_month, h_year: c.w_year }, L)}` : '',
      pair.map(cityOf).find(Boolean) ?? '',
    ].filter(Boolean).join(' · ');
    const kids = childrenOf(c.id);
    blocks.push({ type: 'item', text: pair.map((x) => inCouple(x, pair.find((y) => y !== x), named(x, L), L)).join(' & '), sub, depth, bold: true, keepWithNext: kids.length > 0 });
    for (const k of kids) {
      const kc = coupleOf(k.id);
      if (kc && kc.id !== c.id) walk(kc, depth + 1, k);
      else blocks.push({ type: 'item', text: pdfName(k, L), sub: [pdfDates(k, L), cityOf(k)].filter(Boolean).join(' · '), depth: depth + 1 });
    }
  };
  walk(rootCouple(), 0);
  return blocks;
}

/** The birthday calendar for Hebrew year `hy`: every birthday, anniversary and yahrzeit on its date
 *  that year (Adar per the year, as in "coming up"), month by month from Tishrei, with the number —
 *  age, years married, which yahrzeit — when the year is known. */
function calendarBlocks(L, hy) {
  const entries = [
    ...state.people.filter((p) => !p.deceased).map((p) => ({ kind: 'birthday', h_day: p.h_day, h_month: p.h_month, h_year: p.h_year, name: pdfName(p, L) })),
    ...state.couples.filter(liveAnniversary).map((c) => ({ kind: 'anniversary', h_day: c.w_day, h_month: c.w_month, h_year: c.w_year, name: `${coupleName(c, L)} ${last(person(c.a), L)}`.trim() })),
    ...state.people.filter((p) => p.d_day).map((p) => ({ kind: 'yahrzeit', h_day: p.d_day, h_month: p.d_month, h_year: p.d_year, name: pdfName(p, L) })),
  ];
  const label = ({ entry, years }) => (years == null ? t(entry.kind, L)
    : entry.kind === 'birthday' ? t('turns', L, years) : entry.kind === 'anniversary' ? t('yearsMarried', L, years) : t('yahrzeitN', L, years));
  // An engaged couple's wedding, when it falls in this year.
  const weddings = state.couples.filter(isEngaged).map((c) => ({ c, hd: weddingDay(c) })).filter((x) => x.hd?.getFullYear() === hy)
    .map(({ c, hd }) => ({ entry: { kind: 'wedding', name: `${coupleName(c, L)} ${last(person(c.a), L)}`.trim() }, hd, years: null }));
  const all = [...inYear(entries, hy), ...weddings];
  const blocks = [];
  for (const m of monthsOfYear(hy)) {
    const rows = all.filter((x) => x.hd.getMonth() === m).sort((a, b) => a.hd.getDate() - b.hd.getDate() || a.entry.name.localeCompare(b.entry.name));
    if (!rows.length) continue;
    blocks.push({ type: 'heading', text: monthName(m, hy, L) });
    for (const x of rows) blocks.push({ type: 'item', text: `${dayName(x.hd.getDate(), L)} · ${x.entry.name} — ${label(x)}` });
  }
  return blocks;
}

/** Makes the chosen PDF and hands it over: the share sheet on a phone (WhatsApp, Files…), else a download. */
async function exportPdf(kind) {
  const L = getLang();
  const { makePdf } = await import('./pdf.js');
  const book = kind === 'book';
  // Dates are Jewish dates: "made on" today's, and the calendar is for the current Hebrew year.
  const now = new HDate(new Date());
  const hy = now.getFullYear();
  const today = formatDate({ h_day: now.getDate(), h_month: now.getMonth(), h_year: hy }, L);
  const yearName = formatDate({ h_day: 1, h_month: 7, h_year: hy }, L).split(' ').pop();   // תשפ״ז / 5787
  const blob = await makePdf({
    rtl: L === 'he',
    title: `${t('treeOf', L, t('appName', L))} — ${t(book ? 'pdfBook' : 'pdfCalendar', L)}${book ? '' : ` ${yearName}`}`,
    subtitle: [t('pdfPeople', L, state.people.length), t('madeOn', L, today)].join(' · '),
    footer: location.hostname,
    blocks: book ? familyBookBlocks(L) : calendarBlocks(L, hy),
  });
  const name = `${FAMILY.en}-${book ? 'family-book' : `birthdays-${hy}`}.pdf`;
  const file = new File([blob], name, { type: 'application/pdf' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

function pdfSheet() {
  const dlg = $('#sheet');
  const choice = (kind, key) => `<button type="button" class="person-row empty-row pdf-choice" data-kind="${kind}">
      <span class="person-text"><span class="title">${t(key)}</span><span class="sub">${t(`${key}Sub`)}</span></span><span class="chip lilac">PDF</span></button>`;
  dlg.innerHTML = `<form method="dialog" class="sheet-form"><h2>${t('pdfTitle')}</h2>
    <div class="card list">${choice('book', 'pdfBook')}${choice('calendar', 'pdfCalendar')}</div>
    <p class="pdf-busy" hidden>${t('pdfMaking')}</p><p class="err" hidden></p>
    <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button></div></form>`;
  dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
  dlg.querySelectorAll('.pdf-choice').forEach((btn) => btn.addEventListener('click', async () => {
    const busy = dlg.querySelector('.pdf-busy'), err = dlg.querySelector('.err');
    busy.hidden = false; err.hidden = true;
    dlg.querySelectorAll('.pdf-choice').forEach((b) => { b.disabled = true; });
    try { await exportPdf(btn.dataset.kind); dlg.close(); } catch (e) { err.textContent = e.message; err.hidden = false; }
    finally { busy.hidden = true; dlg.querySelectorAll('.pdf-choice').forEach((b) => { b.disabled = false; }); }
  }));
  dlg.showModal();
}

/** "Export this branch". Exporting is off for everyone until the app admin turns it on for a
 *  person (people.can_export, set in the database), so this first asks the server: when it's off, the
 *  sheet offers to ask the admin on WhatsApp; when it's on, it says what the file is for, makes it
 *  (src/export.js) and downloads it. */
async function exportSheet(coupleId) {
  const dlg = $('#sheet');
  const n = branchMembers(coupleId).size;
  const L = getLang();
  const title = `<h2>${t('exportTitle')} · ${esc(coupleName(couple(coupleId)))}</h2>`;
  const cancel = `<button type="button" class="pill" data-sheet="cancel">${t('close')}</button>`;
  dlg.innerHTML = `<form method="dialog" class="sheet-form">${title}<p class="pdf-busy">${t('exportChecking')}</p><div class="actions">${cancel}</div></form>`;
  dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
  dlg.showModal();
  let allowed = false;
  try {
    const res = await fetch(`/api/export/${coupleId}?check=1`, { headers: { 'x-editor': api.me ?? '' } });
    allowed = res.ok && (await res.json()).allowed === true;
  } catch { /* no answer: treated as off */ }
  if (!dlg.open) return;
  if (!allowed) {
    // Ask the admin, with who is asking and for which branch (and the two ids the admin needs).
    const admin = person(adminOf(FAMILY)), wa = admin && !admin.deceased && waNumber(admin.phone);
    const me = person(api.me);
    const msg = `${t('exportAsk', L, fullIn(me, L) || full(me), coupleName(couple(coupleId)), t('treeOf', L, t('appName', L)))}\n\n${t('exportAskRef', L, api.me, coupleId)}`;
    dlg.innerHTML = `<form method="dialog" class="sheet-form">${title}
      <p>${t('exportOff')}</p>
      <p>${wa ? t('exportOffAsk', L, first(admin)) : t('exportOffNoAdmin')}</p>
      <div class="actions">${cancel}
        ${wa ? `<a class="btn-sm wa-btn" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ICON.whatsapp}<span>${t('exportAskBtn', L, first(admin))}</span></a>` : ''}</div></form>`;
    dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
    return;
  }
  // What to take: the information alone is small and quick, for checking what's new; pictures
  // make a bigger file (much bigger at full quality).
  const choice = (kind, key) => `<button type="button" class="person-row empty-row pdf-choice" data-kind="${kind}">
      <span class="person-text"><span class="title">${t(key)}</span><span class="sub">${t(`${key}Sub`)}</span></span><span class="chip lilac">ZIP</span></button>`;
  dlg.innerHTML = `<form method="dialog" class="sheet-form">${title}
    <p>${t('exportIntro', L, n)}</p>
    <div class="card list">${choice('none', 'exportInfo')}${choice('small', 'exportPhotos')}${choice('full', 'exportFull')}</div>
    <p>${t('exportHow')}</p>
    <p class="pdf-busy" hidden></p><p class="err" hidden></p>
    <div class="actions">${cancel}</div></form>`;
  const busy = dlg.querySelector('.pdf-busy'), err = dlg.querySelector('.err');
  const choices = [...dlg.querySelectorAll('.pdf-choice')];
  dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
  choices.forEach((btn) => btn.addEventListener('click', async () => {
    choices.forEach((x) => { x.disabled = true; });
    err.hidden = true; busy.hidden = false; busy.textContent = t('pdfMaking');
    try {
      const { exportBranch } = await import('./export.js');
      const { blob, name } = await exportBranch(coupleId, {
        me: api.me, photos: btn.dataset.kind,
        progress: (done, total) => { busy.textContent = t('exportProgress', L, done, total); },
      });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      dlg.close();
    } catch (e) { err.textContent = e.message; err.hidden = false; }
    finally { busy.hidden = true; choices.forEach((x) => { x.disabled = false; }); }
  }));
}

function treePage() {
  const root = rootCouple();
  if (!root) return emptyTree();
  if (!state.treeOpen) state.treeOpen = new Set([root.id, ...(api.me ? pathTo(api.me) : [])]);
  // The drawn tree of the earlier generations: only on a site with earlier roots (remembered from the last
  // visit, so the button is there at once and the list doesn't jump when the roots come in).
  loadRoots();
  const earlier = hasChart();
  return hero({
    left: `<div class="title-block"><h1 class="hero-title">${t(earlier ? 'relativesTitle' : 'treeTitle')}</h1><p class="dim">${t(earlier ? 'relativesTitle' : 'treeTitle', otherLang())}</p></div>`,
    center: `<button type="button" class="pill-pdf" data-act="pdf">📄 PDF</button>`,
  }) + `<main class="content tree">${treeNode(root)}
    <div class="profile-foot"><a class="escape quiet" href="#/archived">${t('archivedLink', getLang(), state.archived.length)}</a></div>
    ${localNote()}</main>${nav(earlier ? 'relatives' : 'tree')}`;
}

// ---------- the drawn tree (#/chart, from the Tree tab): someone's ancestors, on up into the earlier roots ----------
// One person, their ancestors above, their
// husband or wife beside them, descendants below as far as the settings say. Here the people come from two
// places, the tree and the earlier roots, so the layout works on "nodes": { id, t } for someone in the tree,
// { id, r } for someone only in the roots (a roots person who is also in the tree is the tree's node).
// Only on a site that has earlier roots.
// mx, my: empty room beside and under the tree, so anything can be dragged clear of the zoom buttons
const T2 = { W: 150, H: 64, gap: 14, row: 64 + 58, pad: 40, mx: 110, my: 130 };
// "My tree" beside the zoom buttons: a target, drawn in the bottom bar's line style.
const STACK_TRUNK = 28, STACK_GAP = 34;   // the stacked generation: room for its trunk, and between one card and the next (see down() in t2layout)
const T2_ME = '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><circle cx="11" cy="11" r="1.5" fill="currentColor" stroke="none"/><path d="M11 2v3M11 17v3M2 11h3M17 11h3"/></svg>';
const t2 = (() => {
  let saved = {};
  try { saved = JSON.parse(storeGet('tree.t2b') || '{}'); } catch { /* not there */ }   // 'tree.t2b': choices made before the default changed are let go
  return { anc: saved.anc ?? 3, desc: saved.desc ?? 3, sib: saved.sib ?? (saved.direct === false ? 99 : 0), both: saved.both ?? false, zoom: 1, pos: {} };   // three generations of descendants to start with, so people see them
})();
const t2save = () => storeSet('tree.t2b', JSON.stringify({ anc: t2.anc, desc: t2.desc, sib: t2.sib, both: t2.both }));
let t2nodes = new Map();   // id -> node, for one drawing
const t2T = (p) => (p ? t2nodes.get(p.id) ?? t2nodes.set(p.id, { id: p.id, t: p }).get(p.id) : null);
const t2R = (r) => (!r || r.hidden ? null : r.main_person && person(r.main_person) ? t2T(person(r.main_person))
  : t2nodes.get(r.id) ?? t2nodes.set(r.id, { id: r.id, r }).get(r.id));
const t2of = (id) => (id ? t2T(person(id)) ?? t2R(state.roots?.byId.get(id)) : null);
const t2sex = (n) => (n.t ? sexOf(n.t) : n.r.sex?.toLowerCase()) || null;
const t2name = (n, l = getLang()) => (n.t ? withZl(n.t, full(n.t, l) || first(n.t, l), l) : rootsWithZl(n.r, rootsKnown(n.r, l) || rootsPlain(n.r, l), l));   // no title or הכהן / הלוי: too long for a card
const t2first = (n, l = getLang()) => (n.t ? first(n.t, l) : (l === 'he' ? n.r.he_first || n.r.en_first : n.r.en_first || n.r.he_first) ?? '');
const t2href = (n) => (n.t ? `#/person/${n.id}` : `#/roots/${encodeURIComponent(n.id)}`);
const t2byYear = (a, b) => (a.born?.y ?? 9999) - (b.born?.y ?? 9999);
/** The years on a card: from the roots as they are; in the tree only for someone who has passed away.
 *  Kept left to right (born–died) inside Hebrew too. */
const t2years = (n) => { const y = t2yearsOf(n); return y ? `\u2066${y}\u2069` : ''; };
function t2yearsOf(n) {
  if (n.r) return [n.r.born?.y, n.r.died?.y].some(Boolean) ? `${n.r.born?.y ?? ''}–${n.r.died?.y ?? ''}` : '';
  const p = n.t;
  if (!p.deceased) return '';
  const y = (d, m, hy) => { if (!hy) return ''; try { return d && m ? new HDate(d, m, hy).greg().getFullYear() : hy - 3760; } catch { return hy - 3760; } };
  const b = y(p.h_day, p.h_month, p.h_year), d = y(p.d_day, p.d_month, p.d_year);
  return b || d ? `${b}–${d}` : '';
}
/** { f, m }: father and mother (either may be missing). Someone with no parents in the tree goes on in the roots. */
function t2parents(n) {
  const c = n.t?.parents && couple(n.t.parents);
  const ps = (n.t ? (c ? [person(c.a), person(c.b)].map(t2T) : rootsParents(n.t).map(t2R)) : rootsParentsOf(n.r).map(t2R)).filter(Boolean);
  const m = ps.find((x) => t2sex(x) === 'f'), f = ps.find((x) => x !== m);
  return { f, m };
}
/** Brothers and sisters, oldest first. */
function t2sibs(n) {
  if (n.t?.parents) return state.people.filter((x) => x.parents === n.t.parents && x.id !== n.id).sort(byBirth).map(t2T);
  const r = n.r ?? state.roots.byMain.get(n.id);
  if (!r?.parents) return [];
  return state.roots.people.filter((x) => x.parents === r.parents && x.id !== r.id && !x.hidden).sort(t2byYear).map(t2R).filter(Boolean);
}
/** [{ c, s }]: each marriage (c says where it is: { tree: id } or { roots: id }) and the husband or wife. */
const t2spouses = (n) => (n.t
  ? state.couples.filter((c) => c.a === n.id || c.b === n.id).map((c) => ({ c: { tree: c.id }, s: t2T(person(c.a === n.id ? c.b : c.a)) }))
  : state.roots.couples.filter((c) => c.a === n.id || c.b === n.id).map((c) => ({ c: { roots: c.id }, s: t2R(state.roots.byId.get(c.a === n.id ? c.b : c.a)) }))
).filter((x) => x.s);
/** Like t2spouses, but a family with no husband or wife on record stays in (s is null), so its children still show. */
const t2families = (n) => (n.t
  ? state.couples.filter((c) => c.a === n.id || c.b === n.id).map((c) => ({ c: { tree: c.id }, s: t2T(person(c.a === n.id ? c.b : c.a)) ?? null }))
  : state.roots.couples.filter((c) => c.a === n.id || c.b === n.id).map((c) => ({ c: { roots: c.id }, s: t2R(state.roots.byId.get(c.a === n.id ? c.b : c.a)) ?? null }))
);
const t2kids = (c) => (c.tree ? childrenOf(c.tree).map(t2T)
  : state.roots.people.filter((x) => x.parents === c.roots && !x.hidden).sort(t2byYear).map(t2R).filter(Boolean));

/** The layout: cards [{ p, x, y, more, n }] and lines [{ x1, y1, x2, y2, wed }] in canvas pixels, left to right
 *  (the father's side on the right, as the page reads). */
function t2layout(root, o = t2) {
  const { W, H, gap, row } = T2;
  const cards = [], lines = [];
  const line = (x1, y1, x2, y2, wed = false) => lines.push({ x1, y1, x2, y2, wed });
  // Ancestors, upward: each couple together, centred under his parents and hers (see pairOf below).
  // A "unit" is an ancestor with (unless direct only) their brothers and sisters, the ancestor on the inner side.
  function ancestors(rootCx, rootY) {
    const rowUnits = [{ members: [root], k: 0, cx: rootCx, y: rootY, depth: 0 }];
    // Both sides at once (the gear): the husband's or wife's ancestors go up too, from their card beside the root's
    // (to its left). The rows are packed as one, so the two sides stand side by side and the lines bend to them.
    const sp = o.both ? t2spouses(root)[0]?.s : null;
    const two = Boolean(sp && Object.values(t2parents(sp)).some(Boolean));
    if (two) { rowUnits[0].grp = 'r'; rowUnits.unshift({ members: [sp], k: 0, cx: rootCx - (W + gap), y: rootY, depth: 0, grp: 's' }); }
    // The two sides keep to their own half: a line between the couple, each side packed on its own side of it with
    // room between, and a faint dashed line up the middle to mark them apart.
    const border = rootCx - (W + gap) / 2, SIDE_GAP = W * 0.9;
    let top = rootY;
    // Not direct ancestors only: the root's own brothers and sisters stand beside them on their row (away from the
    // husband or wife), joined to the same parents; single cards, each one's own tree a tap away. In both sides at
    // once the husband's or wife's stand on their far side too (not when there is more than one marriage beside them).
    // (o.sib: for how many generations, counting the root's own row as the first, brothers and sisters are shown;
    // never on a row whose parents are not on the screen, where there would be no line to say whose they are.)
    if (o.sib > 0 && o.anc >= 1) {
      const oneWed = t2spouses(root).length <= 1;
      for (const u of rowUnits) {
        const p = u.members[0], side = u.grp === 's' ? -1 : 1;
        if (side < 0 && !oneWed) continue;
        if (!Object.values(t2parents(p)).some(Boolean)) continue;
        const sibs = t2sibs(p);
        if (!sibs.length) continue;
        u.members = side < 0 ? [...sibs].reverse().concat(p) : [p, ...sibs];
        u.k = side < 0 ? u.members.length - 1 : 0;
        u.centers = u.members.map((q, j) => {
          const cx = u.cx + (j - u.k) * (W + gap);
          if (j !== u.k) cards.push({ p: q, x: cx - W / 2, y: rootY });
          return cx;
        });
      }
    }
    // The ancestors above each of them, as a tree of couples. A couple stands together, centred under his parents
    // and hers; each part of the tree is as wide as its rows need (kept apart row by row, so a short branch tucks
    // in beside a tall one), and the rows below spread to stay under it. So a line bends only as far as it must.
    const S = W + gap * 2, G = gap * 2;
    const off = (u) => u.k * (W + gap) + W / 2, width = (u) => u.members.length * W + (u.members.length - 1) * gap;
    const mk = (p, side, depth) => {
      const members = [p, ...(depth < o.sib && depth < o.anc ? t2sibs(p) : [])];
      if (side < 0) members.reverse();
      return { members, k: side < 0 ? members.length - 1 : 0, depth, side };
    };
    // ext: for each row a part of the tree reaches, how far left and right it goes ([lo, hi] by depth).
    const join = (ext, other, dx) => other.forEach((e, d) => { ext[d] = ext[d] ? [Math.min(ext[d][0], e[0] + dx), Math.max(ext[d][1], e[1] + dx)] : [e[0] + dx, e[1] + dx]; });
    /** The parents of a unit's ancestor with all that is above them, measured from the couple's middle (where the
     *  line down to the child starts): { us: the one or two units and where, subs: each one's own parents and where }. */
    function pairOf(c) {
      const depth = c.depth + 1;
      if (depth > o.anc) return null;
      const par = t2parents(c.members[c.k]);
      if (!par.m && !par.f) return null;
      const both = Boolean(par.m && par.f);
      const us = both ? [{ u: mk(par.m, -1, depth), dx: -S / 2 }, { u: mk(par.f, 1, depth), dx: S / 2 }]
        : [{ u: mk(par.m || par.f, par.m ? -1 : 1, depth), dx: 0 }];
      const ext = [];
      for (const { u, dx } of us) { const own = []; own[depth] = [-off(u), width(u) - off(u)]; join(ext, own, dx); }
      const subs = us.map(({ u, dx }) => ({ pair: pairOf(u), dx })).filter((x) => x.pair);
      if (subs.length === 2) {   // his parents and hers: as close as their rows allow, the couple under the middle
        const [a, b] = subs;
        let D = 0;
        a.pair.ext.forEach((e, d) => { if (b.pair.ext[d]) D = Math.max(D, e[1] - b.pair.ext[d][0] + G); });
        a.dx = -D / 2; b.dx = D / 2;
      }
      for (const x of subs) join(ext, x.pair.ext, x.dx);
      return { c, depth, us, subs, ext, both };
    }
    const fams = [];   // by depth: each family's line down, drawn once the whole row is known
    function place(pair, mid) {
      const y = rootY - pair.depth * row;
      top = Math.min(top, y);
      for (const { u, dx } of pair.us) {
        u.cx = mid + dx; u.y = y;
        const left = u.cx - off(u);
        u.centers = u.members.map((q, j) => {
          const cx = left + j * (W + gap) + W / 2;
          cards.push({ p: q, x: cx - W / 2, y, more: pair.depth === o.anc && j === u.k && Object.values(t2parents(q)).some(Boolean) });
          return cx;
        });
      }
      const c = pair.c, kids = c.centers ?? [c.cx];
      let from = y + H;
      if (pair.both) { line(pair.us[0].u.cx + W / 2, y + H / 2, pair.us[1].u.cx - W / 2, y + H / 2, true); from = y + H / 2; }
      (fams[pair.depth] ??= []).push({ c, kids, mid, from, lo: Math.min(mid, ...kids), hi: Math.max(mid, ...kids), lvl: 0 });
      pair.us.forEach(({ u }) => { const x = pair.subs.find((q) => q.pair.c === u); if (x) place(x.pair, mid + x.dx); });
    }
    for (const u of rowUnits) {
      const pair = pairOf(u);
      if (!pair) continue;
      // straight above them; with both sides at once, each side moved off the line between the couple
      const lo = Math.min(...pair.ext.filter(Boolean).map((e) => e[0])), hi = Math.max(...pair.ext.filter(Boolean).map((e) => e[1]));
      const mid = !two ? u.cx : u.grp === 's' ? Math.min(u.cx, border - SIDE_GAP / 2 - hi) : Math.max(u.cx, border + SIDE_GAP / 2 - lo);
      place(pair, mid);
    }
    // Where a line still has to bend, one family's bar could run into the next one's at the same height and read
    // as one long line. So bars that overlap go at different heights: when the parents stand to the right of their
    // children, the family further left gets the higher bar (and the other way round), which also keeps one
    // family's lines from crossing the other's.
    const PAD = 10, meets = (a, b) => a.lo - PAD <= b.hi && b.lo - PAD <= a.hi;
    const lean = (f) => f.mid - (Math.min(...f.kids) + Math.max(...f.kids)) / 2;
    fams.forEach((rowFams) => {
      const bent = rowFams.filter((f) => f.hi - f.lo > 1), done = [];
      for (const f of [...bent.filter((x) => lean(x) >= 0).sort((a, b) => b.lo - a.lo), ...bent.filter((x) => lean(x) < 0).sort((a, b) => a.hi - b.hi)]) {
        f.lvl = Math.max(-1, ...done.filter((g) => meets(f, g)).map((g) => g.lvl)) + 1;
        done.push(f);
      }
      const levels = Math.max(0, ...rowFams.map((f) => f.lvl));
      const step = levels ? Math.min(9, 28 / levels) : 0;
      for (const f of rowFams) {
        const bar = f.c.y - (levels ? 12 : 22) - f.lvl * step;
        line(f.mid, f.from, f.mid, bar);
        line(f.lo, bar, f.hi, bar);
        f.kids.forEach((x) => line(x, bar, x, f.c.y));
      }
    });
    if (two && top < rootY) lines.push({ x1: border, y1: top - 6, x2: border, y2: rootY - 34, mark: true });
  }
  // Descendants, downward: someone, their husband or wife beside them (to the left), each couple's children below.
  function down(p, depth) {
    // a family with no husband or wife on record still counts when it has children: they hang straight under this card
    const fams = t2families(p).map(({ c, s }) => ({ s, kids: depth < o.desc ? t2kids(c).map((kid) => down(kid, depth + 1)) : [] }))
      .filter((f) => f.s || f.kids.length);
    const nSp = fams.filter((f) => f.s).length;
    const selfW = (1 + nSp) * W + nSp * gap;
    // One generation goes one under the other instead of side by side, so the tree is far less wide. It is the
    // third generation down, or the last one shown when fewer are; a generation below it (small families, as a
    // rule) sits under each of them as usual.
    const stack = depth + 1 === Math.min(o.desc, 3);
    const stacked = (f) => stack && f.kids.length > 1;
    const colW = (f) => Math.max(...f.kids.map((x) => x.w));
    const kw = fams.map((f) => (stacked(f) ? colW(f) + STACK_TRUNK : f.kids.reduce((n, x) => n + x.w, 0) + Math.max(0, f.kids.length - 1) * gap));
    const allKids = kw.reduce((n, x) => n + x, 0) + Math.max(0, fams.filter((f) => f.kids.length).length - 1) * gap * 2;
    const w = Math.max(selfW, allKids);
    // how far down this person's part of the tree goes, from the top of their own card
    const below = fams.map((f) => (!f.kids.length ? 0 : stacked(f) ? f.kids.reduce((n, x) => n + x.h, 0) + (f.kids.length - 1) * STACK_GAP : Math.max(...f.kids.map((x) => x.h))));
    const h = Math.max(...below, 0) ? row + Math.max(...below) : H;
    return { w, h, place(left, y) {
      const cx = left + (w - selfW) / 2 + selfW - W / 2;
      cards.push({ p, x: cx - W / 2, y });
      let kx = left + (w - allKids) / 2;
      let si = 0;
      fams.forEach((f) => {
        let mid, from;
        if (f.s) {
          const sx = cx - ++si * (W + gap);
          cards.push({ p: f.s, x: sx - W / 2, y });
          line(sx + W / 2, y + H / 2, sx + W / 2 + gap, y + H / 2, true);
          mid = sx + W / 2 + gap / 2; from = y + H / 2;
        } else { mid = cx; from = y + H; }   // no husband or wife on record: the line comes down from this card
        if (!f.kids.length) return;
        const bar = y + H + 22;
        if (stacked(f)) {
          // a column, each child's part of the tree at its right edge, and a trunk down the right side with a branch to each child
          const right = kx + colW(f), trunk = right + STACK_TRUNK / 2;
          let ky = y + row, last = ky;
          f.kids.forEach((kid) => {
            const cxk = kid.place(right - kid.w, ky);
            line(cxk + W / 2, ky + H / 2, trunk, ky + H / 2);
            last = ky; ky += kid.h + STACK_GAP;
          });
          line(mid, from, mid, bar);
          line(Math.min(mid, trunk), bar, Math.max(mid, trunk), bar);
          line(trunk, bar, trunk, last + H / 2);
          kx += colW(f) + STACK_TRUNK + gap * 2;
          return;
        }
        const kc = f.kids.map((kid) => { const cxk = kid.place(kx, y + row); kx += kid.w + gap; return cxk; });
        kx += gap;
        line(mid, from, mid, bar);
        line(Math.min(mid, ...kc), bar, Math.max(mid, ...kc), bar);
        kc.forEach((c) => line(c, bar, c, y + row));
      });
      return cx;
    } };
  }
  // The root's row and the descendants first; the ancestors then go up from the root's place.
  const rootY = o.anc * row;
  const rootCx = down(root, 0).place(0, rootY);
  ancestors(rootCx, rootY);
  const minX = Math.min(...cards.map((c) => c.x)), minY = Math.min(...cards.map((c) => c.y));
  const dx = T2.pad - minX, dy = T2.pad + 14 - minY;
  cards.forEach((c) => { c.x += dx; c.y += dy; });
  lines.forEach((l) => { l.x1 += dx; l.x2 += dx; l.y1 += dy; l.y2 += dy; });
  const counts = new Map();
  cards.forEach((c) => counts.set(c.p.id, (counts.get(c.p.id) ?? 0) + 1));
  cards.forEach((c) => { c.n = counts.get(c.p.id); });
  return { cards, lines, width: Math.max(...cards.map((c) => c.x + W)) + T2.pad, height: Math.max(...cards.map((c) => c.y + H)) + T2.pad + 20 };
}

function t2card(c, root) {
  const { W, H } = T2, n = c.p, L = getLang(), f = t2sex(n) === 'f';
  // the years only when the name leaves room for them (about two lines' worth)
  const nm = t2name(n, L), yrs = nm.length <= 24 ? t2years(n) : '';
  const url = t2pic(n);
  const pic = url ? `<img src="${esc(url)}" alt="" loading="lazy" />` : esc((t2first(n, 'he') || nm || '?')[0]);
  const id = esc(n.id);
  return `<div class="t2-card ${f ? 'f' : 'm'}${n.id === root.id ? ' root' : ''}" style="left:${c.x}px;top:${c.y}px;width:${W}px;height:${H}px">
    <button type="button" class="t2-body" data-act="t2-card" data-id="${id}"><span class="t2-pic">${pic}</span><span class="t2-txt"><b>${esc(nm)}</b>${yrs ? `<span>${esc(yrs)}</span>` : ''}</span></button>
    <button type="button" class="t2-tab" data-act="t2-root" data-id="${id}" aria-label="${esc(t('t2TreeOf', L, t2first(n, L)))}">${ICON.tree}</button>
    ${c.more ? `<button type="button" class="t2-more" data-act="t2-root" data-id="${id}">+ ${esc(t('t2More'))}</button>` : ''}
    ${c.n > 1 ? `<span class="t2-dup" title="${esc(t('t2Dup', L, c.n))}">×${c.n}</span>` : ''}
  </div>`;
}

/** The page: the top couple's husband to start with (#/chart), or anyone (#/chart/<id>, a tree or a roots id). */
function chartPage(id) {
  const head = hero({ left: backBtn(), center: `<h1 class="hero-title t2-title">${t('t2FamilyTree')}</h1>`, });
  if (!state.roots) { loadRoots(); return head + `<main class="content"><p class="empty">${t('rootsLoading')}</p></main>${nav('tree')}`; }
  t2nodes = new Map();
  const rc = rootCouple();
  // The drawn tree opens on the top couple's husband, or on the wife where the family says so (families.mjs: chart).
  const sw = [...new Set([...(FAMILY.chart === 'wife' ? [rc?.b, rc?.a] : [rc?.a, rc?.b]), api.me])].map(t2of).filter(Boolean);
  const root = t2of(decodeURIComponent(id ?? '')) ?? sw[0];
  if (!root) return notFound();
  const lay = t2layout(root);
  t2.last = { lay, root };   // for saving it as a picture
  const svg = `<svg class="t2-lines" width="${lay.width}" height="${lay.height}" aria-hidden="true">${lay.lines.map((l) => `<path d="M${l.x1} ${l.y1}L${l.x2} ${l.y2}" class="${l.wed ? 'wed' : l.mark ? 'mark' : ''}"/>`).join('')}</svg>`;
  const z = t2.zoom;
  return head + `<main class="content t2-main">
    <div class="t2-switch">${sw.map((n) => `<button type="button" class="${root.id === n.id ? 'on' : ''}" data-act="t2-root" data-id="${esc(n.id)}">${esc(n.t ? withZl(n.t, t2first(n)) : t2first(n))}</button>`).join('')}</div>
    <div class="t2-wrap${t2.full ? ' full' : ''}" id="t2-wrap" dir="ltr" data-key="${esc(root.id)}">
      <div class="t2-canvas" style="width:${lay.width * z + 2 * T2.mx}px;height:${lay.height * z + T2.my}px"><div class="t2-inner" dir="ltr" style="left:${T2.mx}px;width:${lay.width}px;height:${lay.height}px;transform:scale(${z})">${svg}${lay.cards.map((c) => t2card(c, root)).join('')}</div></div>
      <div class="t2-zoom">${state.roots ? `<button type="button" class="t2-gear" data-act="t2-settings" aria-label="${esc(t('settings'))}" title="${esc(t('settings'))}">${T2_GEAR}</button>` : ''}${t2of(api.me) ? `<button type="button" class="t2-me" data-act="t2-me" aria-label="${esc(t('t2Me'))}" title="${esc(t('t2Me'))}">${T2_ME}</button>` : ''}${t2fsButton()}</div>
    </div>
  </main>${nav('tree')}`;
}
/** After drawing: back to where you were in this tree, or the root's row in view (its parents above it). */
function t2afterRender() {
  const wrap = document.getElementById('t2-wrap');
  if (!wrap) return;
  const key = wrap.dataset.key, pos = t2.pos[key];
  if (pos) { wrap.scrollLeft = pos.x; wrap.scrollTop = pos.y; }
  else {
    const r = wrap.querySelector('.t2-card.root');
    // the root a little below the middle, so its parents and grandparents fill the view above it
    // (kept within the tree itself: the empty room around it is only there to drag into)
    if (r) {
      const z = t2.zoom, inr = wrap.querySelector('.t2-inner'), w = parseFloat(inr.style.width) * z, h = parseFloat(inr.style.height) * z;
      const x = (parseFloat(r.style.left) + T2.W / 2) * z + T2.mx - wrap.clientWidth / 2, y = (parseFloat(r.style.top) + T2.H / 2) * z - wrap.clientHeight * 0.68;
      wrap.scrollLeft = Math.min(Math.max(x, T2.mx), Math.max(T2.mx, T2.mx + w - wrap.clientWidth));
      wrap.scrollTop = Math.min(Math.max(y, 0), Math.max(0, h - wrap.clientHeight));
    }
  }
  // When the view changes size (full screen, turning the phone), its middle stays its middle.
  let size = { w: wrap.clientWidth, h: wrap.clientHeight };
  new ResizeObserver(() => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || (w === size.w && h === size.h)) return;
    wrap.scrollLeft += (size.w - w) / 2; wrap.scrollTop += (size.h - h) / 2;
    size = { w, h };
  }).observe(wrap);
  // Zooming, without drawing again: the point at (px, py) in the view stays where it is.
  const canvas = wrap.querySelector('.t2-canvas'), inner = wrap.querySelector('.t2-inner');
  const W0 = parseFloat(inner.style.width), H0 = parseFloat(inner.style.height);
  t2.setZoom = (to, px = wrap.clientWidth / 2, py = wrap.clientHeight / 2) => {
    const z0 = t2.zoom, z = Math.min(1.6, Math.max(0.4, to));
    if (z === z0) return;
    const ux = (wrap.scrollLeft + px - T2.mx) / z0, uy = (wrap.scrollTop + py) / z0;
    t2.zoom = z;
    inner.style.transform = `scale(${z})`;
    canvas.style.width = `${W0 * z + 2 * T2.mx}px`; canvas.style.height = `${H0 * z + T2.my}px`;
    wrap.scrollLeft = ux * z + T2.mx - px; wrap.scrollTop = uy * z - py;
    t2.pos[key] = { x: wrap.scrollLeft, y: wrap.scrollTop };
  };
  // Two fingers: pinch to zoom, around the middle of the fingers. (A trackpad's pinch comes as a wheel with ctrl.)
  let pinch = null;
  const spread = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  wrap.addEventListener('touchstart', (e) => { pinch = e.touches.length === 2 ? { d: spread(e), z: t2.zoom } : null; }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    t2.setZoom(pinch.z * spread(e) / pinch.d, (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top);
  }, { passive: false });
  wrap.addEventListener('touchend', () => { pinch = null; }); wrap.addEventListener('touchcancel', () => { pinch = null; });
  wrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    t2.setZoom(t2.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  // The place is kept as you move. A tap first saves it and holds it: tapping a button can make the browser
  // nudge the view to show the focused button, which mustn't count (going back returns to where you were).
  let hold = false;
  wrap.addEventListener('scroll', () => { if (!hold) t2.pos[key] = { x: wrap.scrollLeft, y: wrap.scrollTop }; }, { passive: true });
  wrap.addEventListener('pointerdown', () => { t2.pos[key] = { x: wrap.scrollLeft, y: wrap.scrollTop }; hold = true; }, true);
  wrap.addEventListener('pointerup', () => { setTimeout(() => { hold = false; }, 0); }, true);
  wrap.addEventListener('pointercancel', () => { hold = false; }, true);
  // Grab and drag to move the tree (mouse or trackpad; fingers scroll it natively). A drag that started on a
  // card doesn't open it.
  let drag = null, moved = false;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || e.target.closest('.t2-zoom')) return;
    drag = { x: e.clientX, y: e.clientY, l: wrap.scrollLeft, t: wrap.scrollTop, id: e.pointerId }; moved = false;
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    if (!moved) { moved = true; hold = false; wrap.setPointerCapture(e.pointerId); wrap.classList.add('dragging'); }
    wrap.scrollLeft = drag.l - dx; wrap.scrollTop = drag.t - dy;
  });
  const end = () => { drag = null; wrap.classList.remove('dragging'); };
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
  wrap.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
}
/** A card's short window: who they are, how they're related, and the way to the profile or to their tree. */
function t2sheet(id) {
  const n = t2of(id);
  if (!n) return;
  const L = getLang(), dlg = $('#sheet');
  const rel = n.id === viewerFor(n.id) ? '' : closestLabel(n.id);
  const other = n.t ? fullIn(n.t, otherLang()) : rootsName(n.r, otherLang());
  const yrs = t2years(n);
  // The start of what is written about them (the About text on their extended-family page), up to about 200
  // characters, cut at a word; the rest is on the full profile.
  const aboutAll = ((n.r ?? state.roots?.byMain.get(n.id))?.about ?? '').trim().replace(/\n{2,}/g, '\n');
  const about = aboutAll.length <= 200 ? aboutAll : `${aboutAll.slice(0, 200).replace(/\s+\S*$/, '')}…`;
  dlg.innerHTML = `<form method="dialog" class="sheet-form t2-sheet">
    <div class="t2-sheet-head">${n.t ? avatar(n.t, 'md', { camera: false }) : rootsAv(n.r, 'md')}<div><h2><bdi>${esc(t2name(n, L))}</bdi></h2>${other && other !== t2name(n, L) ? `<p class="t2-other"><bdi>${esc(other)}</bdi></p>` : ''}${rel ? `<p class="t2-rel">${esc(rel)}</p>` : ''}${yrs ? `<p class="t2-other">${esc(yrs)}</p>` : ''}</div></div>
    ${about ? `<p class="t2-about" dir="auto">${esc(about)}</p>` : ''}
    <div class="actions t2-actions"><button type="button" class="pill" data-sheet="close">${t('close')}</button>
      <button type="button" class="chip lilac t2-chip" data-sheet="tree">${ICON.tree}${t('t2FamilyTree')}</button>
      <a class="cta small" href="${esc(t2href(n))}">${t('t2FullProfile')}</a></div>
  </form>`;
  dlg.querySelector('[data-sheet="close"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-sheet="tree"]').addEventListener('click', () => { dlg.close(); location.hash = `#/chart/${encodeURIComponent(n.id)}`; });
  dlg.querySelector('.cta').addEventListener('click', () => dlg.close());
  dlg.showModal();
}
function t2settings() {
  const dlg = $('#sheet');
  const radios = (name, cur, opts) => opts.map(([v, label]) => `<label class="chk"><input type="radio" name="${name}" value="${v}" ${cur === v ? 'checked' : ''} /> ${label}</label>`).join('');
  dlg.innerHTML = `<form method="dialog" class="sheet-form quiz-settings t2-settings"><h2>${t('t2Settings')}</h2>
    <fieldset class="inline"><legend>${t('t2AncGens')}</legend>${radios('anc', t2.anc, [2, 3, 4, 5, 6, 7].map((n) => [n, n]))}</fieldset>
    <fieldset class="inline"><legend>${t('t2DescGens')}</legend>${radios('desc', t2.desc, [[0, t('t2None')], [1, 1], [2, 2], [3, 3], [4, 4]])}</fieldset>
    <fieldset class="inline"><legend>${t('t2Sibs')}</legend>${radios('sib', t2.sib, [[0, t('t2None')], [1, 1], [2, 2], [3, 3], [99, t('t2All')]])}<small class="t2-hint">${t('t2SibsNote')}</small></fieldset>
    <fieldset><legend>${t('t2Who')}</legend>
      <label class="chk"><input type="checkbox" name="both" ${t2.both ? 'checked' : ''} /><span class="lvl">${t('t2Both')}<small>${t('t2BothNote')}</small></span></label></fieldset>
    <div class="actions t2-actions"><button type="button" class="pill t2-chip" data-sheet="picture">${T2_SAVE} ${t('t2Save')}</button><button type="button" class="pill t2-chip" data-sheet="pdf">${T2_SAVE} ${t('t2SavePdf')}</button><button type="button" class="cta small" data-sheet="done">${t('save')}</button></div></form>`;
  const f = dlg.querySelector('form');
  const apply = () => {
    t2.anc = Number(f.anc.value); t2.desc = Number(f.desc.value); t2.sib = Number(f.sib.value); t2.both = f.both.checked;
    t2save(); t2.pos = {}; dlg.close(); render();
  };
  dlg.querySelector('[data-sheet="done"]').addEventListener('click', apply);
  // The picture is of the tree as set here: the choices are taken first, then it is made.
  dlg.querySelector('[data-sheet="picture"]').addEventListener('click', () => { apply(); t2savePicture(); });
  dlg.querySelector('[data-sheet="pdf"]').addEventListener('click', () => { apply(); t2savePicture(true); });
  dlg.showModal();
}

// Full screen (the button beside the zoom): the tree over the whole window, and the browser's own full screen
// where it has one (not on an iPhone, where the tree still fills the page). Esc, or the button again, ends it.
// The tree's settings (how many generations up and down), beside the other buttons under the tree: zooming is by
// pinching or the wheel, so there is no + and −.
const T2_GEAR = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
// Save the tree as a picture: the whole tree as the gear is set (not only the part on the screen, and whatever the
// zoom), painted on a canvas from the same layout the page is drawn from, three times the size so it stays sharp
// (less when the tree is too big for one image). On a phone it is handed to the share sheet; elsewhere it downloads.
// It is asked for from the tree's settings (the gear).
const T2_SAVE = '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3v10M7 9l4 4 4-4M4 15v2.5A1.5 1.5 0 0 0 5.500 19h11a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>';
async function t2savePicture(asPdf = false) {
  if (!t2.last || t2.saving) return;
  t2.saving = true;
  // It can take a while (every photo in the tree is fetched, then a large image is made): a note beside the
  // buttons says how far it is, so it is clear something is happening and when it is done.
  const note = document.createElement('span');
  note.className = 't2-prog';
  const say = (pct) => { note.textContent = `${t('t2Saving')} ${pct}%`; };
  say(0);
  document.querySelector('.t2-zoom')?.append(note);
  try {
    const { lay, root } = t2.last, { W, H } = T2;
    let S = 3;
    while (S > 1 && (lay.width * S > 16000 || lay.height * S > 16000 || lay.width * lay.height * S * S > 120e6)) S -= 0.5;
    // A PDF on a phone: a smaller picture inside (a phone runs out of memory turning a very large one into a PDF).
    const touch = matchMedia('(pointer: coarse)').matches;
    if (asPdf && touch) while (S > 1 && lay.width * lay.height * S * S > 14e6) S -= 0.5;
    const cv = document.createElement('canvas');
    cv.width = Math.round(lay.width * S); cv.height = Math.round(lay.height * S);
    const g = cv.getContext('2d');
    g.scale(S, S);
    g.fillStyle = '#F3F0FA'; g.fillRect(0, 0, lay.width, lay.height);
    g.lineWidth = 2; g.lineCap = 'square';
    for (const l of lay.lines) { g.strokeStyle = l.wed ? '#E5A3C4' : l.mark ? '#DDD6F0' : '#B9ADDB'; g.setLineDash(l.mark ? [6, 8] : []); g.beginPath(); g.moveTo(l.x1, l.y1); g.lineTo(l.x2, l.y2); g.stroke(); }
    g.setLineDash([]);
    const load = (url) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
    // the photos are most of the wait: the count of those that have arrived is the progress, up to 90%
    const urls = lay.cards.map((c) => t2pic(c.p));
    const total = urls.filter(Boolean).length; let got = 0;
    const pics = await Promise.all(urls.map((url) => (url ? load(url).then((im) => { got++; say(Math.round((got / total) * 90)); return im; }) : null)));
    say(92);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));   // let the note show before the drawing holds the page
    await document.fonts?.ready;
    const css = getComputedStyle(document.body), font = css.fontFamily, ink = css.getPropertyValue('--ink').trim() || '#1E1B3A', muted = css.getPropertyValue('--muted').trim() || '#8A85A8';
    const L = getLang();
    g.direction = 'rtl';   // as the cards are: the picture on the right, the words beside it
    // a name on up to three lines, as on the card (the last one cut with … when there is more)
    const wrap = (text, max) => {
      const lines = []; let cur = '';
      for (const w of text.split(/\s+/)) {
        const tryLine = cur ? `${cur} ${w}` : w;
        if (cur && g.measureText(tryLine).width > max) { lines.push(cur); cur = w; } else cur = tryLine;
      }
      if (cur) lines.push(cur);
      if (lines.length > 3) { lines.length = 3; while (lines[2].length > 1 && g.measureText(`${lines[2]}…`).width > max) lines[2] = lines[2].slice(0, -1); lines[2] += '…'; }
      return lines;
    };
    lay.cards.forEach((c, i) => {
      const n = c.p, f = t2sex(n) === 'f', isRoot = n.id === root.id, bw = isRoot ? 2.5 : 1.5;
      g.beginPath(); g.roundRect(c.x + bw / 2, c.y + bw / 2, W - bw, H - bw, 10 - bw / 2);
      g.save();
      if (isRoot) { g.shadowColor = 'rgba(124, 92, 191, .25)'; g.shadowBlur = 16 * S; g.shadowOffsetY = 6 * S; }
      g.fillStyle = isRoot ? '#fff' : f ? '#FCEBF4' : '#EEE8FF'; g.fill();
      g.restore();
      g.lineWidth = bw; g.strokeStyle = isRoot ? (f ? '#B83D78' : '#7C5CBF') : f ? '#E5A3C4' : '#BBA8EA'; g.stroke();
      // the picture (or the first letter), 40 × 50 at the right
      const px = c.x + W - bw - 5 - 40, py = c.y + (H - 50) / 2;
      g.save();
      g.beginPath(); g.roundRect(px, py, 40, 50, 6); g.clip();
      g.fillStyle = f ? '#F6D3E5' : '#DCD2F5'; g.fillRect(px, py, 40, 50);
      const im = pics[i], nm = t2name(n, L);
      if (im) {   // covering the box, as on the card
        const k = Math.max(40 / im.naturalWidth, 50 / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
        g.drawImage(im, px + (40 - w) / 2, py + (50 - h) / 2, w, h);
      } else {
        g.fillStyle = f ? '#8A2A5A' : '#5B3FA0'; g.font = `800 17px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText((t2first(n, 'he') || nm || '?')[0], px + 20, py + 26);
      }
      g.restore();
      // the name and the years, at the picture's side, in the middle of the card's height
      const right = px - 7, max = right - (c.x + bw + 5);
      const yrs = nm.length <= 24 ? t2years(n) : '';
      g.font = `700 12.5px ${font}`; g.textAlign = 'right'; g.textBaseline = 'middle';
      const lines = wrap(nm, max), lh = 12.5 * 1.22, yh = yrs ? 11 * 1.22 : 0;
      let y = c.y + (H - (lines.length * lh + yh)) / 2 + lh / 2;
      g.fillStyle = ink;
      for (const ln of lines) { g.fillText(ln, right, y); y += lh; }
      if (yrs) { g.font = `400 11px ${font}`; g.fillStyle = muted; g.fillText(yrs, right, y - lh / 2 + yh / 2); }
    });
    say(96);
    await new Promise((r) => setTimeout(r, 0));
    let blob, type = 'image/png', ext = 'png';
    if (asPdf) {
      // One page the size of the tree (for a print shop, or to zoom into): the same picture, laid on a PDF page.
      // A page can be at most 14,400 points a side, so a very large tree is scaled to fit.
      const { jsPDF } = await import('jspdf');
      const k = Math.min(1, 14400 / lay.width, 14400 / lay.height), pw = lay.width * k, ph = lay.height * k;
      const doc = new jsPDF({ unit: 'pt', format: [pw, ph], orientation: pw > ph ? 'landscape' : 'portrait', compress: true });
      // the picture as a file's bytes (not one very long text, which a phone may not manage)
      const jpg = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
      if (!jpg) throw new Error('too large');
      doc.addImage(new Uint8Array(await jpg.arrayBuffer()), 'JPEG', 0, 0, pw, ph);
      blob = doc.output('blob'); type = 'application/pdf'; ext = 'pdf';
    } else blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    say(100);
    if (!blob) throw new Error('too large');
    const name = `${t2name(root, L)}.${ext}`;
    const file = new File([blob], name, { type });
    const url = URL.createObjectURL(blob);
    const download = () => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); };
    if (touch && !asPdf && navigator.canShare?.({ files: [file] })) {   // a picture: straight to the share sheet, as it has been
      try { await navigator.share({ files: [file] }); setTimeout(() => URL.revokeObjectURL(url), 10000); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    if (touch && asPdf) {
      // A PDF on a phone takes longer, and a phone only hands a file over (the share sheet, or a download) right
      // after a tap: so a button says it is ready, and its tap does it.
      const ready = document.createElement('button');
      ready.type = 'button'; ready.className = 't2-prog t2-ready';
      ready.textContent = t('t2ReadyPdf');
      document.querySelector('.t2-zoom')?.append(ready);
      const done = () => { ready.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
      ready.addEventListener('click', async () => {
        if (navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file] }); return done(); } catch (e) { if (e.name === 'AbortError') return; }
        }
        download(); done();
      });
      setTimeout(done, 300000);   // not taken in five minutes: put away
      return;
    }
    download();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    console.warn('tree picture not saved', e);
    // said on the page too, so it isn't a button that does nothing
    const bad = document.createElement('span');
    bad.className = 't2-prog';
    bad.textContent = `${t('t2SaveFailed')} (${String(e?.message ?? e).slice(0, 80)})`;
    document.querySelector('.t2-zoom')?.append(bad);
    setTimeout(() => bad.remove(), 12000);
  } finally {
    note.remove();
    t2.saving = false;
  }
}
const T2_FS = {
  on: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8V3h5M14 3h5v5M19 14v5h-5M8 19H3v-5"/></svg>',
  off: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v5H3M19 8h-5V3M14 19v-5h5M3 14h5v5"/></svg>',
};
const t2fsButton = () => `<button type="button" class="t2-fs" data-act="t2-full" aria-label="${esc(t(t2.full ? 't2FullExit' : 't2Full'))}" title="${esc(t(t2.full ? 't2FullExit' : 't2Full'))}">${t2.full ? T2_FS.off : T2_FS.on}</button>`;
function t2setFull(on, browser = true) {
  t2.full = on;
  const wrap = document.getElementById('t2-wrap');
  if (wrap) { wrap.classList.toggle('full', on); wrap.querySelector('.t2-fs').outerHTML = t2fsButton(); }
  if (!browser) return;
  const el = document.documentElement;
  if (on) Promise.resolve(el.requestFullscreen?.()).catch(() => { /* not allowed, or no such thing here */ });
  else if (document.fullscreenElement) Promise.resolve(document.exitFullscreen?.()).catch(() => {});
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && t2.full) t2setFull(false, false); });

// ---------- Add Yourself ----------

function newDraft() {
  const w = state.wiz;
  // Never the top couple themselves when their children are all in (see closed()).
  const parents = [w.parents, w.pick, w.path.at(-1)].find((id) => id && !closed(couple(id))) ?? null;
  const pa = parents && person(couple(parents)?.a);
  return {
    he_first: '', en_first: '', he_last: pa?.he_last ?? '', en_last: pa?.en_last ?? '',
    parents, picking: !parents, photo: null,
    spouse: { he_first: '', en_first: '' }, children: [], child: '', error: '', sex: null,
  };
}

function addPage() {
  const d = state.draft ??= newDraft();
  const pc = d.parents && couple(d.parents);
  const field = (key, label, rtl) => `<label class="field"><span ${rtl ? 'dir="rtl"' : 'dir="ltr"'}>${label}</span>
    <input data-draft="${key}" value="${esc(key.split('.').reduce((o, k) => o[k], d))}" dir="${rtl ? 'rtl' : 'ltr'}" class="${rtl ? 'he' : ''}" /></label>`;
  const coupleRow = (c, on) => `<button type="button" class="couple-row ${on ? 'on' : ''}" data-act="draft-parents" data-id="${c.id}" aria-pressed="${on}">
    ${pair(c)}
    <span class="choice-text"><span class="title he">${esc(coupleName(c))}</span><span class="sub">${esc(coupleName(c, otherLang()))}</span></span>
    ${radio(on)}
  </button>`;

  return hero({
    left: backBtn(), exit: true,
    body: `<div class="hero-q"><div class="hero-emoji" aria-hidden="true">🌳</div><h1 class="q">${t('aTitle')}</h1><p class="q-sub">${t('aTitle', otherLang())}</p></div>`,
  }) + `<main class="content">
    <h2 class="sec-title">${t('yourInfo')} / ${t('yourInfo', otherLang())}</h2>
    <div class="card pad">
      <div class="draft-photo">
        <span class="av av-lg dashed">${d.photo ? `<span class="av-face"><img src="${d.photo.dataUrl}" alt="" /></span>` : ICON.user}
          <button type="button" class="cam" data-act="photo" data-pid="draft" aria-label="${t('addPhoto')}">${ICON.camera}</button></span>
      </div>
      <div class="field-pair">${field('he_first', t('heFirst'), true)}${field('en_first', t('enFirst'), false)}</div>
      <div class="field-pair">${field('he_last', t('heLast'), true)}${field('en_last', t('enLast'), false)}</div>
      ${sexPick(d.sex, 'data-draft="sex"')}
    </div>

    <h2 class="sec-title">${t('whoParents')} / ${t('whoParents', otherLang())}</h2>
    <div class="card list">
      ${d.picking
        ? state.couples.filter((c) => !closed(c)).map((c) => coupleRow(c, c.id === d.parents)).join('')
        : `${pc ? coupleRow(pc, true) : ''}<button type="button" class="change" data-act="draft-picking">${t('change')} / ${t('change', otherLang())} ${ICON.down}</button>`}
    </div>

    <h2 class="sec-title">${t('spouse')} / ${t('spouse', otherLang())}</h2>
    <div class="card pad"><div class="field-pair">${field('spouse.he_first', t('heFirst'), true)}${field('spouse.en_first', t('enFirst'), false)}</div></div>

    <h2 class="sec-title">${t('children')} / ${t('children', otherLang())}</h2>
    <div class="card list">
      ${d.children.map((name, i) => `<div class="person-row line">
        <span class="av av-sm" style="--av-bg:${tone(name + i)[0]};--av-fg:${tone(name + i)[1]}"><span class="av-face he">${esc(name[0])}</span></span>
        <span class="person-text"><span class="title he">${esc(name)}</span></span>
        <button type="button" class="link" data-act="draft-child-remove" data-i="${i}">${t('remove')}</button>
      </div>`).join('')}
      <form class="add-child-row tinted" data-form="draft-child">
        <span class="av av-sm dashed" aria-hidden="true">${ICON.plus}</span>
        <input name="child" required aria-label="${t('childName')}" placeholder="${t('childName')}" />
        <button class="btn-sm">${t('addBtn')}</button>
      </form>
    </div>
    <button type="button" class="dashed-add" data-act="focus-child">${ICON.plus}<span>${t('addAnother')}</span></button>

    ${d.error ? `<p class="err" role="alert">${esc(d.error)}</p>` : ''}
    <button type="button" class="cta coral" data-act="draft-submit">${t('submit')}</button>
    ${localNote()}
  </main>`;
}

async function submitDraft() {
  const d = state.draft;
  if (!d.he_first.trim() && !d.en_first.trim()) { d.error = t('needName'); return render(); }
  if (!d.parents) { d.error = t('needParents'); return render(); }
  try {
    d.ids ??= { me: crypto.randomUUID(), spouse: crypto.randomUUID(), kids: [] };
    const me = await api.savePerson({ he_first: d.he_first, en_first: d.en_first, he_last: d.he_last, en_last: d.en_last, parents: d.parents, sex: d.sex }, d.ids.me);
    state.people.push(me);
    api.me = me.id;
    if (d.photo) {
      me.photo = await api.uploadPhoto(me.id, d.photo.blob, d.photo.dataUrl);
      keepOriginal('person', me.id, d.photo.file);
    }
    let spouse = null;
    if (d.spouse.he_first.trim() || d.spouse.en_first.trim()) {
      spouse = await api.savePerson({ ...d.spouse, he_last: d.he_last, en_last: d.en_last, sex: otherSex(d) }, d.ids.spouse);
      state.people.push(spouse);
    }
    if (spouse || d.children.length) {
      const c = await api.addCouple(me.id, spouse?.id ?? null);
      state.couples.push(c);
      for (const [i, name] of d.children.entries()) {
        const he = isHebrew(name);
        const kid = await api.savePerson({ [he ? 'he_first' : 'en_first']: name, he_last: d.he_last, en_last: d.en_last, parents: c.id }, d.ids.kids[i] ??= crypto.randomUUID());
        state.people.push(kid);
      }
    }
    state.draft = null;
    location.hash = '#/me';
    await refresh();
  } catch (err) {
    d.error = t('saveErr') + err.message;
    render();
  }
}

// ---------- edit sheets ----------

function openSheet(field, pid) {
  const p = person(pid);
  const dlg = $('#sheet');
  const L = getLang();
  const input = (name, label, value, attrs = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${attrs} /></label>`;
  let body, title;
  const wed = field === 'anniversary' ? coupleOf(pid) : null;
  const yz = field === 'yahrzeit';
  // Birthday and anniversary share the Hebrew date picker; `src` holds whichever date is edited.
  const src = wed ? { h_day: wed.w_day, h_month: wed.w_month, h_year: wed.w_year } : yz ? { h_day: p.d_day, h_month: p.d_month, h_year: p.d_year } : p;
  if (field === 'birthday' || wed || yz) {
    title = wed ? `${t(isEngaged(wed) ? 'wedding' : 'anniversary')} · ${coupleName(wed)}` : yz ? `${t('yahrzeit')} · ${first(p)}` : `${t('birthday')} · ${first(p)}`;
    body = `<div class="field-row">
      <label class="field"><span>${t('day')}</span><select name="h_day"><option value="" ${src.h_day ? '' : 'selected'}>—</option>${Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}" ${i + 1 === src.h_day ? 'selected' : ''}>${dayName(i + 1, L)}</option>`).join('')}</select></label>
      <label class="field grow"><span>${t('month')}</span><select name="h_month"></select></label>
      <label class="field"><span>${t('yearIfKnown')}</span><input type="number" name="h_year" min="5500" max="6100" value="${src.h_year ?? ''}" /></label>
    </div>
    <p class="preview he" id="hPreview"></p>
    ${wed ? `<label class="chk engaged-chk"><input type="checkbox" name="engaged" ${wed.engaged ? 'checked' : ''} /> 💍 ${t('engagedCheck')}</label>
      <label class="field" id="venueField" ${wed.engaged ? '' : 'hidden'}><span>${t('venue')}</span><input name="venue" value="${esc(wed.venue ?? '')}" maxlength="120" dir="auto" autocomplete="off" placeholder="${esc(t('venueHint'))}" /></label>` : ''}
    ${field !== 'birthday' ? '' : `<label class="field" id="twinField" hidden><span id="twinLabel"></span><select name="birth_order"></select></label>`}
    <details class="convert"><summary>${t('fromCivil')}</summary>
      <div class="field-row"><input type="date" name="civil" aria-label="${t('fromCivil')}" />
        <label class="chk"><input type="checkbox" name="night" /> ${t('afterSunset')}</label>
        <button type="button" class="btn-sm" data-sheet="convert">${t('use')}</button></div>
    </details>`;
    queueMicrotask(() => {
      const f = dlg.querySelector('form');
      // With no year the list has plain Adar as well as Adar I and Adar II; typing a year narrows it.
      // An unknown date starts on "—" (not 1 Tishrei), and saving "—" leaves or makes the date empty.
      const months = (yr, sel) => `<option value="" ${sel ? '' : 'selected'}>—</option>`
        + pickerMonths(yr).map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${monthName(m, yr || LEAP_REF, L)}</option>`).join('');
      let prevYear = src.h_year ?? null;
      f.h_month.innerHTML = months(prevYear, src.h_month ?? null);
      const sync = () => {
        const typed = Number(f.h_year.value);
        const yr = typed >= 5500 && typed <= 6100 ? typed : null; // a half-typed year isn't a year yet
        const m = Number(f.h_month.value);
        f.h_month.innerHTML = months(yr, m ? monthForYear(m, yr, prevYear) : null);
        prevYear = yr;
        const whole = Number(f.h_day.value) && Number(f.h_month.value);
        $('#hPreview').textContent = whole ? formatDate({ h_day: Number(f.h_day.value), h_month: Number(f.h_month.value), h_year: Number(f.h_year.value) || null }, L) : '';
        // Where the wedding is: asked only while they're engaged.
        if (f.venue) $('#venueField').hidden = !f.engaged.checked;
        // A twin (a brother or sister with this same date): which one was born first.
        if (field === 'birthday') {
          const twins = twinsOf(p, { h_day: Number(f.h_day.value), h_month: Number(f.h_month.value), h_year: Number(f.h_year.value) || null });
          const keep = Number(f.birth_order.value) || p.birth_order;
          $('#twinField').hidden = !twins.length;
          $('#twinLabel').textContent = t('twinOrder', L, twins.map((x) => first(x, L)).join(', '));
          f.birth_order.innerHTML = `<option value="">—</option>` + twins.concat(p).map((_, i) => `<option value="${i + 1}" ${i + 1 === keep ? 'selected' : ''}>${t('bornNth', L, i + 1)}</option>`).join('');
        }
      };
      f.addEventListener('change', sync);
      f.h_year.addEventListener('input', sync);
      // A civil date fills in the Hebrew one straight away (and again when "after sunset" changes);
      // the Use button does the same, for anyone who looks for it.
      const fromCivilDate = () => {
        if (!f.civil.value) return;
        const h = fromCivil(f.civil.value, f.night.checked);
        f.h_year.value = h.h_year;
        prevYear = h.h_year;
        f.h_month.innerHTML = months(h.h_year, h.h_month);
        f.h_day.value = h.h_day;
        sync();
      };
      f.querySelector('[data-sheet="convert"]').addEventListener('click', fromCivilDate);
      f.civil.addEventListener('change', (ev) => { ev.stopPropagation(); fromCivilDate(); });
      f.night.addEventListener('change', (ev) => { ev.stopPropagation(); fromCivilDate(); });
      f.dataset.civil = '1';
      sync();
    });
  } else if (field === 'names') {
    title = `${t('names')} · ${full(p)}`;
    body = `<div class="field-pair">${input('he_first', 'שם פרטי / כינוי', p.he_first, 'dir="rtl" class="he"')}${input('en_first', 'First name / Nickname', p.en_first, 'dir="ltr"')}</div>
      <div class="field-pair">${input('he_last', 'שם משפחה', p.he_last, 'dir="rtl" class="he"')}${input('en_last', 'Last name', p.en_last, 'dir="ltr"')}</div>
      ${input('he_full', t('heFull'), p.he_full, 'dir="rtl" class="he"')}<p>${t('heFullHint')}</p>
      ${p.maiden || p.maiden_he || (coupleOf(p.id) && p.sex !== 'm') ? `<div class="field-pair">${input('maiden_he', t('maidenHe'), p.maiden_he, 'dir="rtl" class="he"')}${input('maiden', t('maidenEn'), p.maiden, 'dir="ltr"')}</div>` : ''}
      <div class="seg" role="radiogroup" aria-label="${t('tribeLevi')} / ${t('tribeKohen')}">${[['', t('tribeNone')], ['levi', t('tribeLevi')], ['kohen', t('tribeKohen')]].map(([v, label]) => `
        <label><input type="radio" name="tribe" value="${v}" ${(p.tribe ?? '') === v ? 'checked' : ''} /><span>${label}</span></label>`).join('')}</div>
      ${sexPick(p.sex)}`;
  } else if (field === 'spouse') {
    title = t('addSpouseTitle');
    body = `<div class="field-pair">${input('he_first', 'שם פרטי / כינוי', '', 'dir="rtl" class="he"')}${input('en_first', 'First name / Nickname', '', 'dir="ltr"')}</div>
      <div class="field-pair">${input('he_last', 'שם משפחה', p.he_last, 'dir="rtl" class="he"')}${input('en_last', 'Last name', p.en_last, 'dir="ltr"')}</div>
      ${sexPick(otherSex(p))}`;
  } else {
    const keys = field === 'contact' ? ['phone', 'email'] : field === 'parentNames' ? ['father_name', 'mother_name', 'mother_he'] : [field];
    title = field === 'parentNames' ? `${t('parentNames')} · ${first(p)}` : `${keys.map((k) => fieldLabel(p, k)).join(' / ')} · ${first(p)}`;
    const type = { phone: 'tel', email: 'email', city: 'text', address: 'text', hobby: 'text', occupation: 'text', father_name: 'text', mother_name: 'text', mother_he: 'text' };
    body = keys.map((k) => input(k, fieldLabel(p, k), k === 'address' ? FIELD.address.value(p) : p[k], `type="${type[k]}" ${k === 'mother_he' ? 'dir="rtl" class="he"' : ['city', 'address', 'hobby', 'occupation', 'father_name', 'mother_name'].includes(k) ? (k === 'address' ? 'dir="auto"' : '') : 'dir="ltr"'} autocomplete="off"`)).join('');
  }

  dlg.innerHTML = `<form method="dialog" class="sheet-form">
    <h2>${esc(title)}</h2>
    ${body}
    <p class="err" hidden></p>
    <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button><button class="cta small">${t('save')}</button></div>
  </form>`;
  const f = dlg.querySelector('form');
  f.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const val = (k) => f[k]?.value.trim() ?? '';
    // A civil date picked but not yet turned into the Hebrew one: turn it now, so it's what's saved.
    if (f.civil?.value && !Number(val('h_day'))) {
      const h = fromCivil(f.civil.value, f.night.checked);
      f.h_year.value = h.h_year;
      if (![...f.h_month.options].some((o) => Number(o.value) === h.h_month)) f.h_month.add(new Option('', h.h_month));
      f.h_month.value = h.h_month;
      f.h_day.value = h.h_day;
    }
    try {
      if (field === 'spouse') {
        if (!val('he_first') && !val('en_first')) throw new Error(t('needName'));
        f.dataset.newId ||= crypto.randomUUID();
        const sp = await api.savePerson({ he_first: val('he_first'), en_first: val('en_first'), he_last: val('he_last'), en_last: val('en_last'), sex: f.sex.value || null }, f.dataset.newId);
        state.people.push(sp);
        const c = await api.addCouple(pid, sp.id);
        state.couples = [...state.couples.filter((x) => x.id !== c.id), c];
      } else if (wed) {
        const saved = await api.saveCouple({ ...wed, w_day: Number(val('h_day')) || null, w_month: Number(val('h_month')) || null, w_year: Number(val('h_year')) || null, engaged: f.engaged.checked, venue: val('venue') || null });
        state.couples = state.couples.map((x) => (x.id === saved.id ? saved : x));
      } else {
        const next = { ...p };
        if (yz) Object.assign(next, { d_day: Number(val('h_day')) || null, d_month: Number(val('h_month')) || null, d_year: Number(val('h_year')) || null });
        else if (field === 'birthday') {
          Object.assign(next, { h_day: Number(val('h_day')) || null, h_month: Number(val('h_month')) || null, h_year: Number(val('h_year')) || null });
          const twins = twinsOf(p, next);
          next.birth_order = twins.length ? Number(val('birth_order')) || null : null;
          // With two, picking one fills in the other: the twin gets the other place.
          const other = twins.length === 1 && next.birth_order <= 2 ? twins[0] : null;
          if (other && other.birth_order !== 3 - next.birth_order) await savePerson({ ...other, birth_order: 3 - next.birth_order });
        }
        else for (const k of ['he_first', 'he_full', 'en_first', 'he_last', 'en_last', 'city', 'address', 'phone', 'email', 'hobby', 'occupation', 'maiden', 'maiden_he', 'father_name', 'mother_name', 'mother_he']) if (f[k]) next[k] = val(k) || null;
        if (field === 'names') { next.sex = f.sex.value || null; next.tribe = f.tribe.value || null; }
        // A couple shares one address (a page shows the spouse's when its own is empty), so a
        // change to it, or clearing it, is saved for both: otherwise the spouse's page keeps the
        // old one, and an address that was cleared shows again from the spouse's.
        // (A couple who are no longer together live separately: each keeps their own.)
        const sp = f.address && next.address !== (FIELD.address.value(p) || null) ? houseMate(p.id) : null;
        if (sp && sp.address !== next.address) await savePerson({ ...sp, address: next.address });
        await savePerson(next);
      }
      dlg.close();
      await refresh();
    } catch (err) {
      const e = f.querySelector('.err');
      e.textContent = t('saveErr') + err.message;
      e.hidden = false;
    }
  });
  dlg.showModal();
}

async function savePerson(p) {
  const { photo, ...rest } = p;
  const saved = await api.savePerson(rest);
  saved.photo ??= photo;
  state.people = state.people.map((x) => (x.id === saved.id ? saved : x));
  return saved;
}

// ---------- photos ----------

/**
 * Lets the uploader drag a round frame onto one face (and resize it from the corner), then keeps
 * just that square, shrunk to a small JPEG. Resolves null when cancelled.
 */
function cropPhoto(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const dlg = $('#crop');
    dlg.innerHTML = `<form method="dialog" class="sheet-form">
      <h2>${t('cropTitle')}</h2>
      <p>${t('cropHint')}</p>
      <div class="crop-stage"><div class="crop-wrap">
        <img src="${url}" alt="" draggable="false" />
        <div class="crop-box" tabindex="0" aria-label="${esc(t('cropTitle'))}"><span class="crop-handle" aria-hidden="true"></span></div>
      </div></div>
      <div class="actions"><button type="button" class="pill" data-crop="cancel">${t('cancel')}</button><button class="cta small">${t('usePhoto')}</button></div>
    </form>`;
    const img = dlg.querySelector('img'), boxEl = dlg.querySelector('.crop-box');
    const box = { x: 0, y: 0, s: 0 };
    const clamp = () => {
      const w = img.clientWidth, h = img.clientHeight;
      box.s = Math.max(40, Math.min(box.s, w, h));
      box.x = Math.max(0, Math.min(box.x, w - box.s));
      box.y = Math.max(0, Math.min(box.y, h - box.s));
      Object.assign(boxEl.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.s}px`, height: `${box.s}px` });
    };
    img.addEventListener('load', () => {
      const w = img.clientWidth, h = img.clientHeight;
      box.s = Math.min(w, h) * 0.6;
      box.x = (w - box.s) / 2;
      box.y = (h - box.s) / 3;   // faces tend to be in the upper part
      clamp();
    });
    // One pointer drags the frame; the corner handle resizes it (it stays square).
    let drag = null;
    boxEl.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      boxEl.setPointerCapture(ev.pointerId);
      drag = { resize: ev.target.classList.contains('crop-handle'), px: ev.clientX, py: ev.clientY, start: { ...box } };
    });
    boxEl.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.px, dy = ev.clientY - drag.py;
      if (drag.resize) box.s = drag.start.s + Math.max(dx, dy);
      else Object.assign(box, { x: drag.start.x + dx, y: drag.start.y + dy });
      clamp();
    });
    const stop = () => { drag = null; };
    boxEl.addEventListener('pointerup', stop);
    boxEl.addEventListener('pointercancel', stop);
    // Arrow keys move the frame, +/- resize it.
    boxEl.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 20 : 5;
      const moves = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, -step, 0], ArrowDown: [0, step, 0], '+': [0, 0, step], '=': [0, 0, step], '-': [0, 0, -step] };
      const m = moves[ev.key];
      if (!m) return;
      ev.preventDefault();
      box.x += m[0]; box.y += m[1]; box.s += m[2];
      clamp();
    });
    const done = (result) => { URL.revokeObjectURL(url); dlg.close(); resolve(result); };
    dlg.querySelector('[data-crop="cancel"]').addEventListener('click', () => done(null));
    dlg.addEventListener('cancel', () => done(null), { once: true });
    dlg.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const scale = img.naturalWidth / img.clientWidth;
      const side = box.s * scale;
      const out = Math.round(Math.min(side, api.mode === 'local' ? 240 : 480));
      const canvas = Object.assign(document.createElement('canvas'), { width: out, height: out });
      canvas.getContext('2d').drawImage(img, box.x * scale, box.y * scale, side, side, 0, 0, out, out);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      done({ blob, dataUrl: canvas.toDataURL('image/jpeg', 0.85) });
    });
    dlg.showModal();
  });
}

/** The whole photo, no crop, at most `max` px on its longest side (group photos stay sharp). */
async function shrinkWhole(file, max, quality = 0.85) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  return { blob, dataUrl: canvas.toDataURL('image/jpeg', quality) };
}

/**
 * Keeps a full-quality copy for printing (an album, say): the photo exactly as taken when it's an
 * ordinary JPEG/PNG/WebP that fits in one upload, otherwise (bigger, or iPhone HEIC) re-encoded at up
 * to 3000 px, which still prints sharp at about 25 cm. Runs after the small upload; a failure here
 * doesn't stop anything.
 */
async function keepOriginal(kind, id, file) {
  try {
    const fits = /^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= 5.5 * 1024 * 1024;
    const blob = fits ? file : (await shrinkWhole(file, 3000, 0.92)).blob;
    await api.uploadOriginal(kind, id, blob);
  } catch (err) {
    console.warn('full-quality copy not saved', err);
  }
}

$('#photoInput').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  if (state.photoFor.startsWith('gallery:')) {
    const pid = state.photoFor.slice(8);
    try {
      const shot = await shrinkWhole(file, api.mode === 'local' ? 800 : 1600);
      const g = await api.addGalleryPhoto(pid, shot.blob, shot.dataUrl);
      keepOriginal('gallery', g.id, file);
      await refresh();
    } catch (err) {
      alert(t('saveErr') + err.message);
    }
    return;
  }
  if (state.photoFor.startsWith('matzeiva:') || state.photoFor.startsWith('roots-matzeiva:') || state.photoFor.startsWith('roots-book:')) {
    const roots = state.photoFor.startsWith('roots-');
    const kind = state.photoFor.startsWith('roots-book:') ? 'book' : 'matzeiva';
    const pid = state.photoFor.slice(state.photoFor.indexOf(':') + 1);
    try {
      const shot = await shrinkWhole(file, api.mode === 'local' ? 800 : 1600);
      if (roots) {
        const g = await api.addRootsGalleryPhoto(pid, shot.blob, '', kind);
        keepOriginal('roots-gallery', g.id, file);
        state.roots.photos = [...(state.roots.photos ?? []).filter((x) => !(x.person === pid && x.kind === kind)), g];
        render();
      } else {
        const g = await api.addGalleryPhoto(pid, shot.blob, shot.dataUrl, 'matzeiva');
        keepOriginal('gallery', g.id, file);
        await refresh();
      }
    } catch (err) {
      alert(t('saveErr') + err.message);
    }
    return;
  }
  if (state.photoFor.startsWith('roots-gallery:')) {
    const pid = state.photoFor.slice(14);
    try {
      const shot = await shrinkWhole(file, 1600);
      const g = await api.addRootsGalleryPhoto(pid, shot.blob);
      keepOriginal('roots-gallery', g.id, file);
      state.roots.photos = [...(state.roots.photos ?? []), g];
      render();
    } catch (err) {
      alert(t('saveErr') + err.message);
    }
    return;
  }
  if (state.photoFor.startsWith('family:')) {
    const cid = state.photoFor.slice(7);
    try {
      const shot = await shrinkWhole(file, api.mode === 'local' ? 800 : 1600);
      couple(cid).photo = await api.uploadFamilyPhoto(cid, shot.blob, shot.dataUrl);
      keepOriginal('family', cid, file);
      await refresh();
    } catch (err) {
      alert(t('saveErr') + err.message);
    }
    return;
  }
  const shot = await cropPhoto(file);
  if (!shot) return;
  if (state.photoFor.startsWith('roots:')) {
    const rp = state.roots?.byId.get(state.photoFor.slice(6));
    if (!rp) return;
    try {
      rp.photo_v = await api.uploadRootsPhoto(rp.id, shot.blob);
      keepOriginal('roots', rp.id, file);
      render();
    } catch (err) {
      alert(t('saveErr') + err.message);
    }
    return;
  }
  if (state.photoFor === 'draft') { state.draft.photo = { ...shot, file }; return render(); }
  const p = person(state.photoFor);
  try {
    p.photo = await api.uploadPhoto(p.id, shot.blob, shot.dataUrl);
    keepOriginal('person', p.id, file);
    await refresh();
  } catch (err) {
    alert(t('saveErr') + err.message);
  }
});


// ---------- tehillim: each one's chapter ----------
// The tehillim page: once its top (the photo and name) scrolls away, a small bar with the same stays at the top,
// so whoever is saying it keeps in mind who it's for.
addEventListener('scroll', () => {
  const bar = document.querySelector('.tehillim-sticky');
  const head = document.querySelector('.tehillim-head');
  if (bar && head) bar.classList.toggle('on', head.getBoundingClientRect().bottom < 0);
}, { passive: true });
// The chapter of Tehillim for the year someone is in now (the custom: after turning 40, chapter 41), with its
// text, for them, their husband or wife, and their children: one card at a time, like a name said in prayer.

// One file per chapter (public/tehillim/N.json, from Sefaria's public-domain "Tanach with Nikkud"). A chapter's
// text never changes, so once downloaded it's kept on the device (localStorage) and never fetched again; the
// page works out which chapters it needs (from each one's age) and only fetches what isn't there yet.
const tehillimText = new Map();   // chapter -> verses
const tehillimLoading = new Set();
let tehillimShown = null;   // the chapter on the card being shown
function chapterText(n) {
  if (tehillimText.has(n)) return tehillimText.get(n);
  try { const v = JSON.parse(localStorage.getItem(`tehillim.${n}`) ?? 'null'); if (Array.isArray(v)) { tehillimText.set(n, v); return v; } } catch {}
  if (!tehillimLoading.has(n)) {
    tehillimLoading.add(n);
    fetch(`/tehillim/${n}.json`).then((r) => (r.ok ? r.json() : null)).then((v) => {
      tehillimLoading.delete(n);
      if (!Array.isArray(v)) return;
      tehillimText.set(n, v);
      try { localStorage.setItem(`tehillim.${n}`, JSON.stringify(v)); } catch {}
      if (route()[0] === 'tehillim' && tehillimShown === n) render();   // only the chapter on screen redraws the page
    }).catch(() => tehillimLoading.delete(n));
  }
  return null;
}
/** The chapter for someone's current year: full Hebrew years since birth, plus 1 (up to 150). Null without a birth year. */
const chapterOf = (p) => { const y = yearsSince(p.h_day, p.h_month, p.h_year); return y == null ? null : Math.min(y + 1, 150); };
/** "שניאור זלמן בן באשא": the full Jewish name with the mother's name (from the tree, or the mother's-name field). */
function prayerName(p) {
  if (p.prayer) return p.prayer;
  const name = p.he_full || p.he_first || p.en_first || '';
  const c = p.parents && couple(p.parents);
  const mom = c ? [person(c.a), person(c.b)].find((x) => x && x.sex === 'f') ?? person(c.b) : null;
  const mother = mom ? (mom.he_full || mom.he_first || mom.en_first) : p.mother_he || p.mother_name;
  return mother ? `${name} ${p.sex === 'f' ? 'בת' : 'בן'} ${mother}` : name;
}
/** Who's in someone's tehillim cards: themselves, their husband or wife, then their children, oldest first,
 *  each followed by their own husband or wife (the son-in-law or daughter-in-law). Living only. */
function tehillimPeople(p) {
  const on = (k) => p.tehillim?.[k];
  const withSpouse = (x) => { const c = coupleOf(x.id); return [x, c && !c.apart ? spouseOf(x.id) : null]; };
  const kidsOf = (x) => { const c = coupleOf(x.id); return c ? childrenOf(c.id) : []; };
  const pc = p.parents && couple(p.parents);
  // Turned on behind the gear: parents first, brothers and sisters, grandchildren (each with their husband or wife).
  const parents = on('parents') && pc ? [person(pc.a), person(pc.b)] : [];
  const sibs = on('siblings') && p.parents ? childrenOf(p.parents).filter((x) => x.id !== p.id) : [];
  const grand = on('grandkids') ? kidsOf(p).flatMap(kidsOf) : [];
  const fam = [...parents, ...withSpouse(p), ...kidsOf(p).flatMap(withSpouse), ...sibs.flatMap(withSpouse), ...grand.flatMap(withSpouse)]
    .filter((x, i, list) => x && !x.deceased && list.findIndex((y) => y?.id === x.id) === i);
  return on('rebbe') ? [REBBE, ...fam] : fam;
}
/** Which of the gear's choices apply to someone: only what would add a living person (e.g. no grandchildren, no choice). */
function tehillimChoices(p) {
  const base = new Set(tehillimPeople({ ...p, tehillim: null }).map((x) => x.id));
  const adds = (k) => tehillimPeople({ ...p, tehillim: { [k]: true } }).some((x) => !base.has(x.id));
  return ['rebbe', 'parents', 'siblings', 'grandkids'].filter((k) => k === 'rebbe' || adds(k));
}
/** The Rebbe's card, for whoever turns it on behind the gear: born י"א ניסן תרס"ב (1902). */
const REBBE = { id: 'rebbe', rebbe: true, he_first: 'הרבי', he_full: 'מנחם מענדל', sex: 'm', h_day: 11, h_month: 1, h_year: 5662, prayer: 'כ״ק אדמו״ר נשיא דורנו', photo: '/rebbe.jpg' };
function tehillimBlock(p) {
  const list = tehillimPeople(p);
  if (!list.length) return '';
  const names = list.slice(0, 4).map((x) => esc(first(x))).join(' · ') + (list.length > 4 ? ' …' : '');
  return `<a class="card pad tehillim-block" href="#/tehillim/${p.id}">
    <span class="tile sm cream" aria-hidden="true">📖</span>
    <span class="info-text"><span class="label">${t('tehillimTitle')}</span><span class="value">${names}</span></span>
    <span class="chev" aria-hidden="true">›</span>
  </a>`;
}
/** The tehillim page's gear: your own settings, saved on your profile. */
const TEHILLIM_LABEL = { rebbe: 'tehillimRebbe', parents: 'tehillimParents', siblings: 'tehillimSiblings', grandkids: 'tehillimGrandkids' };
function openTehillimSettings(id) {
  const p = person(id);
  const dlg = $('#sheet');
  dlg.innerHTML = `<form method="dialog" class="sheet-form">
    <h2>${t('tehillimSettings')}</h2>
    ${tehillimChoices(p).map((k) => `<label class="check-row"><input type="checkbox" name="${k}" ${p.tehillim?.[k] ? 'checked' : ''} /> <span>${t(TEHILLIM_LABEL[k])}</span></label>`).join('')}
    <p class="err" hidden></p>
    <div class="actions"><button type="button" class="pill" data-sheet="cancel">${t('cancel')}</button><button class="cta small">${t('save')}</button></div>
  </form>`;
  const f = dlg.querySelector('form');
  dlg.querySelector('[data-sheet="cancel"]').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const th = Object.fromEntries(['rebbe', 'parents', 'siblings', 'grandkids'].filter((k) => f[k]?.checked).map((k) => [k, true]));
      await api.savePerson({ ...p, tehillim: Object.keys(th).length ? th : null });
      await refresh(); (state.tehillimAt ??= {})[id] = 0; dlg.close(); render();
    } catch (err) { const e = f.querySelector('.err'); e.textContent = err.message; e.hidden = false; }
  });
  dlg.showModal();
}
function tehillimPage(id) {
  const owner = person(id);
  // Only your own (on your own profile): for anyone else's it isn't offered.
  if (!owner || id !== api.me) return notFound();
  const list = tehillimPeople(owner);
  const i = Math.max(0, Math.min(state.tehillimAt?.[id] ?? 0, list.length - 1));
  const p = list[i];
  const ch = chapterOf(p);
  tehillimShown = ch;
  const verses = ch ? chapterText(ch) : null;
  // The others' chapters too, so moving to the next card doesn't wait (only what isn't on the device yet).
  for (const x of list) { const n = chapterOf(x); if (n && n !== ch) chapterText(n); }
  const bday = formatDate(p, 'he');
  const nav2 = `<div class="tehillim-nav">
      <button type="button" class="pill" data-act="tehillim-go" data-id="${id}" data-i="${i - 1}" ${i ? '' : 'disabled'}>${t('prev')}</button>
      <span class="dots">${list.map((x, j) => `<button type="button" class="dot${j === i ? ' on' : ''}" data-act="tehillim-go" data-id="${id}" data-i="${j}" aria-label="${esc(first(x))}"></button>`).join('')}</span>
      <button type="button" class="pill" data-act="tehillim-go" data-id="${id}" data-i="${i + 1}" ${i < list.length - 1 ? '' : 'disabled'}>${t('nextOne')}</button>
    </div>`;
  return hero({
    left: backBtn(),
    gear: { act: 'tehillim-settings', id },
    body: `<div class="profile-head tehillim-head">
      ${avatar(p, 'xl', { camera: false })}
      <h1 class="hello he" dir="rtl">${esc(prayerName(p))}</h1>
      <p class="dim" dir="rtl">${bday ? `🎂 ${esc(bday)}` : ''}${ch ? ` · ${t('chapterN', 'he', gematriyaN(ch))}` : ''}</p>
    </div>`,
  }) + `<div class="tehillim-sticky" aria-hidden="true">
      ${avatar(p, 'sm', { camera: false })}
      <span><b class="he" dir="rtl">${esc(prayerName(p))}</b><small dir="rtl">${bday ? `🎂 ${esc(bday)}` : ''}${ch ? ` · ${t('chapterN', 'he', gematriyaN(ch))}` : ''}</small></span>
    </div>
    <main class="content">
    ${list.length > 1 ? nav2 : ''}
    ${!ch ? `<div class="card pad">${t('needBirthYear')} <a href="#/person/${p.id}">${t('addBirthday')}</a></div>`
      : !verses ? `<p class="empty">${t('rootsLoading')}</p>`
      : `<div class="card pad tehillim-text" dir="rtl" lang="he">
          <h2>${t('chapterN', 'he', gematriyaN(ch))}</h2>
          ${verses.map((v, n) => `<p><span class="vn">${gematriyaN(n + 1)}</span> ${esc(v)}</p>`).join('')}
        </div>`}
    ${list.length > 1 ? nav2 : ''}
  </main>${nav('search')}`;
}
const gematriyaN = (n) => dayName(n, 'he');   // the app's Hebrew numbers (א, ב… קנ)

// ---------- routing & rendering ----------

function emptyTree() { return `<main class="content"><p class="empty">${t('noCouples')}</p></main>`; }
function notFound() { location.hash = api.me ? '#/me' : '#/start'; return ''; }

function route() {
  // The bare address goes to the home screen if this device knows who you are, otherwise to step 1;
  // the address bar is updated to say which (#/home or #/start).
  if (!location.hash.replace(/^#\/?/, '')) history.replaceState(null, '', hasMe() ? '#/home' : '#/start');
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'me') return hasMe() ? ['person', api.me] : ['start'];
  return [name, id];
}

function render() {
  dupCache = {};
  relCache.clear();
  // The games' progress for whoever is signed in (nothing to do unless that changed). When the
  // database's copy comes in, a game on screen picks its question again from it.
  loadProgress().then((fresh) => {
    if (!fresh) return;
    quiz.q = bday.q = inlaw.q = kids.q = null;
    if (route()[0] === 'quiz') render();
  });
  const [name, id] = route();
  const screens = {
    start: step1, step2, step3, add: addPage, family: familyPage, person: () => personPage(id), tehillim: () => tehillimPage(id), famous: famousPage,
    search: searchPage, roots: () => rootsPage(id), tree: treePage, chart: () => chartPage(id), news: newsPage, home: homePage, quiz: () => quizScreen(id), archived: archivedPage,
  };
  // Steps 2 and 3 need the answers from before them.
  const w = state.wiz;
  let screen = screens[name] ?? step1;
  if ((name === 'step2' && !w.rel) || (name === 'step3' && !w.parents)) screen = step1;
  $('#app').innerHTML = `<div class="screen screen-${name}">${screen()}</div>`;
  if (name === 'chart') t2afterRender();
  else if (t2.full) t2setFull(false);   // leaving the tree ends its full screen
}

/** Takes in the tree as loaded. Archived people are kept apart (state.archived, for the Archived
 *  profiles page) and left out of everything else; a couple with an archived spouse shows the other
 *  one alone. */
function setTree(data) {
  const archived = data.people.filter((p) => p.archived_at);
  const gone = new Set(archived.map((p) => p.id));
  const couples = data.couples.flatMap((c) => {
    const a = gone.has(c.a) ? null : c.a, b = c.b && !gone.has(c.b) ? c.b : null;
    return a || b ? [Object.assign(c, { a: a ?? b, b: a ? b : null })] : [];
  });
  Object.assign(state, data, { people: data.people.filter((p) => !gone.has(p.id)), couples, archived });
}

async function refresh() {
  setTree(await api.load());
  render();
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); if (route()[0] === 'search') $('#q')?.focus(); });

document.addEventListener('toggle', (ev) => {
  const id = ev.target.dataset?.couple;
  if (!id || !state.treeOpen) return;
  if (ev.target.open) state.treeOpen.add(id); else state.treeOpen.delete(id);
}, true);

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.closest('dialog')) return;
  const w = state.wiz;
  const { act, id } = el.dataset;
  switch (act) {
    case 'lang': setLang(el.dataset.lang); return render();
    case 'branch': state.offBranches.has(id) ? state.offBranches.delete(id) : state.offBranches.add(id); return render();
    case 'wider': state.wider = !state.wider; storeSet('tree.wider', state.wider ? '1' : '0'); return render();
    case 'wider-on': state.wider = true; storeSet('tree.wider', '1'); return render();
    case 't2-card': return t2sheet(id);
    case 't2-root': if (decodeURIComponent(route()[1] ?? '') !== id) location.hash = `#/chart/${encodeURIComponent(id)}`; return;
    case 't2-me': {
      // your own tree; already there: back to yourself in the middle of the view
      if (decodeURIComponent(route()[1] ?? '') === api.me) { delete t2.pos[api.me]; return render(); }
      location.hash = `#/chart/${api.me}`; return;
    }
    case 't2-full': return t2setFull(!t2.full);
    case 't2-settings': return t2settings();
    case 'item-add': return itemAddSheet(id);
    case 'same-more': state.sameShown = { id, n: Number(el.dataset.n) }; return render();
    case 'items-edit': state.itemsEdit = state.itemsEdit === id ? null : id; return render();
    case 'item-edit': { const { person: who, it } = itemHome(id); return it ? itemEditSheet(who, it) : null; }
    case 'item-move': {
      const { person: who } = itemHome(id);
      if (who) api.saveItem(id, { move: el.dataset.dir }).then((list) => { state.items.set(who, list); render(); }).catch((e) => alert(t('saveErr') + e.message));
      return;
    }
    case 'item-delete': {
      const { person: who, it } = itemHome(id);
      if (!it || !confirm(t('itemRemoveConfirm', getLang(), it.title || it.file_name || ''))) return;
      api.deleteItem(id).then(() => { state.items.set(who, state.items.get(who).filter((x) => x.id !== it.id)); render(); }).catch((e) => alert(t('saveErr') + e.message));
      return;
    }
    case 'roots-edit': return openRootsSheet(el.dataset.field, el.dataset.id);
    case 'roots-photo': return pickPhoto(`roots:${el.dataset.id}`);
    case 'roots-zoom': return rootsZoom(el.dataset.id, Number(el.dataset.i));
    case 'roots-add-gallery': return pickPhoto(`roots-gallery:${el.dataset.id}`);
    case 'tehillim-settings': return openTehillimSettings(el.dataset.id);
    case 'tehillim-go': (state.tehillimAt ??= {})[el.dataset.id] = Number(el.dataset.i); render(); return window.scrollTo(0, 0);
    case 'matzeiva-add': return pickPhoto(`matzeiva:${el.dataset.id}`);
    case 'grade-edit': return openGradeSheet(el.dataset.pid);
    case 'burial-edit': return openBurialSheet(el.dataset.kind, el.dataset.id);
    case 'roots-matzeiva-add': return pickPhoto(`roots-matzeiva:${el.dataset.id}`);
    case 'roots-book-add': return pickPhoto(`roots-book:${el.dataset.id}`);
    case 'roots-book-zoom': {
      const g = rootsBookOf(el.dataset.id), p = state.roots.byId.get(el.dataset.id);
      return matzeivaZoom(g, api.rootsGalleryUrl(g), api.rootsGalleryUrl(g, true), `roots-book:${p.id}`,
        async () => { await api.deleteRootsGalleryPhoto(g.id); state.roots.photos = state.roots.photos.filter((x) => x.id !== g.id); render(); }, rootsName(p), 'bookPage');
    }
    case 'matzeiva-zoom': {
      const g = matzeivaOf(el.dataset.id), p = person(el.dataset.id);
      return matzeivaZoom(g, g.url, api.originalUrl('gallery', g.id, g.url), `matzeiva:${p.id}`, async () => { await api.deleteGalleryPhoto(g.id); await refresh(); }, withZl(p, full(p)));
    }
    case 'roots-matzeiva-zoom': {
      const g = rootsMatzeivaOf(el.dataset.id), p = state.roots.byId.get(el.dataset.id);
      return matzeivaZoom(g, api.rootsGalleryUrl(g), api.rootsGalleryUrl(g, true), `roots-matzeiva:${p.id}`,
        async () => { await api.deleteRootsGalleryPhoto(g.id); state.roots.photos = state.roots.photos.filter((x) => x.id !== g.id); render(); }, rootsName(p));
    }
    case 'quiz-answer':
      if (!quiz.q || quiz.q.answer != null) return;
      quiz.q.answer = id;
      quiz.total++;
      if (id === quiz.q.p.id) { quiz.right++; quiz.streak++; } else quiz.streak = 0;
      record('who', quiz.q.key, id === quiz.q.p.id);
      if (quiz.recall) nextQuestion();   // marked yourself: on to the next photo
      return render();
    case 'quiz-reveal': if (quiz.q) quiz.q.revealed = true; return render();
    case 'quiz-next': nextQuestion(); return render();
    // Nothing due (or everyone known): ask the shakiest ones anyway, for the rest of this visit.
    case 'quiz-practice': quiz.practice = true; nextQuestion(); return render();
    case 'bday-answer': {
      if (!bday.q || bday.q.answer != null) return;
      const ok = id === bdayRight(bday.q);
      bday.q.answer = id;
      bday.total++;
      if (ok) { bday.right++; bday.streak++; } else bday.streak = 0;
      record('bday', bday.q.key, ok);
      if (quiz.recall) nextBday();   // marked yourself: on to the next photo
      return render();
    }
    case 'bday-reveal': if (bday.q) bday.q.revealed = true; return render();
    case 'bday-next': nextBday(); return render();
    case 'bday-recall-on': quiz.recall = true; try { localStorage.setItem('tree.quiz.recall', '1'); } catch {} bday.practice = true; nextBday(); return render();
    case 'bday-practice': bday.practice = true; nextBday(); return render();
    case 'bday-settings': return bdaySettings();
    case 'game-info': {   // a game's ⓘ: show or hide the note under its description
      const note = el.closest('.home-head')?.querySelector('.game-note');
      if (note) { note.hidden = !note.hidden; el.setAttribute('aria-expanded', String(!note.hidden)); }
      return;
    }
    case 'inlaw-answer': {
      if (!inlaw.q || inlaw.q.answer != null) return;
      const ok = id === inlaw.q.rightId;
      inlaw.q.answer = id;
      inlaw.total++;
      if (ok) { inlaw.right++; inlaw.streak++; } else inlaw.streak = 0;
      record('inlaw', inlaw.q.key, ok);
      if (quiz.recall) nextInlaw();   // marked yourself: on to the next photo
      return render();
    }
    case 'inlaw-reveal': if (inlaw.q) inlaw.q.revealed = true; return render();
    case 'inlaw-next': nextInlaw(); return render();
    case 'inlaw-practice': inlaw.practice = true; nextInlaw(); return render();
    case 'inlaw-settings': return inlawSettings();
    case 'kids-answer': {
      if (!kids.q || kids.q.answer != null) return;
      const ok = id === kids.q.rightId;
      kids.q.answer = id;
      kids.total++;
      if (ok) { kids.right++; kids.streak++; } else kids.streak = 0;
      record('kids', kids.q.key, ok);
      if (quiz.recall) nextKid();   // marked yourself: on to the next photo
      return render();
    }
    case 'kids-reveal': if (kids.q) kids.q.revealed = true; return render();
    case 'kids-next': nextKid(); return render();
    case 'kids-practice': kids.practice = true; nextKid(); return render();
    case 'kids-settings': return kidsSettings();
    // Learn a family.
    case 'fam-pick':
      fam.cid = id; fam.picking = false; fam.tab = 'study'; fam.hide = false; fam.shown.clear(); fam.q = null; fam.done = false; fam.recent = [];
      try { localStorage.setItem('tree.fam.couple', id); } catch { /* fine */ }
      render(); return window.scrollTo(0, 0);
    case 'fam-change': fam.picking = true; return render();
    case 'fam-tab': fam.tab = el.value; return render();
    case 'fam-hide': fam.hide = el.checked; fam.shown.clear(); return render();
    // A card opens the profile; while the names are hidden, the first tap shows the name.
    case 'fam-card':
      if (fam.hide && !fam.shown.has(id)) { fam.shown.add(id); return render(); }
      location.hash = `#/person/${id}`;
      return;
    case 'fam-answer': {
      if (!fam.q || fam.q.answer != null) return;
      const ok = id === fam.q.p.id;
      fam.q.answer = id;
      fam.total++;
      if (ok) { fam.right++; fam.streak++; } else fam.streak = 0;
      record('who', fam.q.key, ok);
      if (quiz.recall) nextFam();   // marked yourself: on to the next one
      return render();
    }
    case 'fam-reveal': if (fam.q) fam.q.revealed = true; return render();
    case 'fam-next': nextFam(); return render();
    case 'bday-level': bday.levels.add(Number(id)); saveLevels(); bday.practice = false; nextBday(); return render();
    case 'back': return history.length > 1 ? history.back() : (location.hash = '#/start');
    case 'rel': w.rel = el.dataset.v; saveWiz(); return render();
    case 'step1-next':
      Object.assign(w, { path: [], pick: null, self: null, parents: w.rel === 'parents' ? rootCouple().id : null });
      saveWiz();
      location.hash = w.rel === 'parents' ? '#/step3' : '#/step2';
      return;
    case 'pick': w.pick = id; saveWiz(); return render();
    case 'step2-next':
      w.path.push(w.pick);
      if (DEPTH[w.rel] - w.path.length <= 0) { w.parents = w.pick; w.pick = null; w.self = null; saveWiz(); location.hash = '#/step3'; return; }
      w.pick = null; saveWiz(); render(); return window.scrollTo(0, 0);
    case 'self': {
      const sp = spouseOf(id);
      // The card of someone who passed away picks their living husband or wife.
      const pick = person(id)?.deceased ? sp?.id : id;
      if (!pick || person(pick)?.deceased) return;
      // Tapping the card again shouldn't undo picking the spouse in it.
      if (!(el.classList.contains('choice') && sp && w.self === sp.id)) w.self = pick;
      saveWiz();
      return render();
    }
    case 'step3-yes': if (!w.self || person(w.self)?.deceased) return; api.me = w.self; location.hash = '#/home'; return;
    case 'not-me': location.hash = '#/start'; return;
    case 'pdf': return pdfSheet();
    case 'demo-reset': api.resetDemo(); location.hash = ''; location.reload(); return;
    case 'export': exportSheet(el.dataset.cid); return;
    case 'missing': return missingSheet(el.dataset.pid);
    case 'quiz-settings': return quizSettings();
    case 'calendar': return calendarSheet();
    case 'archive': {
      const p = person(el.dataset.pid);
      if (!confirm(t('archiveConfirm', getLang(), full(p)))) return;
      return api.archive(p.id, true).then(() => { location.hash = '#/tree'; return refresh(); }).catch((err) => alert(t('saveErr') + err.message));
    }
    case 'restore':
      return api.archive(el.dataset.pid, false).then(refresh).catch((err) => alert(t('saveErr') + err.message));
    case 'logout':
      if (!confirm(t('logoutConfirm'))) return;
      return api.logout().then(() => { location.hash = ''; location.reload(); });
    case 'photo': return pickPhoto(el.dataset.pid);
    case 'family-photo': return pickPhoto(`family:${el.dataset.cid}`);
    case 'zoom-family': {
      const c = couple(el.dataset.cid);
      return showLarge({ src: c.photo, caption: familyCaption(c), wide: true, onChange: () => pickPhoto(`family:${c.id}`), download: api.originalUrl('family', c.id, c.photo) });
    }
    case 'zoom': return zoomPhoto(el.dataset.pid);
    case 'zoom-gallery': return zoomPhoto(el.dataset.pid, Number(el.dataset.i));
    case 'add-gallery': return pickPhoto(`gallery:${el.dataset.pid}`);
    case 'edit': ev.preventDefault(); return openSheet(el.dataset.field, el.dataset.pid);
    case 'edit-couple': {
      ev.preventDefault();   // inside a branch's row: don't open or close it
      const c = couple(el.dataset.cid);
      const pair = [person(c.a), person(c.b)].filter(Boolean);
      const dlg = $('#sheet');
      dlg.innerHTML = `<form method="dialog" class="sheet-form"><h2>${t('whoseProfile')}</h2>
        <div class="who-pick">${pair.map((p) => `<a href="#/person/${p.id}" data-pick>${avatar(p, 'sm', { camera: false })}<span class="he">${esc(named(p))}</span></a>`).join('')}</div>
        <div class="actions"><button type="button" class="pill" data-pick>${t('cancel')}</button></div></form>`;
      dlg.querySelectorAll('[data-pick]').forEach((x) => x.addEventListener('click', () => dlg.close()));
      return dlg.showModal();
    }
    case 'filter': state.filter = el.dataset.f; return render();
    case 'focus-sibling': return document.querySelector('[data-form="sibling"] input[name="first"]')?.focus();
    case 'focus-child': return document.querySelector('[data-form="child"] input[name="first"], [data-form="draft-child"] input')?.focus();
    case 'draft-picking': state.draft.picking = true; return render();
    case 'draft-parents': {
      const d = state.draft;
      d.parents = id || null;
      d.picking = !d.parents;
      const pa = d.parents && person(couple(d.parents).a);
      if (pa && !d.he_last && !d.en_last) Object.assign(d, { he_last: pa.he_last ?? '', en_last: pa.en_last ?? '' });
      return render();
    }
    case 'draft-child-remove': state.draft.children.splice(Number(el.dataset.i), 1); return render();
    case 'draft-submit': return submitDraft();
  }
});

// Step 2's back button walks back up the tree before leaving the step.
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('.screen-step2 [data-act="back"]')) return;
  const w = state.wiz;
  if (w.path.length) {
    ev.stopImmediatePropagation();
    w.pick = w.path.pop();
    saveWiz();
    render();
  }
}, true);

document.addEventListener('change', (ev) => {
  const act = ev.target.dataset?.act;
  if (act !== 'quiz-scope') return;
  quiz.mine = ev.target.value === 'mine';
  localStorage.setItem('tree.quiz.mine', quiz.mine ? '1' : '0');
  nextQuestion();
  render();
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'q') { state.q = ev.target.value; $('#results').innerHTML = searchResults(); return; }
  // Learn a family: the search box narrows the list of families (by anyone's name in them).
  if (ev.target.id === 'famq') {
    const q = ev.target.value.trim().toLowerCase();
    document.querySelectorAll('.fam-pick').forEach((b) => { b.hidden = Boolean(q) && !b.dataset.search.includes(q); });
    return;
  }
  const key = ev.target.dataset?.draft;
  if (!key || !state.draft) return;
  const path = key.split('.');
  const obj = path.slice(0, -1).reduce((o, k) => o[k], state.draft);
  obj[path.at(-1)] = ev.target.value;
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('[data-form]');
  if (!form) return;
  ev.preventDefault();
  if (form.dataset.form === 'draft-child') {
    const name = form.child.value.trim();
    if (name) state.draft.children.push(name);
    render();
    return document.querySelector('[data-form="draft-child"] input')?.focus();
  }
  // A child of this person's couple (someone with no spouse yet gets a couple of one), or, from the
  // sibling form, another child of the same parents.
  const pid = form.dataset.pid;
  const firstName = form.first.value.trim(), lastName = form.last.value.trim();
  if (!firstName || form.dataset.busy) return;
  form.dataset.busy = '1';
  form.querySelector('button')?.setAttribute('disabled', '');
  // The same id for every try of this name, so pressing Save again after an error can't add twice.
  form.dataset.newId ||= crypto.randomUUID();
  try {
    const c = form.dataset.couple ? couple(form.dataset.couple) : coupleOf(pid) ?? await api.addCouple(pid);
    const kid = {
      [isHebrew(firstName) ? 'he_first' : 'en_first']: firstName,
      [isHebrew(lastName) ? 'he_last' : 'en_last']: lastName || null,
      parents: c.id,
      sex: form.sex?.value || null,
    };
    await api.savePerson(kid, form.dataset.newId);
    delete form.dataset.newId;
    await refresh();
    document.querySelector(`[data-form="${form.dataset.form}"] input[name="first"]`)?.focus();
  } catch (err) {
    alert(t('saveErr') + err.message);
  } finally {
    delete form.dataset.busy;
    form.querySelector('button')?.removeAttribute('disabled');
  }
});

// ---------- login ----------

async function login() {
  const dlg = $('#login');
  dlg.innerHTML = `<form method="dialog" class="sheet-form">
    <h2>🌳 ${t('treeOf', getLang(), t('appName'))}</h2>
    <p>${t('loginText')}</p>
    ${DEMO ? `<p class="demo-pass">${t('demoPassword', getLang(), DEMO_PASSWORD)}</p>` : ''}
    <input type="password" name="password" autocomplete="current-password" required autofocus aria-label="Password" />
    <p class="err" hidden>${t('loginWrong')}</p>
    <button class="cta small">${t('loginBtn')}</button>
  </form>`;
  const f = dlg.querySelector('form');
  dlg.showModal();
  await new Promise((resolve) => {
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (await api.login(f.password.value)) { dlg.close(); resolve(); }
      else f.querySelector('.err').hidden = false;
    });
  });
}

async function load() {
  // Someone who picked a person who has passed away as themselves picks again.
  const checkMe = () => { if (api.me && person(api.me)?.deceased) api.me = null; else if (api.me && person(api.me)) api.me = api.me; };
  // At once from the tree this browser kept last time; the fresh one replaces it when it comes (drawn again
  // only if anything changed, and not under someone who is typing or has a window open).
  const old = await api.cached();
  if (old) {
    const oldText = api.treeText;
    setTree(old); checkMe(); render();
    api.load().then((fresh) => {
      if (api.treeText === oldText) return;
      setTree(fresh); checkMe();
      if (!document.querySelector('dialog[open]') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) render();
    }).catch(async (err) => {
      if (!err.login) return;   // no network: keep what's shown
      // the session is over: nothing kept or shown until the password is given again
      api.clearCache(); document.getElementById('app').innerHTML = '';
      await login(); setTree(await api.load()); checkMe(); render();
    });
    return;
  }
  try {
    try {
      setTree(await api.load());
    } catch (err) {
      if (!err.login) throw err;
      await login();
      setTree(await api.load());
    }
  } catch (err) {
    // The tree didn't arrive (an error page, no network): say so instead of a blank screen.
    document.getElementById('app').innerHTML = `<main class="narrow"><p class="err" role="alert">${esc(t('loadErr') + err.message)}</p>
      <button type="button" class="cta" onclick="location.reload()">${t('reload')}</button></main>`;
    throw err;
  }
  checkMe();
  render();
}

load();
