-- The last name before marriage in Hebrew and in English, like the other names: maiden_he (Hebrew), maiden
-- (English). Names already typed in Hebrew letters move to maiden_he.
ALTER TABLE people ADD COLUMN IF NOT EXISTS maiden_he text;
UPDATE people SET maiden_he = maiden, maiden = NULL WHERE maiden ~ '[א-ת]' AND maiden_he IS NULL;
