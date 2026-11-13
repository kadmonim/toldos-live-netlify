// Which nightly backups exist: the database files (backup.mjs), with dates and row counts, and the
// photo mirror's progress (photo-backup.mjs). Never their contents.
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
  return Response.json({ database: list.sort((a, b) => b.key.localeCompare(a.key)), photos });
};

export const config = { path: '/api/backups' };
