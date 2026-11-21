-- A famous ancestor in the extended family: a few words on who they were, in Hebrew and English ("פרשן התורה
-- והתלמוד" / "Commentator on the Torah and Talmud"). Those with one are listed on the site's famous-ancestors page.
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS notable_he text;
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS notable_en text;
