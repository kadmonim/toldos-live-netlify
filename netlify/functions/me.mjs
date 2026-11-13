// Remembers who you are on this device for a long time. localStorage alone isn't enough: Safari
// clears it after 7 days without a visit, but keeps cookies the server sets.
import { isLoggedIn } from '../lib/auth.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAYS = 400; // the longest browsers allow

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!isLoggedIn(req)) return new Response('Login', { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  // Readable by the page (not HttpOnly): it only names a person in the tree, which every logged-in
  // family member can see anyway.
  const cookie = UUID.test(id ?? '')
    ? `tree_me=${id}; Path=/; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`
    : 'tree_me=; Path=/; Secure; SameSite=Lax; Max-Age=0';
  return new Response('ok', { headers: { 'set-cookie': cookie } });
};

export const config = { path: '/api/me' };
