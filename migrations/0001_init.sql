-- open-pipeline: contacts, their deals, the next actions, and everything that happened.
-- Times are ISO 8601 UTC strings. Ids are random UUIDs made by the Worker.

-- One person and their business (one prospect is one small business in this version).
CREATE TABLE contacts (
  id               TEXT PRIMARY KEY,
  name             TEXT,
  phone            TEXT,                   -- E.164, the first key an intake is matched on
  email            TEXT,                   -- lower case, the second key
  company          TEXT,
  trade            TEXT,
  town             TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  last_activity_at TEXT NOT NULL           -- the retention period counts from here
);
CREATE INDEX contacts_by_phone ON contacts (phone);
CREATE INDEX contacts_by_email ON contacts (email);

-- A sales opportunity, moving through the stages of config/pipeline.json.
CREATE TABLE deals (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT NOT NULL REFERENCES contacts (id),
  title       TEXT NOT NULL,
  stage       TEXT NOT NULL,
  source      TEXT,
  fields      TEXT NOT NULL DEFAULT '{}', -- the custom fields, as JSON
  lost_reason TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  closed_at   TEXT
);
CREATE INDEX deals_by_contact ON deals (contact_id);
CREATE INDEX deals_by_stage ON deals (stage);

-- The next actions: every open deal should have one.
CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,
  deal_id    TEXT NOT NULL REFERENCES deals (id),
  title      TEXT NOT NULL,
  due_at     TEXT NOT NULL,
  done_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX tasks_open ON tasks (done_at, due_at);
CREATE INDEX tasks_by_deal ON tasks (deal_id);

-- The timeline: notes, calls, meetings, emails, bookings, form messages, imports, stage changes.
CREATE TABLE activities (
  id         TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts (id),
  deal_id    TEXT REFERENCES deals (id),
  kind       TEXT NOT NULL,
  body       TEXT NOT NULL,
  source     TEXT,
  source_ref TEXT UNIQUE,                 -- a redelivered webhook is recorded once
  at         TEXT NOT NULL
);
CREATE INDEX activities_by_deal ON activities (deal_id, at);
CREATE INDEX activities_by_contact ON activities (contact_id);
