-- The whole database (Postgres). The tree is built from couples: a person's `parents` is the couple
-- they were born to. Each later change to the tables is a new numbered folder next to this one,
-- numbered above the last one (Netlify applies them in order on every deploy).
CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  he_first text, he_full text, en_first text, he_last text, en_last text,
  maiden text, nickname text, father_name text, mother_name text,
  sex text CHECK (sex IN ('m', 'f')),
  h_day integer, h_month integer, h_year integer, birth_order smallint,
  d_day integer, d_month integer, d_year integer,
  deceased boolean NOT NULL DEFAULT false,
  city text, address text, phone text, home_phone text, email text, hobby text, occupation text, notes text,
  parents uuid,
  photo_v bigint,
  can_export boolean NOT NULL DEFAULT false,
  archived_at timestamptz, archived_by uuid REFERENCES people(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE couples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  a uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  b uuid REFERENCES people(id) ON DELETE SET NULL,
  is_root boolean NOT NULL DEFAULT false,
  w_day integer, w_month integer, w_year integer,
  photo_v bigint,
  apart boolean NOT NULL DEFAULT false,
  engaged boolean NOT NULL DEFAULT false,
  venue text
);
ALTER TABLE people ADD FOREIGN KEY (parents) REFERENCES couples(id) ON DELETE SET NULL;
CREATE TABLE edits (
  id bigserial PRIMARY KEY,
  by_person uuid REFERENCES people(id) ON DELETE SET NULL,
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  field text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  old jsonb, new jsonb, undone_at timestamptz
);
CREATE TABLE photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  by_person uuid REFERENCES people(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photos_person ON photos (person_id, created_at);
CREATE INDEX people_parents ON people (parents);
CREATE INDEX edits_at ON edits (at);
