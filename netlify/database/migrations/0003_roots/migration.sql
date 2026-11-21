-- Earlier roots: the wider family around a site's top couple (cousins, ancestors, their families), from
-- Geni or a GEDCOM file. Kept apart from people/couples so birthdays, the quiz, export, backup,
-- editing and "What's new" never pick them up. Loaded from a file, then edited in the app.
-- One pool of people shared by every site; roots_members says which site shows whom.
CREATE TABLE IF NOT EXISTS roots_people (
  id          text PRIMARY KEY,           -- Geni profile id ("profile-123") or a family-added id ("extra-alter-rebbe")
  he_first    text,
  he_last     text,
  en_first    text,
  en_last     text,
  aliases     text[] NOT NULL DEFAULT '{}',   -- nicknames, maiden names, other spellings, notes like "Alter Rebbe"
  sex         text,                       -- 'M' / 'F'
  born        jsonb,                      -- calendar date as Geni gives it: {y, m, d, approx, place, raw}
  died        jsonb,
  parents     text,                       -- roots_couples.id
  kohen       boolean NOT NULL DEFAULT false,
  hidden      boolean NOT NULL DEFAULT false, -- an unknown generation: counts in relationships, never shown
  main_person uuid,                       -- the same person in the main tree (people.id), when they're there too
  note        text,
  geni        text,                       -- the name exactly as on Geni
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS roots_couples (
  id text PRIMARY KEY,
  a  text,
  b  text
);
CREATE TABLE IF NOT EXISTS roots_members (
  family text NOT NULL,                   -- the site's key in netlify/lib/families.mjs
  person text NOT NULL,
  kind   text NOT NULL DEFAULT 'rule',    -- 'rule' (from the site's rules), 'extra' (added by hand), 'hidden'
  PRIMARY KEY (family, person)
);
CREATE INDEX IF NOT EXISTS roots_members_family ON roots_members (family);
