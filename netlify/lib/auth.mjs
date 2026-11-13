// A password per family (APP_PASSWORD_<KEY>, else the shared APP_PASSWORD; see families.mjs). A
// successful login sets an HttpOnly cookie holding an HMAC of the expiry time and the family,
// signed with SESSION_SECRET, so no session table is needed and a login for one family's site
// isn't valid on another's.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { familyOf } from './families.mjs';

const COOKIE = 'tree_session';
const DAYS = 90;

const sign = (payload) =>
  createHmac('sha256', process.env.SESSION_SECRET ?? '').update(payload).digest('base64url');

const safeEqual = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const payload = (family, expires) => `${family.key}:${expires}`;

export function checkPassword(req, password) {
  const expected = process.env[`APP_PASSWORD_${familyOf(req).key.toUpperCase()}`] || process.env.APP_PASSWORD;
  if (!expected || !process.env.SESSION_SECRET) throw new Error('APP_PASSWORD and SESSION_SECRET must be set');
  return typeof password === 'string' && safeEqual(password, expected);
}

export function sessionCookie(req) {
  const expires = Date.now() + DAYS * 864e5;
  const value = `${expires}.${sign(payload(familyOf(req), expires))}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`;
}

/** Expires the session cookie (logging out). */
export function logoutCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function isLoggedIn(req) {
  const raw = (req.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw || !process.env.SESSION_SECRET) return false;
  const [expires, sig] = raw.slice(COOKIE.length + 1).split('.');
  return Boolean(sig) && safeEqual(sig, sign(payload(familyOf(req), expires))) && Number(expires) > Date.now();
}
