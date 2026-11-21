-- The extended family: a title before the name (ר׳, הרב, אדמו״ר, הרבנית / R', Rabbi, Rebbetzin), in Hebrew and in
-- English, and הכהן / הלוי as its own field, shown between the first name and the family name.
-- And what someone is known as (אדמו״ר הזקן / The Alter Rebbe): shown in place of the name, the name itself under it.
-- The old yes/no "kohen" becomes tribe = 'kohen'; the column stays, kept in step, for anything that still reads it.
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS title_he text;
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS title_en text;
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS tribe text CHECK (tribe IN ('levi', 'kohen'));
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS known_he text;
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS known_en text;
UPDATE roots_people SET tribe = 'kohen' WHERE kohen AND tribe IS NULL;
