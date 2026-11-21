// What a person has learned in the quiz's games (migration 0006), so it follows them to any device
// and builds up over time. Private: only the person's own rows are read or written, by the person
// the page says it is (the `x-editor` header, as for edits). Not secure (anyone logged in can pick
// any name), which is fine for a family game: nothing here is shown to anyone else.
//   GET    /api/progress                         → { rows: [{ game, item, right_n, wrong_n, streak, last_ok, last_at }] }
//   POST   /api/progress { game, item, ok }      → the row after this answer
//   POST   /api/progress { game, import: { item: 'right' | 'wrong' } }
//                                                 → copies what a browser remembered from before;
//                                                   never over a row the database already has
import { sql } from '../lib/db.mjs';
import { isLoggedIn } from '../lib/auth.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GAME = /^[a-z]{1,20}$/;
const ITEM = /^([a-z]{1,6}:){0,2}[0-9a-f-]{36}$/i;   // an id, maybe after 'c:', 'age:', 'sp:', 'age:c:'
const json = (body, status = 200) => Response.json(body, { status });

export default async (req) => {
  if (!isLoggedIn(req)) return json({ error: 'login' }, 401);
  const me = req.headers.get('x-editor') ?? '';
  if (!UUID.test(me)) return json({ error: 'who are you?' }, 400);
  const [known] = await sql`SELECT 1 AS x FROM people WHERE id = ${me}`;
  if (!known) return json({ error: 'not found' }, 404);

  if (req.method === 'GET') {
    const rows = await sql`SELECT game, item, right_n, wrong_n, streak, last_ok, last_at FROM quiz_progress WHERE person_id = ${me}`;
    return json({ rows });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = await req.json().catch(() => ({}));
  if (!GAME.test(body.game ?? '')) return json({ error: 'bad request' }, 400);

  if (body.import && typeof body.import === 'object') {
    const items = Object.entries(body.import).filter(([item, v]) => ITEM.test(item) && (v === 'right' || v === 'wrong')).slice(0, 5000);
    for (const [item, v] of items) {
      const ok = v === 'right';
      await sql`INSERT INTO quiz_progress (person_id, game, item, right_n, wrong_n, streak, last_ok)
                VALUES (${me}, ${body.game}, ${item}, ${ok ? 1 : 0}, ${ok ? 0 : 1}, ${ok ? 1 : 0}, ${ok})
                ON CONFLICT (person_id, game, item) DO NOTHING`;
    }
    return json({ imported: items.length });
  }

  if (!ITEM.test(body.item ?? '') || typeof body.ok !== 'boolean') return json({ error: 'bad request' }, 400);
  const ok = body.ok;
  const [row] = await sql`
    INSERT INTO quiz_progress (person_id, game, item, right_n, wrong_n, streak, last_ok, last_at)
    VALUES (${me}, ${body.game}, ${body.item}, ${ok ? 1 : 0}, ${ok ? 0 : 1}, ${ok ? 1 : 0}, ${ok}, now())
    ON CONFLICT (person_id, game, item) DO UPDATE SET
      right_n = quiz_progress.right_n + ${ok ? 1 : 0},
      wrong_n = quiz_progress.wrong_n + ${ok ? 0 : 1},
      streak  = CASE WHEN ${ok} THEN quiz_progress.streak + 1 ELSE 0 END,
      last_ok = ${ok},
      last_at = now()
    RETURNING game, item, right_n, wrong_n, streak, last_ok, last_at`;
  return json(row);
};

export const config = { path: '/api/progress' };
