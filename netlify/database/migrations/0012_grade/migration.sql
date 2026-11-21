-- A child's school grade is worked out from the birthday; this fixes it once for a child who is a year
-- ahead or behind (+1 / -1), and from then on it keeps counting from there. Null = as worked out.
ALTER TABLE people ADD COLUMN IF NOT EXISTS grade_offset smallint;
