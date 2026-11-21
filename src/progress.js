// What you've learned in the games, and which question comes next (spaced repetition).
// Each question keeps its history: right and wrong counts, the current run of right answers, and
// when it was last answered. Kept in the database for whoever is signed in (functions/progress.mjs,
// private: only your own), with this device's copy alongside for the moment between loads and for
// the local preview or someone not signed in.
//
// When a question comes back:
//   never asked, or wrong last time        now (a wrong one waits a few questions, not the very next)
//   right 1 / 2 / 3 / 4 / 5+ times in a row  after 1 day / 3 days / a week / a month / 3 months
// "Known" is right 3 times in a row. Nothing is ever dropped for good.
import { api } from './api.js';

const DAY = 864e5;
const GAPS = [0, 1, 3, 7, 30, 90].map((d) => d * DAY);
export const KNOWN = 3;

let rows = new Map();   // `${game}|${item}` → { right_n, wrong_n, streak, last_ok, last_at (ms) }
let owner;              // whose rows these are (a person id, or null when nobody is signed in)
const key = (game, item) => `${game}|${item}`;
const localKey = (id) => `tree.progress.${id ?? 'anon'}`;
const saveLocal = () => { try { localStorage.setItem(localKey(owner), JSON.stringify([...rows])); } catch { /* full or blocked */ } };
const readLocal = (id) => { try { return new Map(JSON.parse(localStorage.getItem(localKey(id))) ?? []); } catch { return new Map(); } };

// Before 2026-11-15 the games kept only "right" or "wrong" per question, in this browser.
const OLD = { who: 'tree.quiz.known', bday: 'tree.bday.known', inlaw: 'tree.inlaw.known' };

/** Gets the signed-in person's progress ready: this device's copy at once, then the database's.
 *  The first time, what this browser remembered from before is copied in (never over the database's
 *  own). Safe to call again; it only reloads when someone else has signed in. True once the
 *  database's copy has come in (a game on screen then picks its question again). */
export async function loadProgress(force = false) {
  const id = api.me ?? null;
  if (owner === id && !force) return false;
  owner = id;
  rows = readLocal(id);
  const old = {};
  for (const [game, prefix] of Object.entries(OLD)) {
    try { const m = JSON.parse(localStorage.getItem(`${prefix}.${id ?? 'anon'}`)); if (m && Object.keys(m).length) old[game] = m; } catch { /* nothing */ }
  }
  const flag = `tree.progress.imported.${id ?? 'anon'}`;
  const fresh = !localStorage.getItem(flag) && Object.keys(old).length;
  if (api.mode !== 'server' || !id) {
    // Nowhere else to keep it: this device only.
    if (fresh) {
      for (const [game, m] of Object.entries(old)) for (const [item, v] of Object.entries(m)) {
        if (!rows.has(key(game, item))) rows.set(key(game, item), start(v === 'right'));
      }
      saveLocal();
      localStorage.setItem(flag, '1');
    }
    return false;
  }
  try {
    if (fresh) {
      for (const [game, m] of Object.entries(old)) await api.importProgress(game, m);
      localStorage.setItem(flag, '1');
    }
    const got = await api.progress();
    if (owner !== id) return false;
    rows = new Map(got.map((r) => [key(r.game, r.item), { right_n: r.right_n, wrong_n: r.wrong_n, streak: r.streak, last_ok: r.last_ok, last_at: Date.parse(r.last_at) }]));
    saveLocal();
    return true;
  } catch { return false; /* offline or a hiccup: this device's copy stands in */ }
}

const start = (ok) => ({ right_n: ok ? 1 : 0, wrong_n: ok ? 0 : 1, streak: ok ? 1 : 0, last_ok: ok, last_at: Date.now() });

/** Notes an answer: here at once, and in the database (a failed save is caught up by the next load). */
export function record(game, item, ok) {
  const r = rows.get(key(game, item));
  rows.set(key(game, item), r
    ? { right_n: r.right_n + (ok ? 1 : 0), wrong_n: r.wrong_n + (ok ? 0 : 1), streak: ok ? r.streak + 1 : 0, last_ok: ok, last_at: Date.now() }
    : start(ok));
  saveLocal();
  if (api.mode === 'server' && owner) api.saveAnswer(game, item, ok).catch(() => {});
}

export const history = (game, item) => rows.get(key(game, item)) ?? null;
export const isKnown = (game, item) => (history(game, item)?.streak ?? 0) >= KNOWN;
const dueAt = (h) => h.last_at + GAPS[Math.min(h.streak, GAPS.length - 1)];

/**
 * The next question for `game` out of `pool` (objects with a `key`), or why there is none.
 * `recent` is a list of the last keys asked (kept by the caller, trimmed here): those wait a few
 * questions. With `practice`, questions that aren't due yet come too, the shakiest first.
 * Returns { pick } or { none: 'empty' | 'caughtUp' | 'allKnown' }.
 */
export function pickNext(game, pool, recent, practice = false) {
  if (!pool.length) return { none: 'empty' };
  const now = Date.now();
  const wait = new Set(recent.slice(-Math.min(3, pool.length - 1)));
  const h = (x) => history(game, x.key);
  const due = pool.filter((x) => { const r = h(x); return !r || r.streak === 0 || dueAt(r) <= now; });
  let from;
  if (due.length) {
    const open = due.filter((x) => !wait.has(x.key));
    const list = open.length ? open : due;
    // The ones you're learning come first: missed last time, then sometimes right and sometimes
    // wrong, then new ones, then ones you know that are due to be checked.
    const missed = list.filter((x) => h(x) && !h(x).last_ok);
    const shaky = list.filter((x) => h(x) && h(x).last_ok && h(x).wrong_n > 0 && h(x).streak < KNOWN);
    const fresh = list.filter((x) => !h(x));
    const check = list.filter((x) => h(x) && !missed.includes(x) && !shaky.includes(x));
    // Each group's chance, shared out among the groups that have any.
    const groups = [[missed, 0.4], [shaky, 0.3], [fresh, 0.25], [check, 0.05]].filter(([l]) => l.length);
    let r = Math.random() * groups.reduce((s, [, p]) => s + p, 0);
    from = groups.find(([, p]) => (r -= p) < 0)?.[0] ?? groups[0][0];
  } else if (practice) {
    // Nothing due: the shakiest few (shortest run, then the most often wrong).
    const open = pool.filter((x) => !wait.has(x.key));
    const weak = (x) => { const r = h(x); return r ? r.streak * 10 - r.wrong_n / Math.max(1, r.right_n + r.wrong_n) : 0; };
    from = (open.length ? open : pool).slice().sort((a, b) => weak(a) - weak(b)).slice(0, 5);
  } else {
    return { none: pool.every((x) => isKnown(game, x.key)) ? 'allKnown' : 'caughtUp' };
  }
  const pick = from[Math.floor(Math.random() * from.length)];
  recent.push(pick.key);
  if (recent.length > 10) recent.splice(0, recent.length - 10);
  return { pick };
}
