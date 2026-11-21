-- Someone's own settings for their tehillim page (behind its gear), e.g. {"rebbe": true} to add the Rebbe's chapter.
ALTER TABLE people ADD COLUMN IF NOT EXISTS tehillim jsonb;
