// Nightly backup of the whole database into the "backups" Netlify Blobs store, i.e. outside the
// database: one JSON file per day, db-YYYY-MM-DD.json, with every row of every table. The last 30
// are kept. Never served to the site; /api/backups only lists them.
import { getStore } from '@netlify/blobs';
import { sql } from '../lib/db.mjs';

const KEEP = 30;

export async function backup() {
  const [people, couples, edits, photos] = await Promise.all([
    sql`SELECT * FROM people ORDER BY created_at, id`,
    sql`SELECT * FROM couples ORDER BY id`,
    sql`SELECT * FROM edits ORDER BY id`,
    sql`SELECT * FROM photos ORDER BY created_at, id`,
  ]);
  const at = new Date().toISOString();
  const counts = { people: people.length, couples: couples.length, edits: edits.length, photos: photos.length };
  const store = getStore('backups');
  const key = `db-${at.slice(0, 10)}.json`;
  await store.set(key, JSON.stringify({ at, counts, people, couples, edits, photos }), { metadata: { at, ...counts } });
  const { blobs } = await store.list({ prefix: 'db-' });
  for (const old of blobs.map((b) => b.key).sort().slice(0, -KEEP)) await store.delete(old);
  return { key, counts };
}

export default async () => {
  const r = await backup();
  console.log('backup saved', r.key, JSON.stringify(r.counts));
};

export const config = { schedule: '@daily' };
