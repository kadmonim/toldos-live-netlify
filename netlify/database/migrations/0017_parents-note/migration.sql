-- A link to the parents that is not certain (the extended family): when someone is placed under the most likely
-- parents, this holds the notes on it — the other options, the sources, the discussion. A person who has it shows
-- a ★ by their parents, with the notes under them; fixing the link later is a row change, and the notes stay.
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS parents_note text;
