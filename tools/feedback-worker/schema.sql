-- Ratings of Fred's replies (#247). One row per rated reply: a changed mind
-- or a later comment replaces the row (the newest rated_at wins).
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  rating      TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  comment     TEXT,
  question    TEXT NOT NULL,
  reply       TEXT NOT NULL,
  reply_kind  TEXT NOT NULL,
  sources     TEXT NOT NULL,          -- JSON array of "manual, p. N · section"
  deep        INTEGER NOT NULL,       -- 0/1: deep thinking was on
  stopped     INTEGER NOT NULL,       -- 0/1: the reader stopped the answer
  asked_at    TEXT NOT NULL,          -- ISO, phone clock
  rated_at    TEXT NOT NULL,          -- ISO, phone clock
  received_at TEXT NOT NULL,          -- ISO, server clock
  app_version TEXT NOT NULL,
  platform    TEXT NOT NULL           -- "ios 18.2", "android 35"
);
CREATE INDEX IF NOT EXISTS feedback_received ON feedback (received_at);
CREATE INDEX IF NOT EXISTS feedback_rating ON feedback (rating, received_at);
