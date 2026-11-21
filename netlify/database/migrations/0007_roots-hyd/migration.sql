-- הי"ד: someone killed by the Nazis. Shown right after the name ("דובער פעסקין הי״ד", "Dovber Peskin HY"D"),
-- like ז"ל; anyone can set it in the name sheet of the earlier-roots page.
ALTER TABLE roots_people ADD COLUMN IF NOT EXISTS hyd boolean NOT NULL DEFAULT false;
