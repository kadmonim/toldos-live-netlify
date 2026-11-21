-- An "About" text for an earlier-roots person: a short biography (from Geni's "About", or written by the family),
-- shown in its own section of the roots page and editable there. The note stays for short facts.
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS about text;
