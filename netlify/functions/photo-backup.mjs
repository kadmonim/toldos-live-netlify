// Hourly photo backup: mirrors the "photos" blob store (profile, family and gallery pictures and
// their full-quality originals) into "photo-backups" — only what's new or changed each run, one
// previous version of a replaced photo, and deleted photos kept for 90 days (lib/photo-mirror.mjs).
import { getStore } from '@netlify/blobs';
import { mirror } from '../lib/photo-mirror.mjs';

export default async () => {
  const r = await mirror(getStore('photos'), getStore('photo-backups'), { budgetMs: 20000 });
  console.log('photo backup', JSON.stringify(r));
};

export const config = { schedule: '30 * * * *' };   // every hour: a run only has 20 seconds, so a big batch of new pictures needs many runs
