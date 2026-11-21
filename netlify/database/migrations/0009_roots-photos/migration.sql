-- More photos of an earlier-roots person (beyond their profile picture), like the tree's `photos`: kept in
-- Netlify Blobs "photos" as "roots-gallery-<id>" (shrunk) and "orig-roots-gallery-<id>" (full quality).
CREATE TABLE IF NOT EXISTS roots_photos (
  id         bigserial PRIMARY KEY,
  person     text NOT NULL,              -- roots_people.id
  caption    text,
  by_person  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roots_photos_person ON roots_photos (person);
