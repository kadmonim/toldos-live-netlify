// Hebrew dates for birthdays. Month numbers are hebcal's, as in the calendar
// (1 Nisan … 7 Tishrei … 12 Adar/Adar I, 13 Adar II).
import { HDate, HebrewCalendar, gematriya, months } from '@hebcal/core';

export { HDate };

// When the year isn't known, month names come from a leap year so Adar I and Adar II both exist.
export const LEAP_REF = 5787;
const PLAIN_REF = 5786; // a regular year, for the name of plain Adar
/** Plain "Adar" for dates without a year, when the family doesn't know which Adar (or whether the
 *  year was a leap year). Falls in Adar in a regular year and Adar II in a leap year. Never stored
 *  together with a year: there the real month (12 or 13) is known. */
export const ADAR = 14;

const NIKUD = /[֑-ׇ]/g;

/** Months of a Hebrew year in calendar order, starting from Tishrei. */
export function monthsOfYear(hy) {
  const n = HDate.monthsInYear(hy);
  const list = [];
  for (let m = 7; m <= n; m++) list.push(m);
  for (let m = 1; m <= 6; m++) list.push(m);
  return list;
}

/** The months the date picker offers: the real months when the year is known, otherwise a leap
 *  year's months with plain Adar before Adar I and Adar II. */
export function pickerMonths(hy) {
  if (hy) return monthsOfYear(hy);
  const list = monthsOfYear(LEAP_REF);
  list.splice(list.indexOf(12), 0, ADAR);
  return list;
}

/** The month a picked month becomes when the year changes: plain Adar turns into Adar or Adar II,
 *  Adar II in a regular year into Adar, and Adar of a regular year into plain Adar. */
export function monthForYear(m, hy, prevYear) {
  if (hy) {
    if (m === ADAR) return HDate.isLeapYear(hy) ? 13 : 12;
    return monthsOfYear(hy).includes(m) ? m : 12;
  }
  return m === 12 && prevYear && !HDate.isLeapYear(prevYear) ? ADAR : m;
}

export const dayName = (d, lang) => (lang === 'he' ? gematriya(d) : String(d));

export function monthName(m, y, lang) {
  if (m === ADAR) return monthName(12, PLAIN_REF, lang);
  if (lang !== 'he') return HDate.getMonthName(m, y);
  return new HDate(1, m, y).renderGematriya(true).replace(NIKUD, '').split(' ').slice(1, -1).join(' ');
}

/** e.g. י״א אב תשנ״ד / 11 Av 5754; without the year when it isn't known. Null with no birthday. */
export function formatDate(p, lang) {
  if (!p?.h_day || !p.h_month) return null;
  const y = p.h_year ?? LEAP_REF;
  const d = Math.min(p.h_day, (p.h_month === ADAR ? 29 : HDate.daysInMonth(p.h_month, y)));
  const parts = [dayName(d, lang), monthName(p.h_month, y, lang)];
  if (p.h_year) parts.push(lang === 'he' ? gematriya(p.h_year % 1000) : String(p.h_year));
  return parts.join(' ');
}

/** The Hebrew date of a civil date (YYYY-MM-DD); after sunset counts as the next day. */
export function fromCivil(key, afterSunset) {
  const [y, m, d] = key.split('-').map(Number);
  let h = new HDate(new Date(y, m - 1, d));
  if (afterSunset) h = h.next();
  return { h_day: h.getDate(), h_month: h.getMonth(), h_year: h.getFullYear() };
}

// ---- upcoming birthdays, anniversaries and yahrzeits (same rules as the calendar) ----

/** The Hebrew year's occurrence of a date: hebcal's birthday/anniversary or yahrzeit rules when the
 *  year is known; otherwise the same Hebrew date (13 = Adar / Adar II, a missing 30th → 29th). */
function occurrence(e, hy) {
  if (!e.h_year) {
    const m = e.h_month === ADAR || e.h_month === 13 ? (HDate.isLeapYear(hy) ? months.ADAR_II : months.ADAR_I) : e.h_month;
    return new HDate(Math.min(e.h_day, HDate.daysInMonth(m, hy)), m, hy);
  }
  const orig = new HDate(e.h_day, e.h_month, e.h_year);
  return (e.kind === 'yahrzeit' ? HebrewCalendar.getYahrzeit(hy, orig) : HebrewCalendar.getBirthdayOrAnniversary(hy, orig)) ?? null;
}

/** Every entry's date in the Hebrew year `hy` (for a year's calendar), as { entry, hd, years }:
 *  same rules as `upcoming` — Adar per the year (plain Adar and a regular year's Adar fall in Adar II
 *  of a leap year), a missing 30th, hebcal's yahrzeit rules. Entries from `hy` or later are left out. */
export function inYear(entries, hy) {
  const out = [];
  for (const e of entries) {
    if (!e.h_day || !e.h_month || (e.h_year && e.h_year >= hy)) continue;
    const hd = occurrence(e, hy);
    if (hd) out.push({ entry: e, hd, years: e.h_year ? hy - e.h_year : null });
  }
  return out;
}

/** Entries ({kind, h_day, h_month, h_year, …}) falling in the next `days` days, soonest first, as
 *  { entry, date, hd, days (0 = today), years (null when the year isn't known) }. */
export function upcoming(entries, days) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y0 = new HDate(today).getFullYear();
  const out = [];
  for (const e of entries) {
    if (!e.h_day || !e.h_month) continue;
    for (const hy of [y0, y0 + 1]) {
      if (e.h_year && hy <= e.h_year) continue;
      const hd = occurrence(e, hy);
      if (!hd) continue;
      const date = hd.greg();
      const n = Math.round((date - today) / 864e5);
      if (n >= 0 && n <= days) out.push({ entry: e, date, hd, days: n, years: e.h_year ? hy - e.h_year : null });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}
