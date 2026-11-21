-- Where someone is buried (free text: cemetery, section, row…), shown with the headstone photo on the profile of
-- someone who passed away, in the tree and in the earlier roots.
ALTER TABLE people ADD COLUMN IF NOT EXISTS burial text;
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS burial text;
