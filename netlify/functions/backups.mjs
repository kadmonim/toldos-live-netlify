// Which nightly backups exist: the database files (backup.mjs), with dates and row counts, and the
// photo mirror's progress (photo-backup.mjs), and the copy of the documents (Cloudflare). Never their contents.
import { createHmac } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { isLoggedIn } from '../lib/auth.mjs';

export default async (req) => {
  if (!isLoggedIn(req)) return Response.json({ error: 'login' }, { status: 401 });
  const store = getStore('backups');
  const { blobs } = await store.list({ prefix: 'db-' });
  const list = await Promise.all(blobs.map(async (b) => ({ key: b.key, ...((await store.getMetadata(b.key))?.metadata ?? {}) })));
  // The photo mirror (photo-backup.mjs): when it last ran, and how far it got.
  const p = await getStore('photo-backups').get('state.json', { type: 'json' });
  const photos = p ? { lastRun: p.lastRun, complete: p.complete, mirrored: Object.keys(p.etags).length, deletedKeptForNow: Object.keys(p.deleted).length } : null;
  // The documents on profiles (Cloudflare R2): the copy in the second bucket, as the Worker reports it (cloudflare/files).
  let files = null;
  try {
    const worker = (process.env.FILES_WORKER_URL ?? '').replace(/\/$/, '');
    if (worker && process.env.FILES_SECRET) {
      const exp = Math.floor(Date.now() / 1000) + 60;
      const sig = createHmac('sha256', process.env.FILES_SECRET).update(`GET\n_backup\n${exp}`).digest('hex');
      const r = await fetch(`${worker}/_backup?exp=${exp}&sig=${sig}`);
      if (r.ok) { const s = await r.json(); files = { lastRun: s.lastRun, files: s.files, copied: s.copied, waiting: s.waiting, removedKeptForNow: s.removedKeptForNow }; }
    }
  } catch { /* the Worker didn't answer: nothing to say about it */ }
  return Response.json({ database: list.sort((a, b) => b.key.localeCompare(a.key)), photos, files });
};

export const config = { path: '/api/backups' };
