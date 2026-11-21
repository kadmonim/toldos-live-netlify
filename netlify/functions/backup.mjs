// Nightly backup of the whole database into the "backups" Netlify Blobs store, i.e. outside the
// database: one JSON file per day, db-YYYY-MM-DD.json, with every row of every table (TABLES below). The last 30
// are kept. Never served to the site; /api/backups only lists them.
import { getStore } from '@netlify/blobs';
import { sql } from '../lib/db.mjs';

const KEEP = 30;

// Every table, the extended family's and the rest included (until 2026-11-19 only the first four were saved).
// A new table goes here.
const TABLES = {
  people: () => sql`SELECT * FROM people ORDER BY created_at, id`,
  couples: () => sql`SELECT * FROM couples ORDER BY id`,
  edits: () => sql`SELECT * FROM edits ORDER BY id`,
  photos: () => sql`SELECT * FROM photos ORDER BY created_at, id`,
  roots_people: () => sql`SELECT * FROM roots_people ORDER BY id`,
  roots_couples: () => sql`SELECT * FROM roots_couples ORDER BY id`,
  roots_members: () => sql`SELECT * FROM roots_members ORDER BY family, person`,
  roots_edits: () => sql`SELECT * FROM roots_edits ORDER BY id`,
  roots_photos: () => sql`SELECT * FROM roots_photos ORDER BY id`,
  roots_spellings: () => sql`SELECT * FROM roots_spellings ORDER BY id`,
  quiz_progress: () => sql`SELECT * FROM quiz_progress`,
  profile_items: () => sql`SELECT * FROM profile_items ORDER BY id`,
};

export async function backup() {
  const names = Object.keys(TABLES);
  const rows = await Promise.all(names.map((n) => TABLES[n]()));
  const data = Object.fromEntries(names.map((n, i) => [n, rows[i]]));
  const at = new Date().toISOString();
  const counts = Object.fromEntries(names.map((n) => [n, data[n].length]));
  const store = getStore('backups');
  const key = `db-${at.slice(0, 10)}.json`;
  await store.set(key, JSON.stringify({ at, counts, ...data }), { metadata: { at, ...counts } });
  const { blobs } = await store.list({ prefix: 'db-' });
  for (const old of blobs.map((b) => b.key).sort().slice(0, -KEEP)) await store.delete(old);
  return { key, counts };
}

export default async () => {
  const r = await backup();
  console.log('backup saved', r.key, JSON.stringify(r.counts));
};

export const config = { schedule: '@daily' };
