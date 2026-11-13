// Talks to the server (the Netlify functions under /api). When there is no backend (plain `vite` dev server) it falls back
// to localStorage so the UI can still be tried out; `api.mode` says which one is in use.
//
// The tree comes back as { people, couples, edits }: a person's `parents` is a couple id, a couple
// is { id, a, b, root } (b is null while the spouse isn't in the tree), and `edits` is a count per
// editor and field ({ by, field, n }) for the leaderboard and badges.
// v2: the data's shape changed, so old local copies are left behind.
import { t } from './i18n.js';

// The demo keeps its copy under its own name, with a number: raise the number whenever the demo
// family changes (data/family.json, src/demo.js), so a visitor's older copy is replaced.
const LS = import.meta.env.VITE_DEMO === '1' ? 'tree.demo.v4' : 'tree.data.v2';
if (import.meta.env.VITE_DEMO === '1') { try { localStorage.removeItem('tree.data.v2'); } catch {} }
const ME = 'tree.me';
// Who you are is kept in localStorage and, on the live site, in a long-lived cookie set by the
// server (/api/me): Safari erases localStorage after 7 days without a visit, but not that cookie.
const meCookie = () => document.cookie.match(/(?:^|;\s*)tree_me=([0-9a-f-]{36})/)?.[1] ?? null;
const myId = () => localStorage.getItem(ME) ?? meCookie();

// Local preview starts from data/family.json, the same family the database migration (0002_family) loads into the
// database. The dev server serves it; it is never part of the built site.
/** A demo site (built with VITE_DEMO=1, hosted as plain files with no server): everything runs in
 *  the visitor's browser from the sample family, like the local preview. Nothing is shared or saved
 *  anywhere else, so there is nothing to protect or reset. */
export const DEMO = import.meta.env.VITE_DEMO === '1';
/** The demo still asks for a password, to show what a real family site looks like; it's shown on
 *  the login screen. Checked in the browser only: there is nothing behind it to protect. */
export const DEMO_PASSWORD = 'toldos';
const DEMO_IN = 'tree.demo.in';

async function loadLocal() {
  const saved = localStorage.getItem(LS);
  if (saved) return JSON.parse(saved);
  // The demo build carries the sample family inside it; the dev server serves the file.
  const res = DEMO ? null : await fetch('/data/family.json').catch(() => null);
  const data = DEMO ? (await import('./demo.js')).liven(structuredClone((await import('../data/family.json')).default))
    : res?.ok && (res.headers.get('content-type') ?? '').includes('json')
    ? await res.json() : { people: [], couples: [], edits: [] };
  localStorage.setItem(LS, JSON.stringify(data));
  return data;
}

const local = {
  read: () => JSON.parse(localStorage.getItem(LS)),
  write: (d) => localStorage.setItem(LS, JSON.stringify(d)),
  log(d, field, person) {
    const by = myId();
    (d.recent ??= []).unshift({ by, person, field, at: new Date().toISOString() });
    d.recent.length = Math.min(d.recent.length, 40);
    if (!by) return;
    const row = d.edits.find((e) => e.by === by && e.field === field);
    if (row) row.n++; else d.edits.push({ by, field, n: 1 });
  },
};

const GROUPS = {
  names: ['he_first', 'he_full', 'en_first', 'he_last', 'en_last'],
  birthday: ['h_day', 'h_month', 'h_year'],
  city: ['city'], address: ['address'], phone: ['phone'], email: ['email'], hobby: ['hobby'], parents: ['parents'],
};

// A reply that isn't JSON (a host's error page, a captive-portal page, a timeout, often with
// status 200) or no reply at all is almost always a weak connection: say that, in words, rather
// than "Unexpected token '<'" or an HTTP code.
const badReply = (res) => Object.assign(new Error(t('badReply')), { badReply: true, status: res?.status ?? 0 });

async function send(method, path, body, type = 'application/json') {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': type, 'x-editor': myId() ?? '' },
    body: type === 'application/json' ? JSON.stringify(body) : body,
  }).catch(() => { throw badReply(null); });
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  if (res.status === 401) throw Object.assign(new Error(t('sessionOver')), { login: true });
  if (!isJson) throw badReply(res);
  const data = await res.json().catch(() => { throw badReply(res); });
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// Adding is safe to repeat: the client picks the id, and the server returns the existing person
// when it already has it. Saving a person or a couple sends the whole record, so that is safe to
// repeat too. A lost reply gets one quiet retry, a moment later, instead of an alert and a duplicate.
async function sendTwice(method, path, body) {
  try { return await send(method, path, body); } catch (err) {
    if (!err.badReply) throw err;
    await new Promise((r) => setTimeout(r, 2000));
    return send(method, path, body);
  }
}

const photoUrl = (p) => (p.photo_v ? `/api/photos/${p.id}?v=${p.photo_v}` : null);
const familyUrl = (c) => (c.photo_v ? `/api/family-photos/${c.id}?v=${c.photo_v}` : null);
const withFamily = (c) => Object.assign(c, { photo: familyUrl(c) });
// A gallery picture is never replaced, so its id is the whole cache key.
const withGallery = (g) => Object.assign(g, { url: `/api/gallery/${g.id}` });

const ORIGINALS = { person: 'photos', family: 'family-photos', gallery: 'gallery' };

export const api = {
  mode: 'server',

  get me() { return myId(); },
  set me(id) {
    if (id) localStorage.setItem(ME, id); else localStorage.removeItem(ME);
    if (this.mode === 'server') {
      fetch('/api/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});
    }
  },

  async load() {
    let res;
    if (DEMO) {
      if (!localStorage.getItem(DEMO_IN)) throw Object.assign(new Error('login'), { login: true });
      this.mode = 'local';
      const data = await loadLocal();
      data.recent ??= [];
      data.photos ??= [];
      return data;
    }
    try { res = await fetch('/api/tree'); } catch { res = null; }
    if (res?.status === 401) throw Object.assign(new Error('login'), { login: true });
    const isJson = (res?.headers.get('content-type') ?? '').includes('json');
    // No functions here (plain `vite`: the SPA page comes back, or a 404): the local preview. On the
    // live site the same thing means the connection failed, which must not turn into the preview.
    if (!isJson && ['localhost', '127.0.0.1'].includes(location.hostname)) {
      this.mode = 'local';
      const data = await loadLocal();
      data.recent ??= [];
      data.photos ??= [];
      return data;
    }
    if (!isJson) throw badReply(res);
    if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
    const data = await res.json();
    data.people.forEach((p) => { p.photo = photoUrl(p); });
    data.couples.forEach(withFamily);
    (data.photos ??= []).forEach(withGallery);
    return data;
  },

  /** Adds (no id) or updates a person; returns the saved person. For a new person, `newId` lets
   *  the caller choose the id up front, so submitting the same form again can't add them twice. */
  async savePerson(person, newId = null) {
    if (this.mode === 'local') {
      const d = local.read();
      const old = d.people.find((p) => p.id === person.id);
      const saved = { ...person, id: person.id ?? newId ?? crypto.randomUUID() };
      if (!old && d.people.some((p) => p.id === saved.id)) return d.people.find((p) => p.id === saved.id);
      if (old) {
        // Same rule as the server: one edit per changed group of fields.
        const changed = Object.keys(GROUPS).filter((g) => GROUPS[g].some((k) => (person[k] ?? null) !== (old[k] ?? null)));
        Object.assign(old, saved);
        changed.forEach((g) => local.log(d, g, old.id));
      } else {
        d.people.push(saved);
        local.log(d, 'added', saved.id);
      }
      local.write(d);
      return saved;
    }
    const saved = person.id
      ? await sendTwice('PUT', `/api/people/${person.id}`, person)
      : await sendTwice('POST', '/api/people', { ...person, id: newId ?? crypto.randomUUID() });
    saved.photo = photoUrl(saved);
    return saved;
  },

  /** Marries a to b (b may be null for "spouse not in the tree yet"); returns the couple. */
  async addCouple(a, b = null) {
    if (this.mode === 'local') {
      const d = local.read();
      let c = d.couples.find((x) => x.a === a || x.b === a);
      if (c && !c.b && b) c.b = b;
      if (!c) d.couples.push(c = { id: crypto.randomUUID(), a, b, root: false });
      local.write(d);
      return c;
    }
    return withFamily(await sendTwice('POST', '/api/couples', { a, b }));
  },

  /** Archives a person (archived = true) or restores them; returns { id, archived_at }. */
  async archive(id, archived) {
    if (this.mode === 'local') {
      const d = local.read();
      const p = d.people.find((x) => x.id === id);
      p.archived_at = archived ? new Date().toISOString() : null;
      local.write(d);
      return { id, archived_at: p.archived_at };
    }
    return send('POST', `/api/people/${id}/archive`, { archived });
  },

  /** Saves a couple's wedding date (w_day, w_month, w_year), `engaged` and `venue`; returns the couple. */
  async saveCouple(c) {
    if (this.mode === 'local') {
      const d = local.read();
      const old = d.couples.find((x) => x.id === c.id);
      Object.assign(old, { w_day: c.w_day, w_month: c.w_month, w_year: c.w_year, engaged: Boolean(c.engaged), venue: c.venue ?? null });
      local.log(d, 'anniversary', old.a);
      local.write(d);
      return old;
    }
    return withFamily(await sendTwice('PUT', `/api/couples/${c.id}`, c));
  },

  /** Uploads an already-shrunk JPEG; returns the URL to show. */
  async uploadPhoto(id, blob, dataUrl) {
    if (this.mode === 'local') {
      const d = local.read();
      d.people.find((p) => p.id === id).photo = dataUrl;
      local.log(d, 'photo', id);
      local.write(d);
      return dataUrl;
    }
    const { photo_v } = await send('PUT', `/api/photos/${id}`, blob, blob.type);
    return photoUrl({ id, photo_v });
  },

  /** A couple's family photo (already shrunk); returns the URL to show. */
  async uploadFamilyPhoto(id, blob, dataUrl) {
    if (this.mode === 'local') {
      const d = local.read();
      const c = d.couples.find((x) => x.id === id);
      c.photo = dataUrl;
      local.log(d, 'family_photo', c.a);
      local.write(d);
      return dataUrl;
    }
    const { photo_v } = await send('PUT', `/api/family-photos/${id}`, blob, blob.type);
    return familyUrl({ id, photo_v });
  },

  /** Adds a picture to a person's gallery (already shrunk); returns { id, person, at, url }. */
  async addGalleryPhoto(personId, blob, dataUrl) {
    if (this.mode === 'local') {
      const d = local.read();
      const g = { id: crypto.randomUUID(), person: personId, at: new Date().toISOString(), url: dataUrl };
      (d.photos ??= []).push(g);
      local.log(d, 'gallery', personId);
      local.write(d);
      return g;
    }
    return withGallery(await send('POST', `/api/people/${personId}/gallery`, blob, blob.type));
  },

  /** Removes a gallery picture. */
  async deleteGalleryPhoto(id) {
    if (this.mode === 'local') {
      const d = local.read();
      d.photos = (d.photos ?? []).filter((g) => g.id !== id);
      local.write(d);
      return;
    }
    await send('DELETE', `/api/gallery/${id}`);
  },

  /** The demo: back to the sample family as it started, and nobody chosen as "me". */
  resetDemo() {
    localStorage.removeItem(LS);
    localStorage.removeItem(ME);
    localStorage.removeItem(DEMO_IN);
    sessionStorage.clear();
  },

  /** Ends the session and forgets who you are on this device. */
  async logout() {
    localStorage.removeItem(ME);
    if (DEMO) localStorage.removeItem(DEMO_IN);
    sessionStorage.clear();
    if (this.mode === 'server') await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  },

  /** Keeps the full-quality photo (for printing) next to the small one; not in local preview.
   *  `kind`: 'person' (id = person), 'family' (id = couple) or 'gallery' (id = the picture). */
  async uploadOriginal(kind, id, blob) {
    if (this.mode === 'local') return;
    await send('PUT', `/api/${ORIGINALS[kind]}/${id}?size=original`, blob, blob.type);
  },

  /** Where to download the full-quality photo from. */
  originalUrl(kind, id, fallback) {
    return this.mode === 'local' ? fallback : `/api/${ORIGINALS[kind]}/${id}?size=original`;
  },

  async login(password) {
    if (DEMO) {
      const ok = password.trim().toLowerCase() === DEMO_PASSWORD;
      if (ok) localStorage.setItem(DEMO_IN, '1');
      return ok;
    }
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    return res.ok;
  },
};
