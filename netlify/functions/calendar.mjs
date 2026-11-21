// The calendar feed (lib/calendar.mjs). Two addresses:
//   POST /api/calendar-link { c, p, l }  (logged in) → { url }: a link for a couple's family, made by
//        person p (or nobody), in language l. The link carries a signature (HMAC with SESSION_SECRET,
//        never the family password), so a calendar app can read it without logging in, and changing
//        the password doesn't break it. Changing SESSION_SECRET cancels every link (and every login).
//   GET  /api/calendar.ics?c=&p=&l=&k=  → the calendar file, for whoever has a signed link.
// What a link shows: names, the occasion, the date, and a link back to the profile; no phone
// numbers, addresses or emails.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '../lib/db.mjs';
import { isLoggedIn } from '../lib/auth.mjs';
import { familyOf } from '../lib/families.mjs';
import { familyScope, rootOf } from '../lib/family.mjs';
import { feedFile, pairName } from '../lib/calendar.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGS = ['he', 'en'];
const sign = (family, c, p, l) =>
  createHmac('sha256', process.env.SESSION_SECRET ?? '').update(`calendar|${family.key}|${c}|${p}|${l}`).digest('base64url').slice(0, 24);
const safeEqual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** The site's people (not archived) and couples, and the site's own family. */
async function load(req) {
  const [people, couples] = await Promise.all([
    sql`SELECT id, he_first, en_first, he_last, en_last, sex, deceased, parents, h_day, h_month, h_year, d_day, d_month, d_year
        FROM people WHERE archived_at IS NULL`,
    sql`SELECT id, a, b, is_root AS root, w_day, w_month, w_year, apart, engaged, venue FROM couples`,
  ]);
  // A couple with an archived spouse is the other one alone (as on the page).
  const here = new Set(people.map((p) => p.id));
  const live = couples.flatMap((c) => {
    const a = here.has(c.a) ? c.a : null, b = c.b && here.has(c.b) ? c.b : null;
    return a || b ? [{ ...c, a: a ?? b, b: a ? b : null }] : [];
  });
  const root = rootOf(req, live);
  const site = familyScope(people, live, root);
  return { people: people.filter((p) => site.members.has(p.id)), couples: live.filter((c) => site.couples.has(c.id)), root };
}

export default async (req) => {
  const url = new URL(req.url);
  const family = familyOf(req);
  if (!process.env.SESSION_SECRET) return new Response('Not configured', { status: 500 });

  if (url.pathname === '/api/calendar-link') {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (!isLoggedIn(req)) return Response.json({ error: 'login' }, { status: 401 });
    const { c, p, l } = await req.json().catch(() => ({}));
    if (!UUID.test(c ?? '') || (p && !UUID.test(p)) || !LANGS.includes(l)) return Response.json({ error: 'bad request' }, { status: 400 });
    const { couples } = await load(req);
    if (!couples.some((x) => x.id === c)) return Response.json({ error: 'not found' }, { status: 404 });
    const q = new URLSearchParams({ c, p: p ?? '', l, k: sign(family, c, p ?? '', l) });
    return Response.json({ url: `https://${url.host}/api/calendar.ics?${q}` });
  }

  // The feed itself.
  const c = url.searchParams.get('c') ?? '', p = url.searchParams.get('p') ?? '', l = url.searchParams.get('l') ?? '';
  const k = url.searchParams.get('k') ?? '';
  if (!UUID.test(c) || (p && !UUID.test(p)) || !LANGS.includes(l) || !safeEqual(k, sign(family, c, p, l))) {
    return new Response('Not found', { status: 404 });
  }
  const { people, couples, root } = await load(req);
  const top = couples.find((x) => x.id === c);
  if (!top) return new Response('Not found', { status: 404 });
  const byId = new Map(people.map((x) => [x.id, x]));
  const familyName = l === 'he' ? family.he : family.en;
  const calName = c === root ? familyName : `${familyName} · ${pairName(top, byId, l)}`;
  const body = feedFile({ people, couples, coupleId: c, personId: p || null, lang: l, site: url.host, calName });
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="family.ics"',
      'cache-control': 'public, max-age=3600',
    },
  });
};

export const config = { path: ['/api/calendar.ics', '/api/calendar-link'] };
