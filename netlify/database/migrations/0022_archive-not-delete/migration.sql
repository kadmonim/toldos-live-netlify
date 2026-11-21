-- Nothing is deleted through the site: what someone removes is archived (it leaves the page, the row and the file
-- stay). A document, video or link (profile_items) and a picture in someone's gallery or their headstone picture
-- (photos, roots_photos) get the time they were archived and who did it. A profile or family picture that is
-- removed or replaced has no row of its own: its file is copied aside in the storage (archived/<key>/<time>).
-- Really deleting something is done by hand, in the database.
ALTER TABLE profile_items ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE photos        ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE roots_photos  ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by uuid;
