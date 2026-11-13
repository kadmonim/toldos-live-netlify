import { checkPassword, sessionCookie } from '../lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const { password } = await req.json().catch(() => ({}));
  if (!checkPassword(req, password)) return new Response('Wrong password', { status: 401 });
  return new Response('ok', { headers: { 'set-cookie': sessionCookie(req) } });
};

export const config = { path: '/api/login' };
