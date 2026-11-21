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
  city: ['city'], address: ['address'], phone: ['phone'], email: ['email'], hobby: ['hobby'], burial: ['burial'], grade: ['grade_offset'], tehillim: ['tehillim'], parents: ['parents'],
};

// A reply that isn't JSON (a host's error page, a captive-portal page, a timeout, often with
// status 200) or no reply at all is almost always a weak connection: say that, in words, rather
// than "Unexpected token '<'" or an HTTP code.
// The code that came back goes at the end, in brackets (no reply at all: 0), so a screenshot says what happened:
// a filter's or a network's own page (403, 451, 5xx), or nothing reaching the site.
const badReply = (res) => Object.assign(new Error(`${t('badReply')} [${res?.status ?? 0}]`), { badReply: true, status: res?.status ?? 0 });

// An older browser (an iPhone before iOS 15.4, an old Android) has no crypto.randomUUID, which adding a person
// needs for the new person's id: made here from the random numbers such a browser does have.
if (globalThis.crypto && !crypto.randomUUID && crypto.getRandomValues) {
  crypto.randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}

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

/** The tree's data with what the app adds (photo addresses…). */
function prepare(data) {
  data.people.forEach((p) => { p.photo = photoUrl(p); });
  data.couples.forEach(withFamily);
  (data.photos ??= []).forEach(withGallery);
  return data;
}
// The last tree and earlier roots, kept in this browser (IndexedDB: too big for localStorage), so a visit
// draws at once and the fresh ones replace them when they come. Forgotten on signing out.
function cacheDb() {
  return new Promise((ok, bad) => {
    const rq = indexedDB.open('tree-cache', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => ok(rq.result); rq.onerror = () => bad(rq.error);
  });
}
async function cacheGet(what) {
  try {
    const db = await cacheDb();
    return await new Promise((ok) => { const g = db.transaction('kv').objectStore('kv').get(`${what}:${location.host}`); g.onsuccess = () => ok(g.result ?? null); g.onerror = () => ok(null); });
  } catch { return null; }
}
async function cachePut(what, text) {
  try {
    const st = (await cacheDb()).transaction('kv', 'readwrite').objectStore('kv');
    if (text == null) st.delete(`${what}:${location.host}`); else st.put(text, `${what}:${location.host}`);
  } catch { /* private mode, blocked */ }
}

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
    const text = await res.text();
    this.treeText = text;
    cachePut('tree', text);
    return prepare(JSON.parse(text));
  },
  /** The tree as it came last time (kept in this browser), to draw at once while the fresh one comes; null if none. */
  async cached() {
    const text = await cacheGet('tree');
    if (!text) return null;
    try { this.treeText = text; return prepare(JSON.parse(text)); } catch { return null; }
  },
  /** Forgets what's kept in this browser (signing out, or the session is over). */
  clearCache() { cachePut('tree', null); cachePut('roots', null); },

  /** The site's earlier roots (wider family), read-only; empty lists where there are none. */
  async roots() {
    if (this.mode === 'local') return { people: [], couples: [], spellings: [], photos: [] };
    const res = await fetch('/api/roots').catch(() => null);
    if (!res?.ok || !(res.headers.get('content-type') ?? '').includes('json')) return { people: [], couples: [], spellings: [], photos: [] };
    const text = await res.text();
    this.rootsText = text;   // set only when they really came (not for the empty lists above)
    cachePut('roots', text);
    return JSON.parse(text);
  },
  /** The roots as they came last time: { text, data }, or null. */
  async rootsCached() {
    const text = await cacheGet('roots');
    if (!text) return null;
    try { return { text, data: JSON.parse(text) }; } catch { return null; }
  },

  /** A roots person's photo (already cropped and shrunk); returns its photo_v. */
  async uploadRootsPhoto(id, blob) {
    const { photo_v } = await send('PUT', `/api/roots/${encodeURIComponent(id)}/photo`, blob, blob.type);
    return photo_v;
  },
  /** Adds a picture to a roots person's "more photos" (already shrunk); returns { id, person, caption }. */
  async addRootsGalleryPhoto(personId, blob, caption = '', kind = null) {
    const q = new URLSearchParams({ ...(caption && { caption }), ...(kind && { kind }) }).toString();
    return send('POST', `/api/roots/${encodeURIComponent(personId)}/gallery${q ? `?${q}` : ''}`, blob, blob.type);
  },
  async deleteRootsGalleryPhoto(id) { return send('DELETE', `/api/roots-gallery/${id}`); },
  /** Takes a profile picture off (the file is kept aside on the server, not deleted): a tree person's, or an extended-family one's. */
  async removeProfilePhoto(id) { return send('DELETE', `/api/photos/${id}`); },
  async removeRootsPhoto(id) { return send('DELETE', `/api/roots/${encodeURIComponent(id)}/photo`); },
  rootsGalleryUrl: (g, original = false) => `/api/roots-gallery/${g.id}${original ? '?size=original' : ''}`,
  // someone from a sister family's tree (id "tree-<their id>"): their picture is their tree profile's
  rootsPhotoUrl: (p) => (!p?.photo_v ? (p?.tree_photo_v ? `/api/photos/${p.kin_tree}?v=${p.tree_photo_v}` : null) : p.id.startsWith('tree-') ? `/api/photos/${p.id.slice(5)}?v=${p.photo_v}` : `/api/roots/${encodeURIComponent(p.id)}/photo?v=${p.photo_v}`),

  /** Edits a roots person: { field: 'names', he_first, ... } or { field: 'yahrzeit', h_day, h_month, h_year }. */
  async saveRoots(id, body) {
    return sendTwice('PUT', `/api/roots/${encodeURIComponent(id)}`, body);
  },

  // What is kept on a profile beyond the pictures: documents, Vimeo videos and links (netlify/functions/items.mjs).
  // `person` is a tree person's id or an extended-family one.
  async items(person) {
    const res = await fetch(`/api/items/${encodeURIComponent(person)}`, { headers: { 'x-editor': myId() ?? '' } });
    return res.ok ? res.json() : [];
  },
  async addItem(person, body) { return send('POST', `/api/items/${encodeURIComponent(person)}`, body); },
  async saveItem(id, body) { return send('PUT', `/api/item/${id}`, body); },
  async deleteItem(id) { return send('DELETE', `/api/item/${id}`); },
  /** Sends a file straight to the storage (it doesn't pass through the site, so its size is no trouble);
   *  `progress` gets how far it is, 0 to 1. Returns what addItem needs to list it. */
  async uploadFile(person, file, progress) {
    const { url, key } = await send('POST', `/api/items/${encodeURIComponent(person)}/upload`, { name: file.name, type: file.type, size: file.size });
    await new Promise((done, fail) => {
      const x = new XMLHttpRequest();
      x.open('PUT', url);
      x.setRequestHeader('content-type', file.type || 'application/octet-stream');
      x.upload.onprogress = (e) => { if (e.lengthComputable) progress?.(e.loaded / e.total); };
      x.onload = () => (x.status >= 200 && x.status < 300 ? done() : fail(new Error(`${x.status}`)));
      x.onerror = () => fail(new Error('network'));
      x.send(file);
    });
    return { key, name: file.name, type: file.type || null, size: file.size };
  },
  itemFileUrl: (it, download = false) => `/api/item/${it.id}/file${download ? '?download=1' : ''}`,
  /** An item's small preview picture (the last part of its key keeps the browser's copy apart from an older one). */
  itemThumbUrl: (it) => `/api/item/${it.id}/thumb?v=${encodeURIComponent(String(it.thumb_key).slice(-8))}`,
  /** A link: the server looks for the page's preview picture now, and answers with the item. */
  async findItemThumb(id) { return send('POST', `/api/item/${id}/thumb`, {}); },
  async noItemThumb(id) { return send('POST', `/api/item/${id}/thumb`, { none: true }); },
  /** A file: sends the preview picture the browser drew (a small JPEG) to the storage, and answers with the item. */
  async sendItemThumb(id, blob) {
    const { url, key } = await send('POST', `/api/item/${id}/thumb`, { size: blob.size });
    const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: blob });
    if (!res.ok) throw new Error(`${res.status}`);
    return send('PUT', `/api/item/${id}`, { thumb_key: key });
  },

  /** Your own game progress (functions/progress.mjs): rows { game, item, right_n, wrong_n, streak, last_ok, last_at }. */
  async progress() {
    const res = await fetch('/api/progress', { headers: { 'x-editor': myId() ?? '' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).rows;
  },
  /** One answer in a game, added to your progress. */
  async saveAnswer(game, item, ok) { return send('POST', '/api/progress', { game, item, ok }); },
  /** What this browser remembered before progress was kept in the database ({ item: 'right' | 'wrong' }). */
  async importProgress(game, items) { return send('POST', '/api/progress', { game, import: items }); },

  /** A signed calendar-feed link for a couple's family (functions/calendar.mjs), made by person `p`
   *  (or nobody), in language `l`. The local preview has no server to sign it: a sample address. */
  async calendarLink(c, p, l) {
    if (this.mode === 'local') return `${location.origin}/api/calendar.ics?c=${c}&p=${p ?? ''}&l=${l}&k=local-preview`;
    return (await send('POST', '/api/calendar-link', { c, p, l })).url;
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
  async addGalleryPhoto(personId, blob, dataUrl, kind = null) {
    if (this.mode === 'local') {
      const d = local.read();
      const g = { id: crypto.randomUUID(), person: personId, at: new Date().toISOString(), url: dataUrl, kind };
      (d.photos ??= []).push(g);
      local.log(d, 'gallery', personId);
      local.write(d);
      return g;
    }
    return withGallery(await send('POST', `/api/people/${personId}/gallery${kind ? `?kind=${kind}` : ''}`, blob, blob.type));
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
    this.clearCache();
    localStorage.removeItem(ME);
    if (DEMO) localStorage.removeItem(DEMO_IN);
    sessionStorage.clear();
    if (this.mode === 'server') await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  },

  /** Keeps the full-quality photo (for printing) next to the small one; not in local preview.
   *  `kind`: 'person' (id = person), 'family' (id = couple) or 'gallery' (id = the picture). */
  async uploadOriginal(kind, id, blob) {
    if (this.mode === 'local') return;
    if (kind === 'roots') return send('PUT', `/api/roots/${encodeURIComponent(id)}/photo?size=original`, blob, blob.type);
    if (kind === 'roots-gallery') return send('PUT', `/api/roots-gallery/${id}?size=original`, blob, blob.type);
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
