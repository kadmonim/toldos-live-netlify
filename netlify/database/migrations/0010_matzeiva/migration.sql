-- A headstone (מצבה) photo for someone who passed away: kept with their other pictures (photos for the tree,
-- roots_photos for the earlier roots) but marked kind = 'matzeiva', shown in its own row and left out of
-- "more photos" and the quiz. One per person (a new one replaces the old).
ALTER TABLE photos ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE roots_photos ADD COLUMN IF NOT EXISTS kind text;
