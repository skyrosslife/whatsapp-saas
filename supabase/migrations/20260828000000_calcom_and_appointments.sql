-- ============================================================
-- Migration: 20260828000000_calcom_and_appointments
-- Cal.com integration: extend the existing appointments table + seed the
-- Cal.com tools into the catalog. Additive only — no columns dropped, no
-- behaviour changed for HighLevel or YCloud.
--
-- NOTE: the `appointments` table already exists (foundation migration) with
-- id / workspace_id / contact_id / conversation_id / schedule_id / scheduled_at
-- / status / hl_appointment_id / meta / timestamps, RLS policies
-- (appointments_select / appointments_write) and an updated_at trigger. This
-- migration only ADDs the columns the Cal.com flow needs.
-- ============================================================

-- ---- extend appointments for Cal.com bookings ----
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS provider          TEXT NOT NULL DEFAULT 'caldotcom',
  ADD COLUMN IF NOT EXISTS external_uid      TEXT,
  ADD COLUMN IF NOT EXISTS event_type_id     TEXT,
  ADD COLUMN IF NOT EXISTS end_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendee_email    TEXT,
  ADD COLUMN IF NOT EXISTS attendee_name     TEXT,
  ADD COLUMN IF NOT EXISTS reschedule_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason     TEXT;

-- One local row per external booking (only enforced when external_uid is set,
-- so pre-existing HighLevel rows with a NULL external_uid are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_provider_uid
  ON appointments (workspace_id, provider, external_uid)
  WHERE external_uid IS NOT NULL;

-- Fast lookup for "the contact's next upcoming appointment".
CREATE INDEX IF NOT EXISTS idx_appointments_contact_upcoming
  ON appointments (workspace_id, contact_id, status, scheduled_at);

-- ---- seed the 4 Cal.com tools into the catalog ----
INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('calcom_check_availability', 'Cal.com — consultar disponibilidad',
   'Checks real free time slots from the Cal.com event type for a date range',
   '{"type":"object","properties":{"date_from":{"type":"string"},"date_to":{"type":"string"},"timezone":{"type":"string"},"event_type":{"type":"string"}},"required":["date_from","date_to"]}',
   'read'),
  ('calcom_book', 'Cal.com — agendar cita',
   'Books an appointment in Cal.com and records it locally. Needs the attendee email.',
   '{"type":"object","properties":{"datetime_iso":{"type":"string"},"attendee_email":{"type":"string"},"attendee_name":{"type":"string"},"event_type":{"type":"string"},"timezone":{"type":"string"}},"required":["datetime_iso","attendee_email"]}',
   'write'),
  ('calcom_reschedule', 'Cal.com — reprogramar cita',
   'Reschedules the contact''s upcoming Cal.com appointment to a new time',
   '{"type":"object","properties":{"new_datetime_iso":{"type":"string"},"appointment_uid":{"type":"string"},"reason":{"type":"string"}},"required":["new_datetime_iso"]}',
   'write'),
  ('calcom_cancel', 'Cal.com — cancelar cita',
   'Cancels the contact''s upcoming Cal.com appointment',
   '{"type":"object","properties":{"appointment_uid":{"type":"string"},"reason":{"type":"string"}},"required":[]}',
   'write')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      schema = EXCLUDED.schema,
      sensitivity = EXCLUDED.sensitivity;

-- ============================================================
-- End of migration: 20260828000000_calcom_and_appointments
-- ============================================================
