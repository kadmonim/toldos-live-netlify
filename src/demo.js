// The demo's family comes alive on the day it's opened: "Mazal tov" and "What's new" are about
// recent days, so their dates are set here, counted back (or forward) from today, the first time a
// visitor opens the demo (and again after "Start over"). Everything here is invented.
import { HDate } from './hebrew.js';

const DAY = 864e5;

/** A Hebrew date `days` from today (negative: in the past). */
function hebrew(days) {
  const hd = new HDate(new Date(Date.now() + days * DAY));
  return { d: hd.getDate(), m: hd.getMonth(), y: hd.getFullYear() };
}

/** Adds the demo's recent events to the family as loaded from data/family.json. */
export function liven(data) {
  const p = (first, last) => data.people.find((x) => x.en_first === first && x.en_last === last);
  const coupleOf = (x) => data.couples.find((c) => c.a === x.id || c.b === x.id);
  const setBirth = (x, { d, m, y }) => Object.assign(x, { h_day: d, h_month: m, h_year: y });

  // Mazal tov: a baby girl born five days ago, a couple married four days ago, a wedding coming up.
  setBirth(p('Tzipora', 'Katz'), hebrew(-5));
  const wed = hebrew(-4), next = hebrew(19);
  Object.assign(coupleOf(p('Levi', 'Rosenfeld')), { w_day: wed.d, w_month: wed.m, w_year: wed.y });
  Object.assign(coupleOf(p('Dina', 'Rosenfeld')), { w_day: next.d, w_month: next.m, w_year: next.y, engaged: true });
  // Coming up: a bar mitzvah in nine days.
  const bm = hebrew(9);
  setBirth(p('Mendel', 'Katz'), { ...bm, y: bm.y - 13 });

  // What's new: who filled in what, and when (hours or days ago). [by, about, field, hours ago]
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const recent = [
    ['Chaya', 'Rosenfeld', 'Chaim', 'Rosenfeld', 'photo', 0.4],
    ['Malka', 'Weiss', 'Malka', 'Weiss', 'hobby', 2],
    ['Dina', 'Rosenfeld', 'Yisroel', 'Mandel', 'added', 5],
    ['Esther', 'Rosenfeld', 'Binyamin', 'Rosenfeld', 'birthday', 9],
    ['Rivky', 'Rosenfeld', 'Rivky', 'Rosenfeld', 'photo', 26],
    ['Levi', 'Rosenfeld', 'Rivky', 'Rosenfeld', 'added', 30],
    ['Sheindy', 'Katz', 'Tzipora', 'Katz', 'photo', 50],
    ['Naftali', 'Weiss', 'Naftali', 'Weiss', 'city', 70],
    ['Moshe', 'Katz', 'Tzipora', 'Katz', 'added', 100],
    ['Yitzchak', 'Rosenfeld', 'Sarah', 'Rosenfeld', 'phone', 140],
    ['Devorah', 'Katz', 'Devorah', 'Katz', 'birthday', 160],
  ].map(([bf, bl, pf, pl, field, h]) => ({ by: p(bf, bl).id, person: p(pf, pl).id, field, at: ago(h) }));
  data.recent = recent;
  p('Malka', 'Weiss').hobby = 'Baking challah';
  // The leaderboard: how much each of them has filled in.
  const counts = { Chaya: 14, Esther: 11, Moshe: 9, Dina: 7, Sheindy: 6, Yitzchak: 5, Levi: 4, Malka: 3, Naftali: 2 };
  data.edits = Object.entries(counts).map(([first, n]) => {
    const x = data.people.find((y) => y.en_first === first && !y.deceased);
    return { by: x.id, field: 'photo', n };
  });
  return data;
}
