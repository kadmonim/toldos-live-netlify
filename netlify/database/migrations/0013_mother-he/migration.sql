-- For someone whose parents aren't in this tree (who married in): their mother's full Hebrew name, as said in
-- a prayer ("... בן שרה רבקה"), for their tehillim card. mother_name stays the everyday name shown on the profile.
ALTER TABLE people ADD COLUMN IF NOT EXISTS mother_he text;
