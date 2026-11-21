-- A small preview picture for a profile item: the first page of a PDF (drawn in the browser when the file is
-- added, or the first time someone sees an older one), a scan made small, or the picture a linked page offers
-- for previews. Kept in Cloudflare R2 next to the files, under thumbs/<item id>/. 'none' = looked, there is none.
ALTER TABLE profile_items ADD COLUMN IF NOT EXISTS thumb_key text;
