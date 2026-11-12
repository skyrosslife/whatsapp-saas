-- Skala lead-qualification setter.
-- Adds the per-workspace Skala fields, the conversation lead profile and
-- pipeline stage, and an internal notification inbox for setter alerts.
-- Does not send messages and does not enable the mode by itself.
--
-- Booking link for the Skala Studio workspace (20-minute Cal.com call):
--   https://cal.com/sky-ross/diagnostico-skala
-- link_agenda stays empty on every other workspace. An empty link_agenda
-- means the bot never sends a booking link.

ALTER TABLE public.setter_configs
  ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS bot_name TEXT NOT NULL DEFAULT 'Asistente de Skala',
  ADD COLUMN IF NOT EXISTS link_agenda TEXT,
  ADD COLUMN IF NOT EXISTS link_demo TEXT,
  ADD COLUMN IF NOT EXISTS call_minutes INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS garantia_activa BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS umbral_agenda INTEGER NOT NULL DEFAULT 55,
  ADD COLUMN IF NOT EXISTS umbral_prioritario INTEGER NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS seguimientos_max INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS system_prompt TEXT NOT NULL DEFAULT $prompt$PLACEHOLDER — reemplaza este texto con el prompt final del setter de Skala.

Identidad provisional: eres el Asistente de Skala, una inteligencia artificial. Si te preguntan, dilo con claridad. Nunca te hagas pasar por Sky ni por una persona.

Idioma: español neutro, sin jerga chilena. Tutea por defecto. Usa usted si el lead usa usted o se presenta como Dr. o Dra.

Objetivo: conversar con dueños de clínicas (dental, estética o fisioterapia), entender su operación y, solo cuando el sistema lo indique en el turno, ofrecer una llamada con Sky.

No inventes precios, montos, garantías ni enlaces. Si este texto aún es el placeholder, sigue las instrucciones de turno que el sistema agrega al final.$prompt$;

ALTER TABLE public.setter_configs
  DROP CONSTRAINT IF EXISTS setter_configs_engine_check;
ALTER TABLE public.setter_configs
  ADD CONSTRAINT setter_configs_engine_check
  CHECK (engine IN ('generic', 'skala'));

ALTER TABLE public.setter_configs
  DROP CONSTRAINT IF EXISTS setter_configs_call_minutes_check;
ALTER TABLE public.setter_configs
  ADD CONSTRAINT setter_configs_call_minutes_check
  CHECK (call_minutes BETWEEN 5 AND 180);

ALTER TABLE public.setter_configs
  DROP CONSTRAINT IF EXISTS setter_configs_umbral_agenda_check;
ALTER TABLE public.setter_configs
  ADD CONSTRAINT setter_configs_umbral_agenda_check
  CHECK (umbral_agenda BETWEEN 0 AND 100);

ALTER TABLE public.setter_configs
  DROP CONSTRAINT IF EXISTS setter_configs_umbral_prioritario_check;
ALTER TABLE public.setter_configs
  ADD CONSTRAINT setter_configs_umbral_prioritario_check
  CHECK (umbral_prioritario BETWEEN 0 AND 100);

ALTER TABLE public.setter_configs
  DROP CONSTRAINT IF EXISTS setter_configs_umbral_order_check;
ALTER TABLE public.setter_configs
  ADD CONSTRAINT setter_configs_umbral_order_check
  CHECK (umbral_prioritario >= umbral_agenda);

ALTER TABLE public.setter_configs
  DROP CONSTRAINT IF EXISTS setter_configs_seguimientos_max_check;
ALTER TABLE public.setter_configs
  ADD CONSTRAINT setter_configs_seguimientos_max_check
  CHECK (seguimientos_max BETWEEN 0 AND 5);

COMMENT ON COLUMN public.setter_configs.link_agenda IS
  'Booking URL sent only after the score gate passes. Empty means never send a link. Skala Studio: https://cal.com/sky-ross/diagnostico-skala (20 min, Cal.com).';

COMMENT ON COLUMN public.setter_configs.engine IS
  'generic keeps knockout scoring. skala runs the clinic lead-qualification setter.';

-- Per-conversation qualification state.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS lead_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT NOT NULL DEFAULT 'NUEVO',
  ADD COLUMN IF NOT EXISTS setter_route TEXT,
  ADD COLUMN IF NOT EXISTS setter_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS followup_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS followup_no_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS followup_stopped BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_pipeline_stage_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_pipeline_stage_check
  CHECK (pipeline_stage IN (
    'NUEVO', 'CALIFICANDO', 'REVISION', 'LINK_ENVIADO',
    'AGENDADO', 'CLIENTE', 'NUTRIR', 'PERDIDO'
  ));

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT;

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_pipeline_stage_check;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_pipeline_stage_check
  CHECK (
    pipeline_stage IS NULL OR pipeline_stage IN (
      'NUEVO', 'CALIFICANDO', 'REVISION', 'LINK_ENVIADO',
      'AGENDADO', 'CLIENTE', 'NUTRIR', 'PERDIDO'
    )
  );

CREATE INDEX IF NOT EXISTS idx_conversations_pipeline
  ON public.conversations (workspace_id, pipeline_stage);

CREATE INDEX IF NOT EXISTS idx_contacts_pipeline_stage
  ON public.contacts (workspace_id, pipeline_stage)
  WHERE pipeline_stage IS NOT NULL;

-- Internal inbox for setter alerts. No outbound channel and no new credentials.
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'setter_alert',
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace
  ON public.notifications (workspace_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select
  ON public.notifications FOR SELECT
  USING (workspace_id IN (SELECT public.auth_workspace_ids()));

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update
  ON public.notifications FOR UPDATE
  USING (workspace_id IN (SELECT public.auth_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.auth_workspace_ids()));

-- Seed the documented Skala booking link when a workspace named or slugged
-- "skala" already exists. Leaves `enabled` untouched, so nothing starts
-- sending until someone turns the setter on. Never overwrites a link that
-- was already configured. No-op when no such workspace exists.
INSERT INTO public.setter_configs (
  workspace_id,
  name,
  enabled,
  engine,
  bot_name,
  link_agenda,
  call_minutes,
  garantia_activa,
  umbral_agenda,
  umbral_prioritario,
  seguimientos_max,
  system_prompt
)
SELECT
  w.id,
  'Setter Skala',
  FALSE,
  'skala',
  'Asistente de Skala',
  'https://cal.com/sky-ross/diagnostico-skala',
  20,
  FALSE,
  55,
  75,
  2,
  $prompt$PLACEHOLDER — reemplaza este texto con el prompt final del setter de Skala.

Identidad provisional: eres el Asistente de Skala, una inteligencia artificial. Si te preguntan, dilo con claridad. Nunca te hagas pasar por Sky ni por una persona.

Idioma: español neutro, sin jerga chilena. Tutea por defecto. Usa usted si el lead usa usted o se presenta como Dr. o Dra.

Objetivo: conversar con dueños de clínicas (dental, estética o fisioterapia), entender su operación y, solo cuando el sistema lo indique en el turno, ofrecer una llamada con Sky.

No inventes precios, montos, garantías ni enlaces. Si este texto aún es el placeholder, sigue las instrucciones de turno que el sistema agrega al final.$prompt$
FROM public.workspaces w
WHERE (w.slug ILIKE '%skala%' OR w.name ILIKE '%skala%')
  AND NOT EXISTS (
    SELECT 1 FROM public.setter_configs sc WHERE sc.workspace_id = w.id
  );

UPDATE public.setter_configs AS sc
SET
  engine = 'skala',
  bot_name = 'Asistente de Skala',
  call_minutes = CASE WHEN sc.call_minutes IS NULL OR sc.call_minutes = 20 THEN 20 ELSE sc.call_minutes END,
  link_agenda = CASE
    WHEN sc.link_agenda IS NULL OR btrim(sc.link_agenda) = ''
      THEN 'https://cal.com/sky-ross/diagnostico-skala'
    ELSE sc.link_agenda
  END
FROM public.workspaces AS w
WHERE sc.workspace_id = w.id
  AND (w.slug ILIKE '%skala%' OR w.name ILIKE '%skala%');
