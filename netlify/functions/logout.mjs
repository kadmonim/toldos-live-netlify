// Logs this device out: ends the session and forgets who you are (the tree_me cookie), so a shared
// phone or computer doesn't stay logged in as you.
import { logoutCookie } from '../lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const headers = new Headers();
  headers.append('set-cookie', logoutCookie());
  headers.append('set-cookie', 'tree_me=; Path=/; Secure; SameSite=Lax; Max-Age=0');
  return new Response('ok', { headers });
};

export const config = { path: '/api/logout' };
