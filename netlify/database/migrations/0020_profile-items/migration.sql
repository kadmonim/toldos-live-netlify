-- Things kept on someone's profile, beyond their pictures: documents (a PDF, a scan), videos (a Vimeo link, played
-- on the profile) and links. Any number per person, in an order the family sets (position). The person is a tree
-- person (a uuid) or someone in the extended family (their roots id), so one column holds either.
-- A file itself is kept in Cloudflare R2 (file_key), sent there straight from the browser.
CREATE TABLE IF NOT EXISTS profile_items (
  id          bigserial PRIMARY KEY,
  person      text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('link', 'video', 'file')),
  title       text,
  note        text,
  url         text,
  file_key    text,
  file_name   text,
  file_type   text,
  file_size   bigint,
  position    integer NOT NULL DEFAULT 0,
  by_person   uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_items_person ON profile_items (person, position);
