-- הכהן / הלוי for the tree's own people too (the extended family has it since 0036): its own field, shown on the
-- person's page between the first name and the family name.
ALTER TABLE people ADD COLUMN IF NOT EXISTS tribe text CHECK (tribe IN ('levi', 'kohen'));
