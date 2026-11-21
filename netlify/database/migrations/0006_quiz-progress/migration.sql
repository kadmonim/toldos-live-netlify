-- What each person has learned in the quiz's games: one row per person, game and question, with how
-- often they got it right and wrong, their current run of right answers, and when they last
-- answered. The games ask by it: soon after a wrong answer, further apart as the run grows (spaced
-- repetition). Private: the site only ever sends a person their own rows (functions/progress.mjs).
CREATE TABLE IF NOT EXISTS quiz_progress (
  person_id uuid        NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  game      text        NOT NULL,   -- 'who', 'bday', 'inlaw', …
  item      text        NOT NULL,   -- the question: a person id, 'c:<couple id>', 'age:<id>', 'sp:<id>', …
  right_n   integer     NOT NULL DEFAULT 0,
  wrong_n   integer     NOT NULL DEFAULT 0,
  streak    integer     NOT NULL DEFAULT 0,   -- right answers in a row, back to 0 on a wrong one
  last_ok   boolean,
  last_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, game, item)
);
