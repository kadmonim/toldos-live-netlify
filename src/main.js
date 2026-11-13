import { api, DEMO, DEMO_PASSWORD } from './api.js';
import { t, getLang, otherLang, setLang, setFamily } from './i18n.js';
import { familyOfHost, adminOf } from '../netlify/lib/families.mjs';
import { HDate, ADAR, LEAP_REF, pickerMonths, monthForYear, monthName, dayName, formatDate, fromCivil, upcoming, inYear, monthsOfYear } from './hebrew.js';

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
};
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
const heart = (c) => (c.apart ? '<span class="heart-gap" aria-hidden="true"></span>'
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
const nameLine = (name, sp) => [name && `<bdi>${esc(name)}</bdi>`, sp && `${coupleOf(sp.id)?.apart ? '' : isEngaged(coupleOf(sp.id)) ? '<span class="love">💍</span> ' : '<span class="love">♥</span> '}<bdi>${esc(first(sp))}</bdi>`]
  .filter(Boolean).join(' · ');
const withZl = (p, s, l = getLang()) => (p.deceased ? s + t('zl', l) : s);

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
/** The full name, with a tag after it when someone else in the tree has the same one. */
const named = (p, l = getLang()) => [full(p, l), nameTag(p, l)].filter(Boolean).join(' ');
/** The first name, tagged the same way, for lines that mention a person by first name only. */
const firstNamed = (p, l = getLang()) => [first(p, l), nameTag(p, l)].filter(Boolean).join(' ');
const coupleName = (c, l = getLang()) => [person(c.a), person(c.b)].filter(Boolean).map((p) => first(p, l)).join(' & ');

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
  quiz: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="8.5" stroke="currentColor" stroke-width="2"/><path d="M8.3 8.6C8.5 7.2 9.6 6.3 11 6.3C12.5 6.3 13.6 7.3 13.6 8.6C13.6 10.3 11 10.5 11 12.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="11" cy="15.4" r="1.2" fill="currentColor"/></svg>',
  trophy: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M7 3H15V12C15 14.21 13.21 16 11 16C8.79 16 7 14.21 7 12V3Z" stroke="currentColor" stroke-width="2"/><path d="M7 6H4C4 8.76 5.79 11.08 8.27 11.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 6H18C18 8.76 16.21 11.08 13.73 11.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M11 16V19M8 19H14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
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
const galleryOf = (pid) => state.photos.filter((g) => g.person === pid);

/**
 * All of a person's pictures, large: the profile photo first, then the gallery; prev/next (or the
 * arrow keys, or a swipe) flips through them. `start` is the index to open on.
 */
function zoomPhoto(pid, start = 0) {
  const p = person(pid);
  const name = withZl(p, full(p));
  const items = [
    ...(p.photo ? [{ src: p.photo, caption: name, onChange: () => pickPhoto(pid), download: api.originalUrl('person', pid, p.photo) }] : []),
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
function hero({ left, center = '', progress, label, labelSub, body = '', cls = '', exit = false }) {
  const out = exit && hasMe() ? `<a class="pill-exit" href="#/me">${ICON.close}<span>${t('exit')}</span></a>` : '';
  return `<header class="hero ${cls}">
    <div class="deco d1"></div><div class="deco d2"></div><div class="deco d3"></div>
    <div class="topbar">${left}${center}<div class="top-end">${out}${langToggle()}</div></div>
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
const birthdayLine = (p) => {
  const d = formatDate(p, getLang());
  return d ? `<span class="bday">🎂 ${esc(d)}</span>` : `<span class="bday missing">🎂 ${t('missing')}</span>`;
};

function nav(active) {
  const item = (key, href, icon, cls = '') => `<a class="${active === key ? 'on' : ''} ${cls}" href="${href}" ${active === key ? 'aria-current="page"' : ''}>${icon}<span>${t(`nav_${key}`)}</span></a>`;
  return `<nav class="nav ${active === 'complete' ? 'coral' : ''}">
    ${item('home', '#/home', ICON.home)}
    ${item('search', '#/search', ICON.search)}
    ${item('tree', '#/tree', ICON.tree)}
    ${CALENDAR_URL ? `<a href="${esc(CALENDAR_URL)}">${ICON.events}<span>${t('nav_events')}</span></a>` : ''}
    ${item('complete', '#/family', ICON.trophy)}
    ${item('quiz', '#/quiz', ICON.quiz)}
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
  const names = (l) => [[a, 'zaidy'], [b, 'bubby']].filter(([p]) => p).map(([p, k]) => withZl(p, `${t(k, l)} ${first(p, l)}`, l)).join(' & ');
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
            <span class="title he">${esc(first(p))}</span>
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
  const sibs = pc ? childrenOf(pc.id).filter((x) => x.id !== p.id) : [];
  const canAddSibs = Boolean(pc) && !closed(pc);
  // No spouse section for children: only for adults (married, 18+, or by generation without a year).
  const showSpouse = Boolean(sp) || isAdult(p);
  // Without a birth year we can't tell a child from a married grandchild (in a big family, many
  // great-grandchildren are married): offer adding a spouse quietly, without flagging it as missing.
  const maybeSpouse = !showSpouse && !p.h_year && !p.deceased;
  const subLine = [p.he_full !== p.he_first && p.he_full, p.maiden && t('nee', getLang(), p.maiden), fullIn(p, otherLang()) && withZl(p, fullIn(p, otherLang()), otherLang()), cityOf(p)].filter(Boolean).join(' · ');

  return hero({
    cls: 'tall',
    left: backBtn(),
    center: isMe ? `<span class="pill-welcome">${t('welcome')}</span>` : '',
    body: `<div class="profile-head">
      ${avatar(p, 'xl')}
      <div class="name-line"><h1 class="hello">${esc(isMe ? t('hello', getLang(), first(p)) : withZl(p, named(p)))}</h1><button type="button" class="pencil on-hero" data-act="edit" data-field="names" data-pid="${id}" aria-label="${esc(t('editName'))}">✏️</button></div>
      <p class="dim">${esc(subLine)}</p>
      <button type="button" class="complete-box" data-act="missing" data-pid="${id}" ${left ? '' : 'disabled'}>
        <span class="progress-labels"><span>${t(family ? (isMe ? 'myFamilyPct' : 'familyPct') : (isMe ? 'myPct' : 'pct'), getLang(), pct)}</span><span class="dim">${left ? `${t('nMissingItems', getLang(), left)} ›` : t('allFilled')}</span></span>
        <span class="bar thick"><span class="warm" style="width:${pct}%"></span></span>
      </button>
    </div>`,
  }) + `<main class="content">
    <div class="sec-head"><h2>${t(isMe ? 'myInfo' : 'info')}</h2></div>
    <div class="card list">${fields.map((k) => infoRow(p, k)).join('')}${galleryRow(p)}</div>

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
      ${annivRow(p, c)}` : `<button type="button" class="person-row empty-row" data-act="edit" data-field="spouse" data-pid="${id}">
        <span class="av av-md dashed" aria-hidden="true">${ICON.plus}</span>
        <span class="person-text"><span class="sub">${t('noSpouse')}</span></span>
        <span class="chip amber solid">${t('add')}</span>
      </button>`}
    </div>` : maybeSpouse ? `<div class="sec-head"><h2>${t('spouse')}</h2><button type="button" class="link" data-act="edit" data-field="spouse" data-pid="${id}">${t('addSpouse')}</button></div>` : ''}
    ${sp ? `<div class="sec-head"><h2>${t('familyPhoto')}</h2></div>${familyPhoto(c)}` : ''}

    ${kids.length || canAddKids ? `<div class="sec-head"><h2>${t('children')}</h2>${canAddKids ? `<button type="button" class="link" data-act="focus-child">${t('addChild')}</button>` : ''}</div>` : ''}
    ${kids.length ? `<div class="card list">${kids.map((k) => relativeRow(k, 'status', p)).join('')}</div>` : ''}
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
    <div class="card list">${parentRows.map((x) => relativeRow(x, 'edit', p)).join('')}</div>
    ${pc.root ? '' : familyPhoto(pc)}` : ''}

    ${!pc ? `<div class="sec-head"><h2>${t('parents')}</h2></div>
    <div class="card list">${parentNamesRow(p)}</div>` : ''}

    ${inLawRows.length ? `<div class="sec-head"><h2>${t('inLaws')}</h2></div>
    <div class="card list">${inLawRows.map((x) => relativeRow(x, 'edit', p)).join('')}</div>` : ''}

    ${grandRows.length ? `<div class="sec-head"><h2>${t('grandparents')}</h2></div>
    <div class="card list">${grandRows.map((x) => relativeRow(x, 'edit', p)).join('')}</div>` : ''}

    ${sibs.length || canAddSibs ? `<div class="sec-head"><h2>${t('siblings')}</h2>${canAddSibs ? `<button type="button" class="link" data-act="focus-sibling">${t('addSibling')}</button>` : ''}</div>` : ''}
    ${sibs.length ? `<div class="card list">${sibs.map((x) => relativeRow(x, 'status', p)).join('')}</div>` : ''}
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
  </main>${nav('tree')}`;
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
            <span class="title he">${esc(withZl(p, named(p)))}</span>
            <span class="sub">${nameLine(fullIn(p, otherLang()), sp)}</span>
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
  return upRow({ hd, days, emoji, title, sub, link, face, who, msg, big });
}

/** One row of "coming up" or "Mazal tov": when (in 3 days, today, 5 days ago) over the Hebrew date,
 *  the face, the name over what it is, and a WhatsApp button to the first of `who` with a mobile. */
function upRow({ hd, days, emoji, title, sub, link, face, who = [], msg, big }) {
  const L = getLang();
  const when = days === 0 ? t('today') : days === 1 ? t('tomorrow') : days === -1 ? t('yesterday') : days > 0 ? t('inDays', L, days) : t('daysAgo', L, -days);
  const date = formatDate({ h_day: hd.getDate(), h_month: hd.getMonth() }, L);
  const wa = who.filter((x) => x && !x.deceased).map((x) => waNumber(x.phone)).find(Boolean);
  return `<div class="up-item${wa ? ' has-wa' : ''}"><a class="up-row ${days === 0 ? 'today' : ''} ${big ? 'mitzvah' : ''}" href="#/person/${link}">
    <span class="up-when"><span class="up-day">${esc(when)}</span><span class="up-date he">${esc(date)}</span></span>
    ${face}
    <span class="person-text"><span class="title he">${esc(title)}</span><span class="sub"><span aria-hidden="true">${emoji}</span> ${esc(sub)}</span></span>
  </a>${wa ? `<a class="wa" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" aria-label="${esc(t('whatsappMazalTov'))}" title="${esc(t('whatsappMazalTov'))}">${ICON.whatsapp}</a>` : ''}</div>`;
}

function homePage() {
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

    <div class="sec-head"><h2>${t('comingUp')}</h2></div>
    ${ups.length ? `<div class="card list">${ups.map(upcomingRow).join('')}</div>` : `<p class="empty">${t('nothingSoon')}</p>`}

    ${needy ? `<a class="card pad nudge" href="#/family"><span class="nudge-icon" aria-hidden="true">🏆</span>
      <span class="person-text"><span class="title">${t('nudgeTitle', getLang(), needy)}</span><span class="sub">${t('nudgeSub')}</span></span>
      <span class="chip pink">${t('nudgeGo')}</span></a>` : ''}

    ${photos >= 4 ? `<a class="card pad nudge" href="#/quiz"><span class="nudge-icon" aria-hidden="true">🎯</span>
      <span class="person-text"><span class="title">${t('quizCard')}</span><span class="sub">${t('quizCardSub')}</span></span>
      <span class="chip lilac">${t('quizGo')}</span></a>` : ''}

    <div class="sec-head"><h2>${t('whatsNew')}</h2></div>
    ${feed.length ? `<div class="card list">${feed.map(feedRow).join('')}</div>` : `<p class="empty">${t('noNews')}</p>`}
    ${localNote()}
  </main>${nav('home')}`;
}

// ---------- quiz: who is this? ----------

// One photo, four names. Everyone with a photo comes up once before anyone repeats; the wrong
// names are other people in the tree (never a namesake of the right answer).
const quiz = { q: null, right: 0, total: 0, streak: 0, seen: new Set(), mine: localStorage.getItem('tree.quiz.mine') === '1',
  sameSex: localStorage.getItem('tree.quiz.sameSex') === '1',
  // The advanced way: no names to pick from. Think of the name, reveal it, and say whether you had it.
  recall: localStorage.getItem('tree.quiz.recall') === '1',
  // Generations left out of the quiz (1 = the top couple's children, 2 = grandchildren, …).
  gensOff: new Set((() => { try { return JSON.parse(localStorage.getItem('tree.quiz.gensOff')) ?? []; } catch { return []; } })()) };
// What this device remembers for the person signed in: who they've named right (not asked again
// until everyone is known) and who they got wrong (asked again sooner).
const memKey = () => `tree.quiz.known.${api.me ?? 'anon'}`;
const quizMemory = () => { try { return JSON.parse(localStorage.getItem(memKey())) ?? {}; } catch { return {}; } };
const remember = (pid, ok) => { const m = quizMemory(); m[pid] = ok ? 'right' : 'wrong'; localStorage.setItem(memKey(), JSON.stringify(m)); };
const forgetAll = () => localStorage.removeItem(memKey());
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const quizName = (p) => withZl(p, named(p));

/** A couple by first names with the family name once, the husband first: "Yitzchak & Rivka Rosenfeld". */
function pairName(c, l = getLang()) {
  const both = [person(c.a), person(c.b)].filter(Boolean).sort((x, y) => (y.sex === 'm') - (x.sex === 'm'));
  return [both.map((x) => first(x, l)).join(' & '), both[0] && last(both[0], l)].filter(Boolean).join(' ');
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
  const people = branch ? state.people.filter((p) => p.id === branch.id || branchOf(p)?.id === branch.id) : state.people;
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
    if (f.sameSex) { quiz.sameSex = f.sameSex.checked; localStorage.setItem('tree.quiz.sameSex', quiz.sameSex ? '1' : '0'); }
    quiz.gensOff = new Set(boxes.filter((b) => !b.checked).map((b) => Number(b.value)));
    localStorage.setItem('tree.quiz.gensOff', JSON.stringify([...quiz.gensOff]));
    lock();
    // Only boys or only girls changes how many each generation has.
    const now = quizGenCounts();
    f.querySelectorAll('[data-gen]').forEach((n) => { n.textContent = genCount(now[n.dataset.gen], L); });
  });
  const apply = () => { quiz.seen.clear(); nextQuestion(); render(); };
  dlg.querySelector('[data-sheet="done"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', apply, { once: true });
  dlg.showModal();
}

function nextQuestion() {
  const people = quizPeople();
  const pool = people.filter((p) => p.photo);
  if (!pool.length || people.length < 4) { quiz.q = null; quiz.allKnown = false; return; }
  const mem = quizMemory();
  const left = pool.filter((p) => mem[p.id] !== 'right');
  if (!left.length) { quiz.q = null; quiz.allKnown = true; return; }
  quiz.allKnown = false;
  let fresh = left.filter((p) => !quiz.seen.has(p.id));
  if (!fresh.length) { quiz.seen.clear(); fresh = left; }
  // Someone you got wrong before comes up ahead of someone you've never been asked about.
  const missed = fresh.filter((p) => mem[p.id] === 'wrong');
  const from = missed.length && Math.random() < 0.6 ? missed : fresh;
  const p = from[Math.floor(Math.random() * from.length)];
  quiz.seen.add(p.id);
  // Wrong names are of the same sex (mixing men and women would give the answer away); people
  // whose sex isn't recorded fill in only when there aren't enough, and the other sex never does.
  // A small branch may not have three such people: then the rest of the family fills in.
  const names = new Set([quizName(p)]);
  const decoys = [];
  const inBranch = new Set(people.map((x) => x.id));
  const rest = state.people.filter((x) => x.id !== p.id && (!p.sex || !x.sex || x.sex === p.sex));
  const tier = (x) => (x.sex === p.sex ? 0 : 2) + (inBranch.has(x.id) ? 0 : 1);
  for (const x of shuffle(rest).sort((a, b) => tier(a) - tier(b))) {
    if (names.has(quizName(x))) continue;
    names.add(quizName(x));
    decoys.push(x);
    if (decoys.length === 3) break;
  }
  // Someone with gallery pictures as well is shown one of their pictures at random, the profile
  // photo included. A gallery picture is whole (not a face crop), so it's shown uncropped.
  const pics = [{ src: p.photo }, ...galleryOf(p.id).map((g) => ({ src: g.url, wide: true }))];
  const pic = pics[Math.floor(Math.random() * pics.length)];
  quiz.q = { p, pic, options: shuffle([p, ...decoys]), answer: null };
}

function quizPage() {
  if (!quiz.q) nextQuestion();
  const q = quiz.q;
  const L = getLang();
  const people = quizPeople();
  const head = hero({ left: brand(), body: `<div class="home-head"><h1 class="hello">${t('quizTitle')}</h1><p class="dim">${t('quizSub')}</p></div>` });
  const mine = hasMe() && branchOf(person(api.me));
  const toggle = mine ? `<div class="seg quiz-scope" role="radiogroup" aria-label="${t('quizScope')}">
      <label><input type="radio" name="scope" value="all" ${quiz.mine ? '' : 'checked'} data-act="quiz-scope" /><span>${t('quizAll')}</span></label>
      <label><input type="radio" name="scope" value="mine" ${quiz.mine ? 'checked' : ''} data-act="quiz-scope" /><span>${esc(t('quizMine', L, first(mine)))}</span></label>
    </div>` : '';
  // The gear for the settings sits on the tabs' row (alone at the end when there are no tabs).
  const bar = `<div class="quiz-bar">${toggle}<button type="button" class="quiz-gear" data-act="quiz-settings" aria-label="${esc(t('quizSettings'))}" title="${esc(t('quizSettings'))}">⚙️</button></div>`;
  // What's switched on there, in a few words after the score: "(boys & men only, 2 generations)".
  const sex = quiz.sameSex && mySex();
  const gensIn = quiz.gensOff.size ? [...new Set(state.people.filter((p) => p.photo).map(quizGen))].filter((g) => g && !quiz.gensOff.has(g)) : [];
  const only = [sex && t(sex === 'm' ? 'quizMaleOnly' : 'quizFemaleOnly'), gensIn.length === 1 ? t('quizOnly', L, genLabel(gensIn[0], L)) : gensIn.length ? t('quizNGens', L, gensIn.length) : ''].filter(Boolean).join(', ');
  if (!q) {
    const msg = quiz.allKnown
      ? `<div class="card pad quiz"><p class="quiz-result ok">${t('quizAllKnown')}</p><button type="button" class="cta small" data-act="quiz-reset">${t('quizAgain')}</button></div>`
      : `<p class="empty">${t('quizNoPhotos')}</p>`;
    return `${head}<main class="content">${bar}${msg}</main>${nav('quiz')}`;
  }
  const known = people.filter((x) => x.photo && quizMemory()[x.id] === 'right').length;
  const withPhoto = people.filter((x) => x.photo).length;
  const done = q.answer != null;
  const ok = done && q.answer === q.p.id;
  const cls = (o) => (!done ? '' : o.id === q.p.id ? 'ok' : o.id === q.answer ? 'bad' : '');
  // After any answer, where the person sits in the tree. It says whose child they are, so the name
  // beside it goes without its "(daughter of …)" tag.
  // Each part on its own line (parents, then grandparents), starting with a capital.
  const where = done || q.revealed ? quizWhere(q.p).map((x) => `<span>${esc(x.charAt(0).toUpperCase() + x.slice(1))}</span>`).join('') : '';
  return `${head}<main class="content">
    ${bar}
    <div class="card pad quiz">
      <p class="quiz-score">${esc(t('quizScore', L, quiz.right, quiz.total))}${quiz.streak >= 3 ? ` · ${esc(t('quizStreak', L, quiz.streak))}` : ''} · ${esc(t('quizKnown', L, known, withPhoto))}${only ? ` <span class="quiz-only">(${esc(only)})</span>` : ''}</p>
      <div class="quiz-photo${q.pic.wide ? ' wide' : ''}"><img src="${esc(q.pic.src)}" alt="" /></div>
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
      </div>` : ''}`}
    </div>
  </main>${nav('quiz')}`;
}

// ---------- search ----------

const plainHe = (s) => String(s ?? '').replace(/[֑-ׇ"'״׳`]/g, '').toLowerCase();
// "בן יוסף", "בת חיים", "son of Yosef": what follows is a parent's name.
const CHILD_OF = /(?:^|\s)(?:בן|בת|בר|ב"ר|son of|daughter of|child of)(?:\s|$)/i;
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
  const byParent = m ? matchPeople(words(raw.slice(0, m.index)), words(raw.slice(m.index + m[0].length))) : [];
  const seen = new Set(byName.map((p) => p.id));
  return byName.concat(byParent.filter((p) => !seen.has(p.id))).slice(0, 60);
}

/** People whose own names start with every word of `own` and whose parents' names with every word of `parent`. */
function matchPeople(own, parent) {
  if (!own.length && !parent.length) return [];
  const hit = (list, tok) => (list.includes(tok) ? 2 : list.some((w) => w.startsWith(tok)) ? 1 : 0);
  const out = [];
  for (const p of state.people) {
    const mine = words(p.he_first, p.he_full, p.en_first, p.he_last, p.en_last, p.maiden, p.nickname);
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
  if (!q.trim()) return `<p class="empty">${t('searchHint')}</p>`;
  const found = search(q);
  return found.length ? found.map((p) => personCard(p, birthdayLine(p))).join('') : `<p class="empty">${t('noResults')}</p>`;
}

function searchPage() {
  return hero({
    left: `<div class="title-block"><h1 class="hero-title">${t('searchTitle')}</h1><p class="dim">${t('searchTitle', otherLang())}</p></div>`,
    body: `<label class="search-box">${ICON.search}<input id="q" type="search" value="${esc(state.q ?? '')}" placeholder="${esc(t('searchPh'))}" aria-label="${esc(t('searchTitle'))}" autocomplete="off" enterkeyhint="search" /></label>`,
  }) + `<main class="content"><div id="results" aria-live="polite">${searchResults()}</div>${localNote()}</main>${nav('search')}`;
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
  const other = [a, b].filter(Boolean).map((p) => firstIn(p, otherLang())).filter(Boolean).join(' & ');
  const names = `<span class="tree-names"><span class="title he">${esc(withZl(a, first(a)))}${b ? ` & ${esc(withZl(b, first(b)))}` : ''}</span>
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
    blocks.push({ type: 'item', text: pair.map((x) => pdfName(x, L)).join(' & '), sub, depth, bold: true, keepWithNext: kids.length > 0 });
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
  return hero({
    left: `<div class="title-block"><h1 class="hero-title">${t('treeTitle')}</h1><p class="dim">${t('treeTitle', otherLang())}</p></div>`,
    center: `<button type="button" class="pill-pdf" data-act="pdf">📄 PDF</button>`,
  }) + `<main class="content tree">${treeNode(root)}
    <div class="profile-foot"><a class="escape quiet" href="#/archived">${t('archivedLink', getLang(), state.archived.length)}</a></div>
    ${localNote()}</main>${nav('tree')}`;
}

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
      ${p.maiden || (coupleOf(p.id) && p.sex !== 'm') ? input('maiden', t('maiden'), p.maiden) : ''}
      ${sexPick(p.sex)}`;
  } else if (field === 'spouse') {
    title = t('addSpouseTitle');
    body = `<div class="field-pair">${input('he_first', 'שם פרטי / כינוי', '', 'dir="rtl" class="he"')}${input('en_first', 'First name / Nickname', '', 'dir="ltr"')}</div>
      <div class="field-pair">${input('he_last', 'שם משפחה', p.he_last, 'dir="rtl" class="he"')}${input('en_last', 'Last name', p.en_last, 'dir="ltr"')}</div>
      ${sexPick(otherSex(p))}`;
  } else {
    const keys = field === 'contact' ? ['phone', 'email'] : field === 'parentNames' ? ['father_name', 'mother_name'] : [field];
    title = field === 'parentNames' ? `${t('parentNames')} · ${first(p)}` : `${keys.map((k) => fieldLabel(p, k)).join(' / ')} · ${first(p)}`;
    const type = { phone: 'tel', email: 'email', city: 'text', address: 'text', hobby: 'text', occupation: 'text', father_name: 'text', mother_name: 'text' };
    body = keys.map((k) => input(k, fieldLabel(p, k), k === 'address' ? FIELD.address.value(p) : p[k], `type="${type[k]}" ${['city', 'address', 'hobby', 'occupation', 'father_name', 'mother_name'].includes(k) ? (k === 'address' ? 'dir="auto"' : '') : 'dir="ltr"'} autocomplete="off"`)).join('');
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
        else for (const k of ['he_first', 'he_full', 'en_first', 'he_last', 'en_last', 'city', 'address', 'phone', 'email', 'hobby', 'occupation', 'maiden', 'father_name', 'mother_name']) if (f[k]) next[k] = val(k) || null;
        if (field === 'names') next.sex = f.sex.value || null;
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
  const [name, id] = route();
  const screens = {
    start: step1, step2, step3, add: addPage, family: familyPage, person: () => personPage(id),
    search: searchPage, tree: treePage, home: homePage, quiz: quizPage, archived: archivedPage,
  };
  // Steps 2 and 3 need the answers from before them.
  const w = state.wiz;
  let screen = screens[name] ?? step1;
  if ((name === 'step2' && !w.rel) || (name === 'step3' && !w.parents)) screen = step1;
  $('#app').innerHTML = `<div class="screen screen-${name}">${screen()}</div>`;
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
    case 'quiz-answer':
      if (!quiz.q || quiz.q.answer != null) return;
      quiz.q.answer = id;
      quiz.total++;
      if (id === quiz.q.p.id) { quiz.right++; quiz.streak++; } else quiz.streak = 0;
      remember(quiz.q.p.id, id === quiz.q.p.id);
      if (quiz.recall) nextQuestion();   // marked yourself: on to the next photo
      return render();
    case 'quiz-reveal': if (quiz.q) quiz.q.revealed = true; return render();
    case 'quiz-next': nextQuestion(); return render();
    case 'quiz-reset': forgetAll(); quiz.seen.clear(); nextQuestion(); return render();
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
  quiz.seen.clear();
  nextQuestion();
  render();
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'q') { state.q = ev.target.value; $('#results').innerHTML = searchResults(); return; }
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
  // Someone who picked a person who has passed away as themselves picks again.
  if (api.me && person(api.me)?.deceased) api.me = null;
  else if (api.me && person(api.me)) api.me = api.me;
  render();
}

load();
