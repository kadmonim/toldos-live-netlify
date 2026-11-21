-- A photo for an earlier-roots person (in Netlify Blobs "photos" under "roots-<id>", like the tree's profile
-- photos); photo_v is the upload time and busts caches, as on people.
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS photo_v bigint;
