-- Earlier roots, now edited in the app: the database is the master copy (the imported file is only
-- the original).
-- Spellings that go together for search, for everyone (not per person): family names
-- (פלדמן / פעלדמן / Feldman) and first-name forms (באשא / באשע). Any name in a group finds the others.
CREATE TABLE IF NOT EXISTS roots_spellings (
  id         serial PRIMARY KEY,
  kind       text NOT NULL,                 -- 'family' or 'given'
  names      text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Every change to a roots person, with what it replaced, so it can be undone.
CREATE TABLE IF NOT EXISTS roots_edits (
  id        bigserial PRIMARY KEY,
  family    text NOT NULL,                  -- the site it was made on
  person    text NOT NULL,                  -- roots_people.id
  field     text NOT NULL,                  -- 'names', 'yahrzeit', or a fix made by hand ('link', ...)
  old       jsonb,
  new       jsonb,
  by_person uuid,                           -- people.id of who made it (the x-editor header), null for a fix by hand
  at        timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz
);
CREATE INDEX IF NOT EXISTS roots_edits_person ON roots_edits (person);
