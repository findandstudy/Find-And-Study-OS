-- Keep platform operations ownership separate from an agency's internal team
-- ownership. Agent-side assignment must never overwrite the main platform's
-- assigned_to_id lane.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS agency_assigned_to_id integer REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS agency_assigned_to_id integer REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leads_agency_assigned_to_id_idx
  ON leads (agency_assigned_to_id);

CREATE INDEX IF NOT EXISTS students_agency_assigned_to_id_idx
  ON students (agency_assigned_to_id);
