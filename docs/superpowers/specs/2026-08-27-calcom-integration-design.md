# Cal.com Integration — Design Spec

**Date:** 2026-08-27
**Branch:** `feat/calcom-integration`
**Status:** approved, pending implementation plan

## Goal

Add Cal.com as a per-workspace calendar provider so a WhatsApp agent can, from
the chat alone: check real availability, book an appointment, reschedule it, and
cancel it. Additive only — HighLevel, YCloud, the buffer, the agent engine, and
the `provider/kapso` branch are not modified.

## Context

- `integrations.provider` enum already reserves `'caldotcom'` (unused today).
- The pattern to mirror already exists: `highlevel-client.ts` +
  `check_availability` (read) / `schedule_highlevel` (write) tools, activated per
  workspace through `tool_configs`.
- Cal.com API v2:
  - `GET /v2/slots` — header `cal-api-version: 2024-09-04`
  - `POST /v2/bookings` — header `cal-api-version: 2024-08-13`; `attendee.email`
    is **required**; returns a booking `uid`
  - `POST /v2/bookings/{uid}/reschedule` — `{ start, reschedulingReason }`
  - `POST /v2/bookings/{uid}/cancel` — `{ cancellationReason }`
  - Auth: `Authorization: Bearer <apiKey>`
- `encryptCredentials` / `decryptCredentials` are generic (encrypt every string
  value, AAD bound to `<workspaceId>:<provider>`) — no per-provider changes.
- `sensitivity: "sensitive"` currently **blocks tool execution** and returns
  `requiresConfirmation: true`, but nothing consumes that flag to resume the
  call. So reschedule/cancel must be `"write"`, with confirmation handled
  conversationally by the prompt.

## Decisions (from brainstorming)

1. **Email:** the bot asks the customer for their email in the chat before
   booking. Real Cal.com confirmation + reminders. Persist to `contacts.email`
   when empty.
2. **Host:** configurable base URL per workspace (default `https://api.cal.com`),
   so self-hosted Cal.com works.
3. **Coexistence:** separate `calcom_*` tools, HighLevel untouched. A workspace
   enables the Cal.com tools **or** the HighLevel tools, not both. The agent
   prompt is unchanged; only the available tools differ.
4. **"Which booking" for reschedule/cancel:** local `appointments` table is the
   source of truth (Approach A). The bot writes the Cal.com `uid` on booking;
   reschedule/cancel look up the contact's next upcoming `accepted` row. Cal.com
   webhooks to sync out-of-band bookings are **out of scope for v1** (phase 2).

## Architecture

```
integrations (provider='caldotcom')      credentials + config per workspace
  └─ calcom-client.ts                     service: getSlots / createBooking / reschedule / cancel
       └─ 4 tools                          calcom_check_availability / _book / _reschedule / _cancel
            └─ appointments (new table)    Cal.com uid + status, local source of truth
```

## 1. Integration: credentials & config

`integrations` row, `provider='caldotcom'`:

| Field                        | Location                                 | Example                                                        |
| ---------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| API key                      | `credentials.calcom_api_key` (encrypted) | `cal_live_xxx`                                                 |
| Base URL                     | `config.base_url`                        | `https://api.cal.com` (default)                                |
| Default event type           | `config.default_event_type_id`           | `123`                                                          |
| Timezone                     | `config.timezone`                        | `America/Mexico_City` (falls back to `business_info` timezone) |
| Named event types (optional) | `config.event_types`                     | `{"consulta": 123, "limpieza": 456}`                           |

**Code changes:**

- `src/app/api/workspace/[id]/integrations/route.ts`: add `"caldotcom"` to the
  `IntegrationSchema` provider enum. Nothing else in that route changes
  (encryption already generic).
- `src/features/settings/components/integrations-tab.tsx`: new `CalDotComSection`
  component, copy of the `YCloudSection` pattern (inputs + "Probar conexión").
- New `POST /api/workspace/[id]/integrations/calcom/test/route.ts`: calls
  `GET {base_url}/v2/me`, returns the account name or an error string.

## 2. Service: `src/features/inbox/services/calcom-client.ts`

Mirror of `highlevel-client.ts`. Never throws — logs and returns `null` / an
error shape.

```ts
interface CalComConfig {
  apiKey: string;
  baseUrl: string;               // no trailing slash
  defaultEventTypeId: number | null;
  timezone: string | null;
  eventTypes: Record<string, number>;  // {} when unset
}

getCalComConfig(workspaceId): Promise<CalComConfig | null>   // null = not connected
getSlots({ eventTypeId, startISO, endISO, timeZone }): Promise<string[] | null>
createBooking({ eventTypeId, startISO, attendee, timeZone }): Promise<CalBooking | null>
rescheduleBooking(uid, { startISO, reason }): Promise<CalBooking | null>
cancelBooking(uid, { reason }): Promise<boolean>
```

- `attendee` = `{ name, email, timeZone, language: "es" }`.
- `CalBooking` = `{ uid, start, end, status }`.
- Header constants: `CAL_VERSION_BOOKINGS = "2024-08-13"`,
  `CAL_VERSION_SLOTS = "2024-09-04"`.
- Resolve an event type name → id via `config.event_types`, else
  `defaultEventTypeId`.

## 3. Table: `appointments`

Migration `supabase/migrations/20260…_calcom_and_appointments.sql`:

```sql
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'caldotcom',
  external_uid TEXT NOT NULL,
  event_type_id TEXT,
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted','rescheduled','cancelled')),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  attendee_email TEXT,
  attendee_name TEXT,
  reschedule_reason TEXT,
  cancel_reason TEXT,
  raw JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (workspace_id, provider, external_uid)
);
CREATE INDEX idx_appointments_contact_upcoming
  ON appointments (workspace_id, contact_id, status, start_at);

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON appointments;
CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

- **RLS:** enable, and reproduce the `contacts` policies — admin/manager/agent of
  the workspace may `SELECT`; writes happen through the service-role client
  inside the tools (same as `schedule_highlevel`).
- Same migration seeds the 4 tools into `public.tools` (with `sensitivity`),
  idempotent `ON CONFLICT (key) DO UPDATE`, matching
  `20260617000001_seed_check_availability_tool.sql`.

## 4. Tools (`src/features/tools/tools/`)

All resolve the contact from `ToolContext` like `schedule_highlevel`, and accept
explicit overrides for the playground. All registered in `tools/index.ts`.

### `calcom_check_availability` — sensitivity `read`

`args: { date_from, date_to, timezone?, event_type? }`
`event_type` is a name (mapped via `config.event_types`) or omitted (uses
`default_event_type_id`). Calls `getSlots`, returns ≤20 ISO slots, or a
"no slots" message.

### `calcom_book` — sensitivity `write`

`args: { datetime_iso, attendee_email, attendee_name?, event_type?, timezone? }`

1. Validate `attendee_email` format; if missing/invalid → `ok:false` with a
   message telling the agent to ask for it.
2. `createBooking()`.
3. Insert into `appointments` (`status='accepted'`, `external_uid`, `start_at`,
   `end_at`, `attendee_*`, `conversation_id`, `contact_id`).
4. If `contacts.email` is empty → set it.
5. Return `{ appointment_id, uid, datetime }`.

### `calcom_reschedule` — sensitivity `write`

`args: { new_datetime_iso, appointment_uid?, reason? }`

- No `appointment_uid` → find the contact's next `accepted` row with
  `start_at > now()`.
  - 0 rows → `ok:false`, "no encuentro una cita a tu nombre".
  - > 1 rows → `ok:false` with the list, so the agent asks which one.
- `rescheduleBooking()`. Cal.com may return a new `uid`: update `external_uid`,
  `start_at`, keep the old uid in `raw.previous_uid`. `status` stays `accepted`
  (a completed reschedule is still an active booking); `reschedule_reason` set.

### `calcom_cancel` — sensitivity `write`

`args: { appointment_uid?, reason? }`

- Same "which appointment" resolution.
- `cancelBooking()`, set `status='cancelled'`, `cancel_reason`.

**Confirmation:** `reschedule` and `cancel` are `write`, not `sensitive` (the
`sensitive` gate has no resume path today). The agent prompt must confirm
date/time before `calcom_book` and confirm before `calcom_cancel`. A real
approval gate is noted as a future improvement, not built here.

## 5. Error handling

| Case                                | Tool result                                           | Agent behaviour                      |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| Cal.com not connected               | `ok:false, error:"Cal.com no está conectado…"`        | says so / offers handoff             |
| Slot taken (race)                   | `ok:false, error:"Ese horario ya no está disponible"` | re-calls `calcom_check_availability` |
| Missing/invalid email on book       | `ok:false, error:"Falta un email válido"`             | asks the customer                    |
| API 5xx / timeout (10s, 1 retry)    | `ok:false, error:"Cal API error: …"`                  | retries once or handoff              |
| 0 appointments on reschedule/cancel | `ok:false` + message                                  | asks for details or handoff          |

## 6. Testing (mock `fetch` + supabase, existing `*.test.ts` pattern)

- `calcom-client.test.ts` — headers (`cal-api-version`), slot parsing, booking
  payload shape, `null` on 4xx/5xx.
- `calcom-book.test.ts` — contact resolution from `ctx`, `appointments` insert,
  `contacts.email` filled only when empty, invalid-email rejection.
- `calcom-reschedule.test.ts` / `calcom-cancel.test.ts` — "next appointment"
  logic (0 / 1 / >1 upcoming), status transitions, API-error propagation.
- `integrations/route.test.ts` — accepts `provider:"caldotcom"`, encrypts
  `calcom_api_key`.
- No live Cal.com e2e — all mocked.

## 7. Files

**New (~11):**

- `supabase/migrations/20260…_calcom_and_appointments.sql`
- `src/features/inbox/services/calcom-client.ts`
- `src/features/tools/tools/calcom-check-availability.ts`
- `src/features/tools/tools/calcom-book.ts`
- `src/features/tools/tools/calcom-reschedule.ts`
- `src/features/tools/tools/calcom-cancel.ts`
- `src/app/api/workspace/[id]/integrations/calcom/test/route.ts`
- `calcom-client.test.ts`, `calcom-book.test.ts`, `calcom-reschedule.test.ts`,
  `calcom-cancel.test.ts`

**Edited (additive only):**

- `src/app/api/workspace/[id]/integrations/route.ts` — `"caldotcom"` in the zod enum
- `src/features/tools/index.ts` — register 4 tools
- `src/features/settings/components/integrations-tab.tsx` — `CalDotComSection`
- `src/features/settings/components/tools-catalog.tsx` — icons for the 4 tools (cosmetic)

**Untouched:** HighLevel, YCloud, buffer, agent engine, prompts, `provider/kapso`.

## Out of scope (phase 2)

- Cal.com webhooks (`BOOKING_CREATED/RESCHEDULED/CANCELLED`) to sync bookings
  made outside WhatsApp.
- A real human-approval gate for sensitive tools.
- A calendar-provider abstraction unifying HighLevel + Cal.com behind one tool set.
- Native CRM views over the `appointments` table.

## Customization surface

- Per workspace: API key, base URL, default event type, timezone, named event
  type map — all in the integration config.
- Per agent: the prompt controls tone, the ask-for-email step, and the
  confirm-before-book / confirm-before-cancel behaviour.
- Enable/disable each of the 4 tools independently in Settings → Herramientas.
