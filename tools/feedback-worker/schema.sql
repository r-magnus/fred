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

-- Usage counts (#285): one row per install, event and day, for the Release
-- Candidate KRs (testers finish setup; testers come back). install_id is a
-- random ID made on the phone, never sent with a rating. No question, reply
-- or location.
CREATE TABLE IF NOT EXISTS usage (
  install_id  TEXT NOT NULL,
  event       TEXT NOT NULL,          -- open, ask, setup_started, guides_ready, area_ready,
                                      -- setup_done, setup_found, model_ready, model_failed
  day         TEXT NOT NULL,          -- YYYY-MM-DD, the phone's own date
  app_version TEXT NOT NULL,
  platform    TEXT NOT NULL,          -- "ios 18.2", "android 36"
  received_at TEXT NOT NULL,          -- ISO, server clock
  PRIMARY KEY (install_id, event, day)
);
CREATE INDEX IF NOT EXISTS usage_event_day ON usage (event, day);
