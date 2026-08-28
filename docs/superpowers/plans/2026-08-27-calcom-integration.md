# Cal.com Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cal.com as a per-workspace calendar provider so a WhatsApp agent can check availability, book, reschedule, and cancel appointments from the chat.

**Architecture:** Mirror the existing HighLevel pattern — an `integrations` row (`provider='caldotcom'`) holds the encrypted API key + config; a `calcom-client.ts` service wraps Cal.com API v2; four new registry tools (`calcom_check_availability` / `calcom_book` / `calcom_reschedule` / `calcom_cancel`) call the service; a new `appointments` table is the local source of truth for "which booking" during reschedule/cancel. HighLevel, YCloud, the buffer, and the agent engine are untouched.

**Tech Stack:** Next.js 16, TypeScript, Supabase (Postgres + RLS), Zod v4, AI SDK v6. New dev dependency: Vitest (+ `vite-tsconfig-paths`) — the repo has no unit-test runner today.

**Spec:** `docs/superpowers/specs/2026-08-27-calcom-integration-design.md`

**Branch:** `feat/calcom-integration` (already created)

---

## Implementation deviations (discovered during execution)

1. **Vitest config file is `vitest.config.mts`** (not `.ts`) — the repo is CommonJS and `vite-tsconfig-paths` is ESM-only.
2. **`appointments` table already existed** (foundation migration, dormant — no code uses it). Task 6 was rewritten to `ALTER TABLE appointments ADD COLUMN ...` instead of `CREATE TABLE`. Consequences for Tasks 7/9/10/11:
   - start time column is **`scheduled_at`** (existing, `NOT NULL`), not `start_at`.
   - raw payload column is **`meta`** (existing jsonb), not `raw`.
   - `status` values must fit the existing CHECK `('booked','confirmed','cancelled','completed','no_show')`: use **`'booked'`** for a new/rescheduled booking (not `'accepted'`), `'cancelled'` for a cancel.
   - RLS policies (`appointments_select` / `appointments_write`) and the `updated_at` trigger already exist — the migration does not re-create them.
   - Added columns: `provider` (default `'caldotcom'`), `external_uid`, `event_type_id`, `end_at`, `attendee_email`, `attendee_name`, `reschedule_reason`, `cancel_reason`; partial unique index `uq_appointments_provider_uid` on `(workspace_id, provider, external_uid) WHERE external_uid IS NOT NULL`.

   Task 6 is **already applied** to the remote DB (commit `1d05c09`). Tasks 7/9/10/11 code and tests below must use `scheduled_at` / `meta` / `'booked'` in place of `start_at` / `raw` / `'accepted'`.

## Post-review fixes (applied after the final code review)

- **C1** — `calcom_reschedule` / `calcom_cancel` now always resolve against the contact's own upcoming appointments; an LLM-supplied `appointment_uid` must be one of them or it's rejected. (`0279eb7`)
- **C2** — empty/`null`/`0` `default_event_type_id` resolves to `null` (was `0`, which silently passed the guard). (`84aa06a`)
- **I1** — `findUpcomingAppointments` scoped to `provider='caldotcom'` + `external_uid IS NOT NULL`. (`e43a4b7`)
- **I4** — `getCalComConfig` wraps `decryptCredentials` and returns `null` instead of throwing. (`1d3dd83`)
- **I6** — reschedule keeps the previous Cal.com uid in `meta.previous_uid` when Cal.com issues a new one. (`e6af4d6`)
- **I7** — added the `bk_old → bk_new` reschedule test; the supabase mock now records `.gt` / `.not`.

## Deferred to a follow-up ticket (not blocking)

- **I2** — `calcom_book` returns `ok:true` even if the local `appointments` insert fails (Cal.com booking exists but is unreachable from chat). Should surface `local_record:false` + push to handoff, or retry.
- **I3** — the registry's 10s timeout + 1 retry can double-book a slow `calcom_book`. Set `retries:0` for write tools or add an idempotency key.
- **I5** — `config.base_url` is unvalidated → SSRF. Apply the existing `ssrf-guard.ts` (`validateWebhookUrl`, SEC-08) to `base_url` at save time.
- Minor: `minRole:"manager"` on the calcom test route; real slot count vs the 20 cap; `resolveEventTypeId` silently falls back to default on an unknown name; `attendee_email` lands in `events.payload`.

---

## File Structure

**New files:**

| Path                                                             | Responsibility                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `vitest.config.ts`                                               | Vitest config with `@/` path alias, node environment                                     |
| `src/test/supabase-mock.ts`                                      | Shared chainable Supabase client mock for unit tests                                     |
| `src/features/inbox/services/calcom-client.ts`                   | Cal.com API v2 wrapper: config loader, slots, booking, reschedule, cancel. Never throws. |
| `src/features/inbox/services/calcom-client.test.ts`              | Unit tests for the client                                                                |
| `src/features/inbox/services/appointments-repo.ts`               | Local `appointments` table access: insert, find upcoming, update by uid                  |
| `src/features/inbox/services/appointments-repo.test.ts`          | Unit tests for the repo                                                                  |
| `src/features/tools/tools/calcom-check-availability.ts`          | `read` tool — free slots                                                                 |
| `src/features/tools/tools/calcom-check-availability.test.ts`     | Unit tests                                                                               |
| `src/features/tools/tools/calcom-book.ts`                        | `write` tool — create booking + persist                                                  |
| `src/features/tools/tools/calcom-book.test.ts`                   | Unit tests                                                                               |
| `src/features/tools/tools/calcom-reschedule.ts`                  | `write` tool — reschedule the contact's upcoming booking                                 |
| `src/features/tools/tools/calcom-reschedule.test.ts`             | Unit tests                                                                               |
| `src/features/tools/tools/calcom-cancel.ts`                      | `write` tool — cancel the contact's upcoming booking                                     |
| `src/features/tools/tools/calcom-cancel.test.ts`                 | Unit tests                                                                               |
| `src/app/api/workspace/[id]/integrations/calcom/test/route.ts`   | "Probar conexión" endpoint (`GET {baseUrl}/v2/me`)                                       |
| `supabase/migrations/20260828000000_calcom_and_appointments.sql` | `appointments` table + RLS + seed 4 tools into `public.tools`                            |

**Modified files (additive only):**

| Path                                                    | Change                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `package.json`                                          | add `vitest`, `vite-tsconfig-paths` dev deps + `"test"` / `"test:run"` scripts |
| `src/features/tools/index.ts`                           | register the 4 new tools                                                       |
| `src/app/api/workspace/[id]/integrations/route.ts`      | add `"caldotcom"` to the `IntegrationSchema` provider enum                     |
| `src/features/settings/components/integrations-tab.tsx` | add `CalDotComSection`, render it in `IntegrationsTab`                         |
| `src/features/settings/components/tools-catalog.tsx`    | add icons for the 4 new tool keys                                              |

**Untouched:** `highlevel-client.ts`, `schedule-highlevel.ts`, `check-availability.ts`, YCloud, `buffer.ts`, `openrouter.ts`, prompts, `provider/kapso`.

---

## Task 1: Vitest setup

**Files:**

- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/test/supabase-mock.ts`
- Create: `src/test/smoke.test.ts` (temporary, deleted in step 7)

- [ ] **Step 1: Install dev dependencies**

Run:

```bash
npm install -D vitest@^2 vite-tsconfig-paths@^5
```

Expected: both added to `devDependencies` in `package.json`.

- [ ] **Step 2: Add test scripts to `package.json`**

In the `"scripts"` block, add:

```json
    "test": "vitest",
    "test:run": "vitest run",
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
```

- [ ] **Step 4: Create `src/test/supabase-mock.ts`**

A chainable stub that mimics the `@supabase/supabase-js` query builder. Each terminal call (`.single()`, `.maybeSingle()`, or awaiting the builder) resolves to a caller-provided result. `.insert()` / `.update()` / `.upsert()` capture their payloads.

```ts
import { vi } from "vitest";

export interface QueryResult {
  data: unknown;
  error: unknown;
}

export interface TableStub {
  /** Result returned by .single()/.maybeSingle()/await. Override per test. */
  result: QueryResult;
  /** Captured payloads from insert/update/upsert calls, in order. */
  writes: { op: "insert" | "update" | "upsert"; payload: unknown }[];
  /** Captured .eq() filters, in order. */
  filters: { col: string; val: unknown }[];
}

export interface SupabaseMock {
  client: {
    from: ReturnType<typeof vi.fn>;
  };
  /** Per-table stub. Access/mutate `.result` before the code under test runs. */
  table: (name: string) => TableStub;
}

export function makeSupabaseMock(): SupabaseMock {
  const tables = new Map<string, TableStub>();

  const getTable = (name: string): TableStub => {
    let t = tables.get(name);
    if (!t) {
      t = { result: { data: null, error: null }, writes: [], filters: [] };
      tables.set(name, t);
    }
    return t;
  };

  const from = vi.fn((name: string) => {
    const t = getTable(name);
    const builder: Record<string, unknown> = {};
    const chain = () => builder;

    builder.select = vi.fn(chain);
    builder.order = vi.fn(chain);
    builder.limit = vi.fn(chain);
    builder.gt = vi.fn(chain);
    builder.eq = vi.fn((col: string, val: unknown) => {
      t.filters.push({ col, val });
      return builder;
    });
    builder.insert = vi.fn((payload: unknown) => {
      t.writes.push({ op: "insert", payload });
      return builder;
    });
    builder.update = vi.fn((payload: unknown) => {
      t.writes.push({ op: "update", payload });
      return builder;
    });
    builder.upsert = vi.fn((payload: unknown) => {
      t.writes.push({ op: "upsert", payload });
      return builder;
    });
    builder.single = vi.fn(() => Promise.resolve(t.result));
    builder.maybeSingle = vi.fn(() => Promise.resolve(t.result));
    // Awaiting the builder itself (no .single()) resolves to the result.
    builder.then = (resolve: (v: QueryResult) => unknown) => resolve(t.result);

    return builder;
  });

  return { client: { from }, table: getTable };
}
```

- [ ] **Step 5: Create `src/test/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { makeSupabaseMock } from "./supabase-mock";

describe("vitest setup", () => {
  it("runs and resolves @/ imports via the mock helper", async () => {
    const sb = makeSupabaseMock();
    sb.table("contacts").result = { data: { id: "c1" }, error: null };
    const res = await sb.client
      .from("contacts")
      .select("id")
      .eq("id", "c1")
      .single();
    expect(res).toEqual({ data: { id: "c1" }, error: null });
  });
});
```

- [ ] **Step 6: Run the smoke test**

Run: `npm run test:run -- src/test/smoke.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Delete the smoke test and commit**

```bash
rm src/test/smoke.test.ts
git add package.json package-lock.json vitest.config.ts src/test/supabase-mock.ts
git commit -m "test: add vitest runner and supabase mock helper"
```

---

## Task 2: `calcom-client.ts` — config loader

**Files:**

- Create: `src/features/inbox/services/calcom-client.ts`
- Test: `src/features/inbox/services/calcom-client.test.ts`

Background: `getCalComConfig` reads the `integrations` row for `provider='caldotcom'` and `enabled=true`, decrypts `credentials.calcom_api_key`, and reads `config`. Timezone falls back to `business_info.structured.timezone` (same source the test-chat route uses). Returns `null` when not connected (no row or no api key).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock } from "@/test/supabase-mock";

const sb = makeSupabaseMock();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => sb.client,
}));
vi.mock("@/shared/lib/integration-secrets", () => ({
  decryptCredentials: vi.fn(async (c: Record<string, unknown>) => c),
}));

import { getCalComConfig } from "./calcom-client";

beforeEach(() => {
  sb.table("integrations").result = { data: null, error: null };
  sb.table("business_info").result = { data: null, error: null };
});

describe("getCalComConfig", () => {
  it("returns null when there is no enabled caldotcom integration", async () => {
    sb.table("integrations").result = { data: null, error: null };
    expect(await getCalComConfig("ws1")).toBeNull();
  });

  it("returns null when the api key is missing", async () => {
    sb.table("integrations").result = {
      data: { credentials: {}, config: { base_url: "https://api.cal.com" } },
      error: null,
    };
    expect(await getCalComConfig("ws1")).toBeNull();
  });

  it("parses key, base url, event types, and default event type", async () => {
    sb.table("integrations").result = {
      data: {
        credentials: { calcom_api_key: "cal_live_x" },
        config: {
          base_url: "https://api.cal.com/",
          default_event_type_id: 123,
          timezone: "America/Mexico_City",
          event_types: { consulta: 123, limpieza: 456 },
        },
      },
      error: null,
    };
    const cfg = await getCalComConfig("ws1");
    expect(cfg).toEqual({
      apiKey: "cal_live_x",
      baseUrl: "https://api.cal.com", // trailing slash stripped
      defaultEventTypeId: 123,
      timezone: "America/Mexico_City",
      eventTypes: { consulta: 123, limpieza: 456 },
    });
  });

  it("falls back to business_info timezone when config.timezone is unset", async () => {
    sb.table("integrations").result = {
      data: {
        credentials: { calcom_api_key: "cal_live_x" },
        config: { default_event_type_id: 1 },
      },
      error: null,
    };
    sb.table("business_info").result = {
      data: { structured: { timezone: "America/Bogota" } },
      error: null,
    };
    const cfg = await getCalComConfig("ws1");
    expect(cfg?.timezone).toBe("America/Bogota");
    expect(cfg?.baseUrl).toBe("https://api.cal.com"); // default when unset
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/features/inbox/services/calcom-client.test.ts`
Expected: FAIL — `getCalComConfig` is not exported / file missing.

- [ ] **Step 3: Implement the config loader**

```ts
// src/features/inbox/services/calcom-client.ts
import { createClient as createSbClient } from "@supabase/supabase-js";
import { decryptCredentials } from "@/shared/lib/integration-secrets";

const DEFAULT_BASE_URL = "https://api.cal.com";
export const CAL_VERSION_BOOKINGS = "2024-08-13";
export const CAL_VERSION_SLOTS = "2024-09-04";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface CalComConfig {
  apiKey: string;
  baseUrl: string; // no trailing slash
  defaultEventTypeId: number | null;
  timezone: string | null;
  eventTypes: Record<string, number>;
}

export async function getCalComConfig(
  workspaceId: string,
): Promise<CalComConfig | null> {
  const supabase = svc();

  const { data, error } = await supabase
    .from("integrations")
    .select("credentials, config, enabled")
    .eq("workspace_id", workspaceId)
    .eq("provider", "caldotcom")
    .eq("enabled", true)
    .maybeSingle();

  if (error || !data) return null;

  const creds = await decryptCredentials(
    data.credentials as Record<string, unknown> | null,
    workspaceId,
    "caldotcom",
  );
  const config = (data.config as Record<string, unknown> | null) ?? {};

  const apiKey = creds.calcom_api_key;
  if (typeof apiKey !== "string" || apiKey.length === 0) return null;

  const rawBase =
    typeof config.base_url === "string" && config.base_url.length > 0
      ? config.base_url
      : DEFAULT_BASE_URL;
  const baseUrl = rawBase.replace(/\/+$/, "");

  const defaultEventTypeId =
    typeof config.default_event_type_id === "number"
      ? config.default_event_type_id
      : Number.isFinite(Number(config.default_event_type_id))
        ? Number(config.default_event_type_id)
        : null;

  const eventTypes: Record<string, number> = {};
  if (config.event_types && typeof config.event_types === "object") {
    for (const [k, v] of Object.entries(
      config.event_types as Record<string, unknown>,
    )) {
      const n = Number(v);
      if (Number.isFinite(n)) eventTypes[k] = n;
    }
  }

  let timezone =
    typeof config.timezone === "string" && config.timezone.length > 0
      ? config.timezone
      : null;

  if (!timezone) {
    const { data: biz } = await supabase
      .from("business_info")
      .select("structured")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const tz = (biz?.structured as { timezone?: string } | null)?.timezone;
    if (typeof tz === "string" && tz.length > 0) timezone = tz;
  }

  return { apiKey, baseUrl, defaultEventTypeId, timezone, eventTypes };
}

/** Resolves an event-type name (or none) to a numeric id, or null. */
export function resolveEventTypeId(
  cfg: CalComConfig,
  name?: string | null,
): number | null {
  if (name && cfg.eventTypes[name] != null) return cfg.eventTypes[name];
  return cfg.defaultEventTypeId;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/features/inbox/services/calcom-client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/inbox/services/calcom-client.ts src/features/inbox/services/calcom-client.test.ts
git commit -m "feat(calcom): config loader for the caldotcom integration"
```

---

## Task 3: `calcom-client.ts` — `getSlots`

**Files:**

- Modify: `src/features/inbox/services/calcom-client.ts`
- Modify: `src/features/inbox/services/calcom-client.test.ts`

Cal.com `GET /v2/slots?eventTypeId=&start=&end=&timeZone=` with header `cal-api-version: 2024-09-04`. Response: `{ status, data: { "2050-09-05": [{ start: "..." }, ...], ... } }`. Collect every `.start`, cap at 20.

- [ ] **Step 1: Add the failing test**

Append to `calcom-client.test.ts`:

```ts
import { getSlots } from "./calcom-client";

describe("getSlots", () => {
  const cfg = {
    apiKey: "cal_live_x",
    baseUrl: "https://api.cal.com",
    defaultEventTypeId: 123,
    timezone: "America/Mexico_City",
    eventTypes: {},
  };

  it("sends the right url + version header and flattens slots", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: "success",
        data: {
          "2050-09-05": [
            { start: "2050-09-05T09:00:00-06:00" },
            { start: "2050-09-05T10:00:00-06:00" },
          ],
          "2050-09-06": [{ start: "2050-09-06T09:00:00-06:00" }],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const slots = await getSlots(cfg, {
      eventTypeId: 123,
      startISO: "2050-09-05T00:00:00Z",
      endISO: "2050-09-07T00:00:00Z",
      timeZone: "America/Mexico_City",
    });

    expect(slots).toEqual([
      "2050-09-05T09:00:00-06:00",
      "2050-09-05T10:00:00-06:00",
      "2050-09-06T09:00:00-06:00",
    ]);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("https://api.cal.com/v2/slots?");
    expect(url).toContain("eventTypeId=123");
    expect(url).toContain("timeZone=America%2FMexico_City");
    expect((opts.headers as Record<string, string>)["cal-api-version"]).toBe(
      "2024-09-04",
    );
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      "Bearer cal_live_x",
    );
  });

  it("returns null on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })),
    );
    const slots = await getSlots(cfg, {
      eventTypeId: 1,
      startISO: "a",
      endISO: "b",
      timeZone: "UTC",
    });
    expect(slots).toBeNull();
  });

  it("caps at 20 slots", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      start: `2050-09-05T${String(i).padStart(2, "0")}:00:00Z`,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", data: { "2050-09-05": many } }),
      })),
    );
    const slots = await getSlots(cfg, {
      eventTypeId: 1,
      startISO: "a",
      endISO: "b",
      timeZone: "UTC",
    });
    expect(slots).toHaveLength(20);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/features/inbox/services/calcom-client.test.ts`
Expected: FAIL — `getSlots` not exported.

- [ ] **Step 3: Implement `getSlots`**

Append to `calcom-client.ts`:

```ts
function headers(cfg: CalComConfig, version: string): HeadersInit {
  return {
    Authorization: `Bearer ${cfg.apiKey}`,
    "cal-api-version": version,
    "Content-Type": "application/json",
  };
}

interface SlotsResponse {
  data?: Record<string, unknown>;
}

export async function getSlots(
  cfg: CalComConfig,
  args: {
    eventTypeId: number;
    startISO: string;
    endISO: string;
    timeZone: string;
  },
): Promise<string[] | null> {
  const params = new URLSearchParams({
    eventTypeId: String(args.eventTypeId),
    start: args.startISO,
    end: args.endISO,
    timeZone: args.timeZone,
  });

  try {
    const res = await fetch(`${cfg.baseUrl}/v2/slots?${params.toString()}`, {
      method: "GET",
      headers: headers(cfg, CAL_VERSION_SLOTS),
    });
    if (!res.ok) {
      console.error(
        "[calcom] getSlots failed:",
        res.status,
        (await res.text()).slice(0, 200),
      );
      return null;
    }
    const json = (await res.json()) as SlotsResponse;
    const out: string[] = [];
    for (const value of Object.values(json.data ?? {})) {
      if (Array.isArray(value)) {
        for (const slot of value) {
          const start = (slot as { start?: string }).start;
          if (typeof start === "string") out.push(start);
        }
      }
    }
    return out.slice(0, 20);
  } catch (err) {
    console.error("[calcom] getSlots error:", err);
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/features/inbox/services/calcom-client.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/features/inbox/services/calcom-client.ts src/features/inbox/services/calcom-client.test.ts
git commit -m "feat(calcom): getSlots — free slot lookup"
```

---

## Task 4: `calcom-client.ts` — `createBooking`

**Files:**

- Modify: `src/features/inbox/services/calcom-client.ts`
- Modify: `src/features/inbox/services/calcom-client.test.ts`

`POST /v2/bookings` with header `cal-api-version: 2024-08-13`. Body: `{ eventTypeId, start, attendee: { name, email, timeZone, language }, metadata }`. Response: `{ status, data: { uid, start, end, status } }`.

- [ ] **Step 1: Add the failing test**

Append to `calcom-client.test.ts`:

```ts
import { createBooking } from "./calcom-client";

describe("createBooking", () => {
  const cfg = {
    apiKey: "cal_live_x",
    baseUrl: "https://api.cal.com",
    defaultEventTypeId: 123,
    timezone: "America/Mexico_City",
    eventTypes: {},
  };

  it("posts the v2 attendee shape and returns the normalized booking", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: "success",
        data: {
          uid: "bk_123",
          start: "2050-09-05T15:00:00Z",
          end: "2050-09-05T16:00:00Z",
          status: "accepted",
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const booking = await createBooking(cfg, {
      eventTypeId: 123,
      startISO: "2050-09-05T15:00:00Z",
      attendee: { name: "Ana", email: "ana@example.com" },
      timeZone: "America/Mexico_City",
    });

    expect(booking).toEqual({
      uid: "bk_123",
      start: "2050-09-05T15:00:00Z",
      end: "2050-09-05T16:00:00Z",
      status: "accepted",
    });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.cal.com/v2/bookings");
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["cal-api-version"]).toBe(
      "2024-08-13",
    );
    expect(JSON.parse(opts.body as string)).toEqual({
      eventTypeId: 123,
      start: "2050-09-05T15:00:00Z",
      attendee: {
        name: "Ana",
        email: "ana@example.com",
        timeZone: "America/Mexico_City",
        language: "es",
      },
      metadata: {},
    });
  });

  it("returns null on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        text: async () => "no availability",
      })),
    );
    const booking = await createBooking(cfg, {
      eventTypeId: 1,
      startISO: "x",
      attendee: { name: "A", email: "a@a.com" },
      timeZone: "UTC",
    });
    expect(booking).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/features/inbox/services/calcom-client.test.ts`
Expected: FAIL — `createBooking` not exported.

- [ ] **Step 3: Implement `createBooking`**

Append to `calcom-client.ts`:

```ts
export interface CalBooking {
  uid: string;
  start: string;
  end: string | null;
  status: string;
}

interface BookingResponse {
  data?: {
    uid?: string;
    start?: string;
    end?: string;
    status?: string;
  };
}

function normalizeBooking(json: BookingResponse): CalBooking | null {
  const d = json.data;
  if (!d?.uid || !d.start) return null;
  return {
    uid: d.uid,
    start: d.start,
    end: d.end ?? null,
    status: d.status ?? "accepted",
  };
}

export async function createBooking(
  cfg: CalComConfig,
  args: {
    eventTypeId: number;
    startISO: string;
    attendee: { name: string; email: string };
    timeZone: string;
  },
): Promise<CalBooking | null> {
  const body = {
    eventTypeId: args.eventTypeId,
    start: args.startISO,
    attendee: {
      name: args.attendee.name,
      email: args.attendee.email,
      timeZone: args.timeZone,
      language: "es",
    },
    metadata: {},
  };

  try {
    const res = await fetch(`${cfg.baseUrl}/v2/bookings`, {
      method: "POST",
      headers: headers(cfg, CAL_VERSION_BOOKINGS),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(
        "[calcom] createBooking failed:",
        res.status,
        (await res.text()).slice(0, 200),
      );
      return null;
    }
    return normalizeBooking((await res.json()) as BookingResponse);
  } catch (err) {
    console.error("[calcom] createBooking error:", err);
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/features/inbox/services/calcom-client.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/features/inbox/services/calcom-client.ts src/features/inbox/services/calcom-client.test.ts
git commit -m "feat(calcom): createBooking"
```

---

## Task 5: `calcom-client.ts` — `rescheduleBooking` + `cancelBooking`

**Files:**

- Modify: `src/features/inbox/services/calcom-client.ts`
- Modify: `src/features/inbox/services/calcom-client.test.ts`

`POST /v2/bookings/{uid}/reschedule` body `{ start, reschedulingReason }` → returns booking data (may carry a **new** uid). `POST /v2/bookings/{uid}/cancel` body `{ cancellationReason }` → returns `{ status: "success" }`.

- [ ] **Step 1: Add the failing test**

Append to `calcom-client.test.ts`:

```ts
import { rescheduleBooking, cancelBooking } from "./calcom-client";

const baseCfg = {
  apiKey: "cal_live_x",
  baseUrl: "https://api.cal.com",
  defaultEventTypeId: 1,
  timezone: "UTC",
  eventTypes: {},
};

describe("rescheduleBooking", () => {
  it("posts the new start + reason and returns the (possibly new) booking", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: "success",
        data: {
          uid: "bk_new",
          start: "2050-09-10T10:00:00Z",
          end: "2050-09-10T11:00:00Z",
          status: "accepted",
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const b = await rescheduleBooking(baseCfg, "bk_old", {
      startISO: "2050-09-10T10:00:00Z",
      reason: "cliente pidió cambio",
    });
    expect(b?.uid).toBe("bk_new");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.cal.com/v2/bookings/bk_old/reschedule");
    expect(JSON.parse(opts.body as string)).toEqual({
      start: "2050-09-10T10:00:00Z",
      reschedulingReason: "cliente pidió cambio",
    });
  });

  it("returns null on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, text: async () => "nope" })),
    );
    expect(await rescheduleBooking(baseCfg, "x", { startISO: "a" })).toBeNull();
  });
});

describe("cancelBooking", () => {
  it("posts the cancellation reason and returns true on success", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", data: {} }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await cancelBooking(baseCfg, "bk_1", { reason: "ya no puede" });
    expect(ok).toBe(true);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.cal.com/v2/bookings/bk_1/cancel");
    expect(JSON.parse(opts.body as string)).toEqual({
      cancellationReason: "ya no puede",
    });
  });

  it("returns false on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })),
    );
    expect(await cancelBooking(baseCfg, "x", {})).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/features/inbox/services/calcom-client.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement both**

Append to `calcom-client.ts`:

```ts
export async function rescheduleBooking(
  cfg: CalComConfig,
  uid: string,
  args: { startISO: string; reason?: string },
): Promise<CalBooking | null> {
  const body: Record<string, unknown> = { start: args.startISO };
  if (args.reason) body.reschedulingReason = args.reason;

  try {
    const res = await fetch(
      `${cfg.baseUrl}/v2/bookings/${encodeURIComponent(uid)}/reschedule`,
      {
        method: "POST",
        headers: headers(cfg, CAL_VERSION_BOOKINGS),
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      console.error(
        "[calcom] rescheduleBooking failed:",
        res.status,
        (await res.text()).slice(0, 200),
      );
      return null;
    }
    return normalizeBooking((await res.json()) as BookingResponse);
  } catch (err) {
    console.error("[calcom] rescheduleBooking error:", err);
    return null;
  }
}

export async function cancelBooking(
  cfg: CalComConfig,
  uid: string,
  args: { reason?: string },
): Promise<boolean> {
  const body: Record<string, unknown> = {};
  if (args.reason) body.cancellationReason = args.reason;

  try {
    const res = await fetch(
      `${cfg.baseUrl}/v2/bookings/${encodeURIComponent(uid)}/cancel`,
      {
        method: "POST",
        headers: headers(cfg, CAL_VERSION_BOOKINGS),
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      console.error(
        "[calcom] cancelBooking failed:",
        res.status,
        (await res.text()).slice(0, 200),
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[calcom] cancelBooking error:", err);
    return false;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/features/inbox/services/calcom-client.test.ts`
Expected: PASS (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/features/inbox/services/calcom-client.ts src/features/inbox/services/calcom-client.test.ts
git commit -m "feat(calcom): reschedule + cancel"
```

---

## Task 6: Database migration — `appointments` + tool seed

**Files:**

- Create: `supabase/migrations/20260828000000_calcom_and_appointments.sql`

Mirrors the RLS helpers used by `contacts` (`auth_workspace_ids()`, `auth_has_role(...)`) and the tool-seed pattern from `20260617000001_seed_check_availability_tool.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- Migration: 20260828000000_calcom_and_appointments
-- Cal.com integration: local appointments table + tool catalog seed.
-- Additive only. Does not touch HighLevel, YCloud, or existing tools.
-- ============================================================

-- ---- appointments: local source of truth for bookings made via the agent ----
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'caldotcom',
  external_uid TEXT NOT NULL,
  event_type_id TEXT,
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted', 'cancelled')),
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

CREATE INDEX IF NOT EXISTS idx_appointments_contact_upcoming
  ON appointments (workspace_id, contact_id, status, start_at);

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON appointments;
CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ws members read appointments" ON appointments;
CREATE POLICY "ws members read appointments"
  ON appointments FOR SELECT
  USING (workspace_id IN (SELECT auth_workspace_ids()));

DROP POLICY IF EXISTS "ws operators write appointments" ON appointments;
CREATE POLICY "ws operators write appointments"
  ON appointments FOR ALL
  USING (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[])
  )
  WITH CHECK (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[])
  );

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
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`
Expected: `Applying migration 20260828000000_calcom_and_appointments.sql...` then `Finished supabase db push.`

(If working against a local stack instead: `supabase migration up`.)

- [ ] **Step 3: Verify the table and seed**

Run:

```bash
supabase db execute "select count(*) from public.tools where key like 'calcom_%';"
```

Expected: `4`.

Run:

```bash
supabase db execute "\d appointments"
```

Expected: table exists with the `status` CHECK and the unique constraint.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260828000000_calcom_and_appointments.sql
git commit -m "feat(calcom): appointments table + tool catalog seed"
```

---

## Task 7: `appointments-repo.ts`

**Files:**

- Create: `src/features/inbox/services/appointments-repo.ts`
- Test: `src/features/inbox/services/appointments-repo.test.ts`

Three functions used by the tools: `insertAppointment`, `findUpcomingAppointments`, `updateAppointmentByUid`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock } from "@/test/supabase-mock";

const sb = makeSupabaseMock();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => sb.client }));

import {
  insertAppointment,
  findUpcomingAppointments,
  updateAppointmentByUid,
} from "./appointments-repo";

beforeEach(() => {
  sb.table("appointments").result = { data: null, error: null };
  sb.table("appointments").writes.length = 0;
  sb.table("appointments").filters.length = 0;
});

describe("insertAppointment", () => {
  it("inserts a normalized row and returns its id", async () => {
    sb.table("appointments").result = { data: { id: "ap1" }, error: null };
    const id = await insertAppointment({
      workspaceId: "ws1",
      contactId: "c1",
      conversationId: "cv1",
      externalUid: "bk_1",
      eventTypeId: "123",
      startAt: "2050-09-05T15:00:00Z",
      endAt: "2050-09-05T16:00:00Z",
      attendeeEmail: "ana@example.com",
      attendeeName: "Ana",
    });
    expect(id).toBe("ap1");
    expect(sb.table("appointments").writes[0]).toEqual({
      op: "insert",
      payload: {
        workspace_id: "ws1",
        contact_id: "c1",
        conversation_id: "cv1",
        provider: "caldotcom",
        external_uid: "bk_1",
        event_type_id: "123",
        status: "accepted",
        start_at: "2050-09-05T15:00:00Z",
        end_at: "2050-09-05T16:00:00Z",
        attendee_email: "ana@example.com",
        attendee_name: "Ana",
      },
    });
  });

  it("returns null when the insert errors", async () => {
    sb.table("appointments").result = { data: null, error: { message: "x" } };
    const id = await insertAppointment({
      workspaceId: "ws1",
      contactId: null,
      conversationId: null,
      externalUid: "bk_1",
      eventTypeId: null,
      startAt: "2050-09-05T15:00:00Z",
      endAt: null,
      attendeeEmail: null,
      attendeeName: null,
    });
    expect(id).toBeNull();
  });
});

describe("findUpcomingAppointments", () => {
  it("filters by workspace, contact, accepted status and returns rows", async () => {
    sb.table("appointments").result = {
      data: [
        { id: "ap1", external_uid: "bk_1", start_at: "2050-09-05T15:00:00Z" },
      ],
      error: null,
    };
    const rows = await findUpcomingAppointments("ws1", "c1");
    expect(rows).toHaveLength(1);
    const f = sb.table("appointments").filters;
    expect(f).toContainEqual({ col: "workspace_id", val: "ws1" });
    expect(f).toContainEqual({ col: "contact_id", val: "c1" });
    expect(f).toContainEqual({ col: "status", val: "accepted" });
  });

  it("returns [] when contactId is null", async () => {
    const rows = await findUpcomingAppointments("ws1", null);
    expect(rows).toEqual([]);
  });
});

describe("updateAppointmentByUid", () => {
  it("updates the matching row by workspace + external_uid", async () => {
    sb.table("appointments").result = { data: null, error: null };
    await updateAppointmentByUid("ws1", "bk_1", {
      status: "cancelled",
      cancel_reason: "ya no puede",
    });
    expect(sb.table("appointments").writes[0]).toEqual({
      op: "update",
      payload: { status: "cancelled", cancel_reason: "ya no puede" },
    });
    const f = sb.table("appointments").filters;
    expect(f).toContainEqual({ col: "workspace_id", val: "ws1" });
    expect(f).toContainEqual({ col: "external_uid", val: "bk_1" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/features/inbox/services/appointments-repo.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the repo**

```ts
// src/features/inbox/services/appointments-repo.ts
import { createClient as createSbClient } from "@supabase/supabase-js";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface AppointmentRow {
  id: string;
  external_uid: string;
  event_type_id: string | null;
  status: "accepted" | "cancelled";
  start_at: string;
  end_at: string | null;
  attendee_email: string | null;
  attendee_name: string | null;
}

export async function insertAppointment(input: {
  workspaceId: string;
  contactId: string | null;
  conversationId: string | null;
  externalUid: string;
  eventTypeId: string | null;
  startAt: string;
  endAt: string | null;
  attendeeEmail: string | null;
  attendeeName: string | null;
}): Promise<string | null> {
  const supabase = svc();
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      workspace_id: input.workspaceId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      provider: "caldotcom",
      external_uid: input.externalUid,
      event_type_id: input.eventTypeId,
      status: "accepted",
      start_at: input.startAt,
      end_at: input.endAt,
      attendee_email: input.attendeeEmail,
      attendee_name: input.attendeeName,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[appointments] insert error:", error?.message);
    return null;
  }
  return (data as { id: string }).id;
}

export async function findUpcomingAppointments(
  workspaceId: string,
  contactId: string | null,
): Promise<AppointmentRow[]> {
  if (!contactId) return [];
  const supabase = svc();
  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, external_uid, event_type_id, status, start_at, end_at, attendee_email, attendee_name",
    )
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("status", "accepted")
    .gt("start_at", new Date().toISOString())
    .order("start_at");

  if (error || !data) {
    console.error("[appointments] find error:", error?.message);
    return [];
  }
  return data as AppointmentRow[];
}

export async function updateAppointmentByUid(
  workspaceId: string,
  externalUid: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const supabase = svc();
  const { error } = await supabase
    .from("appointments")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("external_uid", externalUid);
  if (error) console.error("[appointments] update error:", error.message);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/features/inbox/services/appointments-repo.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/inbox/services/appointments-repo.ts src/features/inbox/services/appointments-repo.test.ts
git commit -m "feat(calcom): appointments repository helper"
```

---

## Task 8: `calcom_check_availability` tool

**Files:**

- Create: `src/features/tools/tools/calcom-check-availability.ts`
- Test: `src/features/tools/tools/calcom-check-availability.test.ts`

Follows the shape of `check-availability.ts`: `sensitivity: "read"`, `enabledFor: () => true`, dynamic `import()` of the client inside `run`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";

const getCalComConfig = vi.fn();
const getSlots = vi.fn();
const resolveEventTypeId = vi.fn();
vi.mock("../../inbox/services/calcom-client", () => ({
  getCalComConfig,
  getSlots,
  resolveEventTypeId,
}));

import { calcomCheckAvailabilityTool } from "./calcom-check-availability";

const ctx = { workspaceId: "ws1", conversationId: "cv1", contactId: "c1" };

describe("calcom_check_availability", () => {
  it("errors clearly when Cal.com is not connected", async () => {
    getCalComConfig.mockResolvedValue(null);
    const res = await calcomCheckAvailabilityTool.run(
      { date_from: "2050-09-05", date_to: "2050-09-07" },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no está conectado/i);
  });

  it("errors when no event type resolves", async () => {
    getCalComConfig.mockResolvedValue({
      apiKey: "k",
      baseUrl: "b",
      defaultEventTypeId: null,
      timezone: "America/Mexico_City",
      eventTypes: {},
    });
    resolveEventTypeId.mockReturnValue(null);
    const res = await calcomCheckAvailabilityTool.run(
      { date_from: "2050-09-05", date_to: "2050-09-07" },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/event type|tipo de cita/i);
  });

  it("returns slots on success and passes an end-of-day end bound", async () => {
    getCalComConfig.mockResolvedValue({
      apiKey: "k",
      baseUrl: "https://api.cal.com",
      defaultEventTypeId: 123,
      timezone: "America/Mexico_City",
      eventTypes: {},
    });
    resolveEventTypeId.mockReturnValue(123);
    getSlots.mockResolvedValue([
      "2050-09-05T09:00:00-06:00",
      "2050-09-05T10:00:00-06:00",
    ]);

    const res = await calcomCheckAvailabilityTool.run(
      { date_from: "2050-09-05", date_to: "2050-09-05" },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.output).toMatchObject({ count: 2 });
    const callArgs = getSlots.mock.calls[0][1];
    expect(callArgs.eventTypeId).toBe(123);
    expect(callArgs.timeZone).toBe("America/Mexico_City");
    // date_to expanded to end of day
    expect(Date.parse(callArgs.endISO)).toBeGreaterThan(
      Date.parse("2050-09-05T00:00:00Z"),
    );
  });

  it("returns ok with a no-slots message when the calendar is empty", async () => {
    getCalComConfig.mockResolvedValue({
      apiKey: "k",
      baseUrl: "b",
      defaultEventTypeId: 1,
      timezone: "UTC",
      eventTypes: {},
    });
    resolveEventTypeId.mockReturnValue(1);
    getSlots.mockResolvedValue([]);
    const res = await calcomCheckAvailabilityTool.run(
      { date_from: "2050-09-05", date_to: "2050-09-07" },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.output).toMatchObject({ count: 0 });
  });

  it("returns an error when getSlots returns null (API failure)", async () => {
    getCalComConfig.mockResolvedValue({
      apiKey: "k",
      baseUrl: "b",
      defaultEventTypeId: 1,
      timezone: "UTC",
      eventTypes: {},
    });
    resolveEventTypeId.mockReturnValue(1);
    getSlots.mockResolvedValue(null);
    const res = await calcomCheckAvailabilityTool.run(
      { date_from: "2050-09-05", date_to: "2050-09-07" },
      ctx,
    );
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/features/tools/tools/calcom-check-availability.test.ts`
Expected: FAIL — tool not exported.

- [ ] **Step 3: Implement the tool**

```ts
// src/features/tools/tools/calcom-check-availability.ts
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  date_from: z
    .string()
    .describe("Fecha inicial del rango a consultar (ISO, ej: 2026-06-12)"),
  date_to: z.string().describe("Fecha final del rango (ISO, ej: 2026-06-19)"),
  timezone: z
    .string()
    .optional()
    .describe("Zona horaria IANA, ej: America/Mexico_City"),
  event_type: z
    .string()
    .optional()
    .describe(
      "Nombre del tipo de cita configurado (ej: 'consulta'); si se omite usa el tipo por defecto del workspace",
    ),
});

type Args = z.infer<typeof schema>;

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const { getCalComConfig, getSlots, resolveEventTypeId } =
    await import("../../inbox/services/calcom-client");

  const cfg = await getCalComConfig(ctx.workspaceId);
  if (!cfg) {
    return {
      ok: false,
      output: null,
      error: "Cal.com no está conectado para este workspace",
    };
  }

  const eventTypeId = resolveEventTypeId(cfg, args.event_type);
  if (eventTypeId == null) {
    return {
      ok: false,
      output: null,
      error:
        "No hay un tipo de cita (event type) configurado para Cal.com en este workspace",
    };
  }

  const startMs = Date.parse(args.date_from);
  let endMs = Date.parse(args.date_to);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return { ok: false, output: null, error: "Fechas inválidas" };
  }
  // Make date_to inclusive through end of day (mirrors check-availability.ts).
  endMs = Math.max(endMs + 24 * 60 * 60 * 1000 - 1, startMs);

  const timeZone = args.timezone ?? cfg.timezone ?? "UTC";

  const slots = await getSlots(cfg, {
    eventTypeId,
    startISO: new Date(startMs).toISOString(),
    endISO: new Date(endMs).toISOString(),
    timeZone,
  });

  if (slots === null) {
    return {
      ok: false,
      output: null,
      error: "No se pudo consultar la disponibilidad en Cal.com",
    };
  }

  return {
    ok: true,
    output: {
      slots,
      count: slots.length,
      message:
        slots.length === 0
          ? "No hay horarios disponibles en ese rango."
          : `Hay ${slots.length} horarios disponibles.`,
    },
  };
}

export const calcomCheckAvailabilityTool: Tool<Args> = {
  name: "calcom_check_availability",
  description:
    "Consulta los horarios libres reales de Cal.com en un rango de fechas. Úsalo ANTES de agendar para ofrecer horarios que sí existen.",
  sensitivity: "read",
  schema,
  enabledFor: () => true,
  run,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/features/tools/tools/calcom-check-availability.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tools/tools/calcom-check-availability.ts src/features/tools/tools/calcom-check-availability.test.ts
git commit -m "feat(calcom): calcom_check_availability tool"
```

---

## Task 9: `calcom_book` tool

**Files:**

- Create: `src/features/tools/tools/calcom-book.ts`
- Test: `src/features/tools/tools/calcom-book.test.ts`

Resolves the contact like `schedule-highlevel.ts`: prefer `args.attendee_*`, else read `contacts` by `ctx.contactId`. After a successful booking: `insertAppointment`, and set `contacts.email` if empty.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock } from "@/test/supabase-mock";

const sb = makeSupabaseMock();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => sb.client }));

const getCalComConfig = vi.fn();
const createBooking = vi.fn();
const resolveEventTypeId = vi.fn();
vi.mock("../../inbox/services/calcom-client", () => ({
  getCalComConfig,
  createBooking,
  resolveEventTypeId,
}));

const insertAppointment = vi.fn();
vi.mock("../../inbox/services/appointments-repo", () => ({
  insertAppointment,
}));

import { calcomBookTool } from "./calcom-book";

const ctx = { workspaceId: "ws1", conversationId: "cv1", contactId: "c1" };

beforeEach(() => {
  sb.table("contacts").result = {
    data: { id: "c1", phone: "+521", name: "Ana", email: null },
    error: null,
  };
  sb.table("contacts").writes.length = 0;
  getCalComConfig.mockResolvedValue({
    apiKey: "k",
    baseUrl: "b",
    defaultEventTypeId: 123,
    timezone: "America/Mexico_City",
    eventTypes: {},
  });
  resolveEventTypeId.mockReturnValue(123);
  insertAppointment.mockResolvedValue("ap1");
});

describe("calcom_book", () => {
  it("rejects an invalid email before calling Cal.com", async () => {
    const res = await calcomBookTool.run(
      { datetime_iso: "2050-09-05T15:00:00Z", attendee_email: "not-an-email" },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/email/i);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("books, persists the appointment, and backfills the contact email", async () => {
    createBooking.mockResolvedValue({
      uid: "bk_1",
      start: "2050-09-05T15:00:00Z",
      end: "2050-09-05T16:00:00Z",
      status: "accepted",
    });

    const res = await calcomBookTool.run(
      {
        datetime_iso: "2050-09-05T15:00:00Z",
        attendee_email: "ana@example.com",
        attendee_name: "Ana",
      },
      ctx,
    );

    expect(res.ok).toBe(true);
    expect(res.output).toMatchObject({ uid: "bk_1", appointment_id: "ap1" });
    expect(insertAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws1",
        contactId: "c1",
        conversationId: "cv1",
        externalUid: "bk_1",
        attendeeEmail: "ana@example.com",
      }),
    );
    // contact email backfilled because it was null
    expect(sb.table("contacts").writes[0]).toMatchObject({
      op: "update",
      payload: { email: "ana@example.com" },
    });
  });

  it("does not overwrite an existing contact email", async () => {
    sb.table("contacts").result = {
      data: { id: "c1", phone: "+521", name: "Ana", email: "old@example.com" },
      error: null,
    };
    createBooking.mockResolvedValue({
      uid: "bk_1",
      start: "2050-09-05T15:00:00Z",
      end: null,
      status: "accepted",
    });
    await calcomBookTool.run(
      {
        datetime_iso: "2050-09-05T15:00:00Z",
        attendee_email: "new@example.com",
      },
      ctx,
    );
    expect(sb.table("contacts").writes).toHaveLength(0);
  });

  it("returns an error when Cal.com booking fails", async () => {
    createBooking.mockResolvedValue(null);
    const res = await calcomBookTool.run(
      {
        datetime_iso: "2050-09-05T15:00:00Z",
        attendee_email: "ana@example.com",
      },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(insertAppointment).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/features/tools/tools/calcom-book.test.ts`
Expected: FAIL — tool not exported.

- [ ] **Step 3: Implement the tool**

```ts
// src/features/tools/tools/calcom-book.ts
import { createClient as createSbClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const schema = z.object({
  datetime_iso: z
    .string()
    .describe(
      "Inicio de la cita en ISO 8601 con offset, ej: 2026-06-12T10:00:00-06:00",
    ),
  attendee_email: z
    .string()
    .describe("Email del cliente para la confirmación de Cal.com"),
  attendee_name: z.string().optional().describe("Nombre del cliente"),
  event_type: z
    .string()
    .optional()
    .describe(
      "Nombre del tipo de cita configurado; si se omite usa el por defecto",
    ),
  timezone: z.string().optional().describe("Zona horaria IANA"),
});

type Args = z.infer<typeof schema>;

interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
}

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  if (!EMAIL_RE.test(args.attendee_email)) {
    return {
      ok: false,
      output: null,
      error: "Falta un email válido del cliente para agendar en Cal.com",
    };
  }

  const { getCalComConfig, createBooking, resolveEventTypeId } =
    await import("../../inbox/services/calcom-client");
  const { insertAppointment } =
    await import("../../inbox/services/appointments-repo");

  const cfg = await getCalComConfig(ctx.workspaceId);
  if (!cfg) {
    return {
      ok: false,
      output: null,
      error: "Cal.com no está conectado para este workspace",
    };
  }

  const eventTypeId = resolveEventTypeId(cfg, args.event_type);
  if (eventTypeId == null) {
    return {
      ok: false,
      output: null,
      error: "No hay un tipo de cita (event type) configurado para Cal.com",
    };
  }

  const supabase = svc();
  let contact: ContactRow | null = null;
  if (ctx.contactId) {
    const { data } = await supabase
      .from("contacts")
      .select("id, phone, name, email")
      .eq("id", ctx.contactId)
      .single();
    contact = (data as ContactRow | null) ?? null;
  }

  const name = args.attendee_name ?? contact?.name ?? "Cliente";
  const timeZone = args.timezone ?? cfg.timezone ?? "UTC";

  const booking = await createBooking(cfg, {
    eventTypeId,
    startISO: args.datetime_iso,
    attendee: { name, email: args.attendee_email },
    timeZone,
  });

  if (!booking) {
    return {
      ok: false,
      output: null,
      error:
        "No se pudo agendar en Cal.com (horario no disponible o error de API)",
    };
  }

  const appointmentId = await insertAppointment({
    workspaceId: ctx.workspaceId,
    contactId: contact?.id ?? null,
    conversationId: ctx.conversationId || null,
    externalUid: booking.uid,
    eventTypeId: String(eventTypeId),
    startAt: booking.start,
    endAt: booking.end,
    attendeeEmail: args.attendee_email,
    attendeeName: name,
  });

  // Backfill the contact email only when empty.
  if (contact && !contact.email) {
    await supabase
      .from("contacts")
      .update({ email: args.attendee_email })
      .eq("id", contact.id);
  }

  return {
    ok: true,
    output: {
      appointment_id: appointmentId,
      uid: booking.uid,
      datetime: booking.start,
      message: `Cita agendada para ${booking.start}.`,
    },
  };
}

export const calcomBookTool: Tool<Args> = {
  name: "calcom_book",
  description:
    "Reserva una cita en Cal.com. Requiere el email del cliente. Llama primero a calcom_check_availability y confirma fecha y hora con el cliente antes de usar esta herramienta.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/features/tools/tools/calcom-book.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tools/tools/calcom-book.ts src/features/tools/tools/calcom-book.test.ts
git commit -m "feat(calcom): calcom_book tool"
```

---

## Task 10: `calcom_reschedule` tool

**Files:**

- Create: `src/features/tools/tools/calcom-reschedule.ts`
- Test: `src/features/tools/tools/calcom-reschedule.test.ts`

"Which appointment": if `appointment_uid` given, use it; else `findUpcomingAppointments(ws, contactId)` — 0 → error, 1 → use it, >1 → return the list so the agent asks.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getCalComConfig = vi.fn();
const rescheduleBooking = vi.fn();
vi.mock("../../inbox/services/calcom-client", () => ({
  getCalComConfig,
  rescheduleBooking,
}));

const findUpcomingAppointments = vi.fn();
const updateAppointmentByUid = vi.fn();
vi.mock("../../inbox/services/appointments-repo", () => ({
  findUpcomingAppointments,
  updateAppointmentByUid,
}));

import { calcomRescheduleTool } from "./calcom-reschedule";

const ctx = { workspaceId: "ws1", conversationId: "cv1", contactId: "c1" };

beforeEach(() => {
  getCalComConfig.mockResolvedValue({
    apiKey: "k",
    baseUrl: "b",
    defaultEventTypeId: 1,
    timezone: "UTC",
    eventTypes: {},
  });
});

describe("calcom_reschedule", () => {
  it("errors when the contact has no upcoming appointment", async () => {
    findUpcomingAppointments.mockResolvedValue([]);
    const res = await calcomRescheduleTool.run(
      { new_datetime_iso: "2050-09-10T10:00:00Z" },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no encuentro una cita/i);
  });

  it("asks which one when there is more than one upcoming appointment", async () => {
    findUpcomingAppointments.mockResolvedValue([
      { external_uid: "bk_1", start_at: "2050-09-06T10:00:00Z" },
      { external_uid: "bk_2", start_at: "2050-09-08T10:00:00Z" },
    ]);
    const res = await calcomRescheduleTool.run(
      { new_datetime_iso: "2050-09-10T10:00:00Z" },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.output).toMatchObject({ needs_disambiguation: true });
    expect(rescheduleBooking).not.toHaveBeenCalled();
  });

  it("reschedules the single upcoming appointment and updates the row", async () => {
    findUpcomingAppointments.mockResolvedValue([
      { external_uid: "bk_1", start_at: "2050-09-06T10:00:00Z" },
    ]);
    rescheduleBooking.mockResolvedValue({
      uid: "bk_1",
      start: "2050-09-10T10:00:00Z",
      end: "2050-09-10T11:00:00Z",
      status: "accepted",
    });

    const res = await calcomRescheduleTool.run(
      { new_datetime_iso: "2050-09-10T10:00:00Z", reason: "conflicto" },
      ctx,
    );

    expect(res.ok).toBe(true);
    expect(rescheduleBooking).toHaveBeenCalledWith(expect.anything(), "bk_1", {
      startISO: "2050-09-10T10:00:00Z",
      reason: "conflicto",
    });
    expect(updateAppointmentByUid).toHaveBeenCalledWith(
      "ws1",
      "bk_1",
      expect.objectContaining({
        start_at: "2050-09-10T10:00:00Z",
        reschedule_reason: "conflicto",
      }),
    );
  });

  it("uses an explicit appointment_uid without looking up", async () => {
    rescheduleBooking.mockResolvedValue({
      uid: "bk_9",
      start: "2050-09-11T10:00:00Z",
      end: null,
      status: "accepted",
    });
    const res = await calcomRescheduleTool.run(
      { new_datetime_iso: "2050-09-11T10:00:00Z", appointment_uid: "bk_9" },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(findUpcomingAppointments).not.toHaveBeenCalled();
  });

  it("returns an error when the Cal.com reschedule fails", async () => {
    findUpcomingAppointments.mockResolvedValue([
      { external_uid: "bk_1", start_at: "2050-09-06T10:00:00Z" },
    ]);
    rescheduleBooking.mockResolvedValue(null);
    const res = await calcomRescheduleTool.run(
      { new_datetime_iso: "2050-09-10T10:00:00Z" },
      ctx,
    );
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/features/tools/tools/calcom-reschedule.test.ts`
Expected: FAIL — tool not exported.

- [ ] **Step 3: Implement the tool**

```ts
// src/features/tools/tools/calcom-reschedule.ts
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  new_datetime_iso: z
    .string()
    .describe("Nuevo inicio de la cita en ISO 8601 con offset"),
  appointment_uid: z
    .string()
    .optional()
    .describe(
      "UID de la cita de Cal.com; si se omite se usa la próxima cita del contacto",
    ),
  reason: z.string().optional().describe("Motivo del cambio"),
});

type Args = z.infer<typeof schema>;

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const { getCalComConfig, rescheduleBooking } =
    await import("../../inbox/services/calcom-client");
  const { findUpcomingAppointments, updateAppointmentByUid } =
    await import("../../inbox/services/appointments-repo");

  const cfg = await getCalComConfig(ctx.workspaceId);
  if (!cfg) {
    return {
      ok: false,
      output: null,
      error: "Cal.com no está conectado para este workspace",
    };
  }

  let uid = args.appointment_uid ?? null;
  if (!uid) {
    const upcoming = await findUpcomingAppointments(
      ctx.workspaceId,
      ctx.contactId || null,
    );
    if (upcoming.length === 0) {
      return {
        ok: false,
        output: null,
        error: "No encuentro una cita próxima a tu nombre para reprogramar",
      };
    }
    if (upcoming.length > 1) {
      return {
        ok: false,
        output: {
          needs_disambiguation: true,
          appointments: upcoming.map((a) => ({
            uid: a.external_uid,
            start: a.start_at,
          })),
        },
        error:
          "Hay más de una cita próxima; pregunta al cliente cuál quiere reprogramar",
      };
    }
    uid = upcoming[0].external_uid;
  }

  const booking = await rescheduleBooking(cfg, uid, {
    startISO: args.new_datetime_iso,
    reason: args.reason,
  });

  if (!booking) {
    return {
      ok: false,
      output: null,
      error: "No se pudo reprogramar la cita en Cal.com",
    };
  }

  await updateAppointmentByUid(ctx.workspaceId, uid, {
    external_uid: booking.uid,
    start_at: booking.start,
    end_at: booking.end,
    reschedule_reason: args.reason ?? null,
    raw: uid !== booking.uid ? { previous_uid: uid } : {},
    updated_at: new Date().toISOString(),
  });

  return {
    ok: true,
    output: {
      uid: booking.uid,
      datetime: booking.start,
      message: `Cita reprogramada para ${booking.start}.`,
    },
  };
}

export const calcomRescheduleTool: Tool<Args> = {
  name: "calcom_reschedule",
  description:
    "Reprograma la próxima cita del cliente en Cal.com a una nueva fecha y hora. Confirma la nueva hora con el cliente antes de usar esta herramienta.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/features/tools/tools/calcom-reschedule.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tools/tools/calcom-reschedule.ts src/features/tools/tools/calcom-reschedule.test.ts
git commit -m "feat(calcom): calcom_reschedule tool"
```

---

## Task 11: `calcom_cancel` tool

**Files:**

- Create: `src/features/tools/tools/calcom-cancel.ts`
- Test: `src/features/tools/tools/calcom-cancel.test.ts`

Same "which appointment" resolution as reschedule; on success set `status='cancelled'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getCalComConfig = vi.fn();
const cancelBooking = vi.fn();
vi.mock("../../inbox/services/calcom-client", () => ({
  getCalComConfig,
  cancelBooking,
}));

const findUpcomingAppointments = vi.fn();
const updateAppointmentByUid = vi.fn();
vi.mock("../../inbox/services/appointments-repo", () => ({
  findUpcomingAppointments,
  updateAppointmentByUid,
}));

import { calcomCancelTool } from "./calcom-cancel";

const ctx = { workspaceId: "ws1", conversationId: "cv1", contactId: "c1" };

beforeEach(() => {
  getCalComConfig.mockResolvedValue({
    apiKey: "k",
    baseUrl: "b",
    defaultEventTypeId: 1,
    timezone: "UTC",
    eventTypes: {},
  });
});

describe("calcom_cancel", () => {
  it("errors when there is no upcoming appointment", async () => {
    findUpcomingAppointments.mockResolvedValue([]);
    const res = await calcomCancelTool.run({}, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no encuentro una cita/i);
  });

  it("asks which one when more than one upcoming", async () => {
    findUpcomingAppointments.mockResolvedValue([
      { external_uid: "bk_1", start_at: "2050-09-06T10:00:00Z" },
      { external_uid: "bk_2", start_at: "2050-09-08T10:00:00Z" },
    ]);
    const res = await calcomCancelTool.run({}, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toMatchObject({ needs_disambiguation: true });
    expect(cancelBooking).not.toHaveBeenCalled();
  });

  it("cancels the single upcoming appointment and marks the row cancelled", async () => {
    findUpcomingAppointments.mockResolvedValue([
      { external_uid: "bk_1", start_at: "2050-09-06T10:00:00Z" },
    ]);
    cancelBooking.mockResolvedValue(true);

    const res = await calcomCancelTool.run({ reason: "ya no puede ir" }, ctx);

    expect(res.ok).toBe(true);
    expect(cancelBooking).toHaveBeenCalledWith(expect.anything(), "bk_1", {
      reason: "ya no puede ir",
    });
    expect(updateAppointmentByUid).toHaveBeenCalledWith(
      "ws1",
      "bk_1",
      expect.objectContaining({
        status: "cancelled",
        cancel_reason: "ya no puede ir",
      }),
    );
  });

  it("returns an error when the Cal.com cancel fails", async () => {
    findUpcomingAppointments.mockResolvedValue([
      { external_uid: "bk_1", start_at: "2050-09-06T10:00:00Z" },
    ]);
    cancelBooking.mockResolvedValue(false);
    const res = await calcomCancelTool.run({}, ctx);
    expect(res.ok).toBe(false);
    expect(updateAppointmentByUid).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/features/tools/tools/calcom-cancel.test.ts`
Expected: FAIL — tool not exported.

- [ ] **Step 3: Implement the tool**

```ts
// src/features/tools/tools/calcom-cancel.ts
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  appointment_uid: z
    .string()
    .optional()
    .describe(
      "UID de la cita de Cal.com; si se omite se usa la próxima cita del contacto",
    ),
  reason: z.string().optional().describe("Motivo de la cancelación"),
});

type Args = z.infer<typeof schema>;

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const { getCalComConfig, cancelBooking } =
    await import("../../inbox/services/calcom-client");
  const { findUpcomingAppointments, updateAppointmentByUid } =
    await import("../../inbox/services/appointments-repo");

  const cfg = await getCalComConfig(ctx.workspaceId);
  if (!cfg) {
    return {
      ok: false,
      output: null,
      error: "Cal.com no está conectado para este workspace",
    };
  }

  let uid = args.appointment_uid ?? null;
  if (!uid) {
    const upcoming = await findUpcomingAppointments(
      ctx.workspaceId,
      ctx.contactId || null,
    );
    if (upcoming.length === 0) {
      return {
        ok: false,
        output: null,
        error: "No encuentro una cita próxima a tu nombre para cancelar",
      };
    }
    if (upcoming.length > 1) {
      return {
        ok: false,
        output: {
          needs_disambiguation: true,
          appointments: upcoming.map((a) => ({
            uid: a.external_uid,
            start: a.start_at,
          })),
        },
        error:
          "Hay más de una cita próxima; pregunta al cliente cuál quiere cancelar",
      };
    }
    uid = upcoming[0].external_uid;
  }

  const ok = await cancelBooking(cfg, uid, { reason: args.reason });
  if (!ok) {
    return {
      ok: false,
      output: null,
      error: "No se pudo cancelar la cita en Cal.com",
    };
  }

  await updateAppointmentByUid(ctx.workspaceId, uid, {
    status: "cancelled",
    cancel_reason: args.reason ?? null,
    updated_at: new Date().toISOString(),
  });

  return {
    ok: true,
    output: { uid, message: "Cita cancelada." },
  };
}

export const calcomCancelTool: Tool<Args> = {
  name: "calcom_cancel",
  description:
    "Cancela la próxima cita del cliente en Cal.com. Confirma con el cliente que quiere cancelar antes de usar esta herramienta.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/features/tools/tools/calcom-cancel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tools/tools/calcom-cancel.ts src/features/tools/tools/calcom-cancel.test.ts
git commit -m "feat(calcom): calcom_cancel tool"
```

---

## Task 12: Register the tools

**Files:**

- Modify: `src/features/tools/index.ts`
- Test: `src/features/tools/registry-calcom.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/tools/registry-calcom.test.ts
import { describe, it, expect } from "vitest";
import { registry } from "./index";

describe("registry — Cal.com tools", () => {
  it("has all four calcom tools registered", () => {
    const names = registry.list().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "calcom_check_availability",
        "calcom_book",
        "calcom_reschedule",
        "calcom_cancel",
      ]),
    );
  });

  it("keeps the existing HighLevel tools registered", () => {
    const names = registry.list().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["check_availability", "schedule_highlevel"]),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/features/tools/registry-calcom.test.ts`
Expected: FAIL — calcom tools not in `registry.list()`.

- [ ] **Step 3: Register the tools**

In `src/features/tools/index.ts`, add the imports after the existing tool imports:

```ts
import { calcomCheckAvailabilityTool } from "./tools/calcom-check-availability";
import { calcomBookTool } from "./tools/calcom-book";
import { calcomRescheduleTool } from "./tools/calcom-reschedule";
import { calcomCancelTool } from "./tools/calcom-cancel";
```

And the registrations after the existing `registry.register(...)` calls:

```ts
registry.register(calcomCheckAvailabilityTool);
registry.register(calcomBookTool);
registry.register(calcomRescheduleTool);
registry.register(calcomCancelTool);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/features/tools/registry-calcom.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full test + typecheck**

Run: `npm run test:run && npm run typecheck`
Expected: all tests PASS, `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/tools/index.ts src/features/tools/registry-calcom.test.ts
git commit -m "feat(calcom): register the four Cal.com tools"
```

---

## Task 13: Allow `caldotcom` in the integrations API

**Files:**

- Modify: `src/app/api/workspace/[id]/integrations/route.ts`

- [ ] **Step 1: Update the schema**

Find:

```ts
const IntegrationSchema = z.object({
  provider: z.enum(["ycloud", "openrouter", "highlevel"]),
```

Replace the enum line with:

```ts
  provider: z.enum(["ycloud", "openrouter", "highlevel", "caldotcom"]),
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Manual check — save a Cal.com integration**

Start the dev server (`npm run dev`), then from the browser devtools console on a workspace settings page (or via `curl` with a valid session cookie):

```
PUT /api/workspace/<id>/integrations
{ "provider": "caldotcom", "enabled": true,
  "credentials": { "calcom_api_key": "cal_test_x" },
  "config": { "base_url": "https://api.cal.com", "default_event_type_id": 1 } }
```

Expected: `200 { ok: true }`. Re-GET the integrations and confirm `calcom_api_key` comes back masked (`••••••`).

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/workspace/[id]/integrations/route.ts"
git commit -m "feat(calcom): accept caldotcom provider in the integrations API"
```

---

## Task 14: "Probar conexión" endpoint

**Files:**

- Create: `src/app/api/workspace/[id]/integrations/calcom/test/route.ts`

Mirrors `src/app/api/workspace/[id]/integrations/test/route.ts` (the YCloud one): auth gate, load the integration, call the provider, return `{ ok, ... }`.

- [ ] **Step 1: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import {
  getCalComConfig,
  CAL_VERSION_BOOKINGS,
} from "@/features/inbox/services/calcom-client";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, {
    minRole: "manager",
  });
  if (!auth.ok) return auth.response;

  const cfg = await getCalComConfig(workspaceId);
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "Cal.com no está configurado o está deshabilitado" },
      { status: 200 },
    );
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/v2/me`, {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "cal-api-version": CAL_VERSION_BOOKINGS,
      },
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Cal.com respondió ${res.status}` },
        { status: 200 },
      );
    }
    const json = (await res.json()) as {
      data?: { username?: string; email?: string; name?: string };
    };
    const who =
      json.data?.name ?? json.data?.username ?? json.data?.email ?? "cuenta";
    return NextResponse.json({ ok: true, account: who });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Error de red al contactar Cal.com" },
      { status: 200 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Manual check**

With a `caldotcom` integration saved (real `cal_live_*` key), `POST /api/workspace/<id>/integrations/calcom/test`.
Expected: `{ ok: true, account: "<your name>" }`. With a bogus key: `{ ok: false, error: "Cal.com respondió 401" }`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/workspace/[id]/integrations/calcom/test/route.ts"
git commit -m "feat(calcom): connection test endpoint"
```

---

## Task 15: `CalDotComSection` in the integrations tab

**Files:**

- Modify: `src/features/settings/components/integrations-tab.tsx`

Add a `CalDotComSection` component modeled on `YCloudSection` (same file), and render it in `IntegrationsTab`. Fields: API Key (password), Base URL (default shown), Default Event Type ID (number), Timezone (text, optional), Named event types (textarea JSON, optional). "Probar conexión" button hits the Task 14 endpoint. "Guardar" does a `PUT /api/workspace/${workspaceId}/integrations` with `provider: "caldotcom"`.

- [ ] **Step 1: Add the `Provider` type value**

Find:

```ts
type Provider = "ycloud" | "openrouter" | "highlevel";
```

Replace with:

```ts
type Provider = "ycloud" | "openrouter" | "highlevel" | "caldotcom";
```

- [ ] **Step 2: Add the `CalDotComSection` component**

Insert this component just before `// ─── Main component ───` in the same file:

```tsx
// ─── Cal.com section ──────────────────────────────────────────────────────────

function CalDotComSection({
  workspaceId,
  initial,
  onSaved,
}: {
  workspaceId: string;
  initial: IntegrationData | undefined;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState(
    initial?.credentials?.calcom_api_key ?? "",
  );
  const [baseUrl, setBaseUrl] = useState(
    (initial?.config?.base_url as string | undefined) ?? "https://api.cal.com",
  );
  const [eventTypeId, setEventTypeId] = useState<string>(
    initial?.config?.default_event_type_id != null
      ? String(initial.config.default_event_type_id)
      : "",
  );
  const [timezone, setTimezone] = useState(
    (initial?.config?.timezone as string | undefined) ?? "",
  );
  const [eventTypesJson, setEventTypesJson] = useState(
    initial?.config?.event_types
      ? JSON.stringify(initial.config.event_types, null, 2)
      : "",
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch(
        `/api/workspace/${workspaceId}/integrations/calcom/test`,
        { method: "POST" },
      );
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        account?: string;
      };
      if (json.ok) toast.success(`Cal.com conectado — ${json.account}`);
      else toast.error(json.error ?? "Error al probar la conexión");
    } catch {
      toast.error("Error de red al probar la conexión");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    let eventTypes: Record<string, number> | undefined;
    if (eventTypesJson.trim()) {
      try {
        eventTypes = JSON.parse(eventTypesJson) as Record<string, number>;
      } catch {
        toast.error("El JSON de tipos de cita no es válido");
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/integrations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "caldotcom",
          credentials: { calcom_api_key: apiKey },
          config: {
            base_url: baseUrl.trim() || "https://api.cal.com",
            default_event_type_id: eventTypeId ? Number(eventTypeId) : null,
            timezone: timezone.trim(),
            ...(eventTypes ? { event_types: eventTypes } : {}),
          },
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (json.ok) {
        toast.success("Configuración de Cal.com guardada");
        onSaved();
      } else {
        toast.error(json.error ?? "Error al guardar");
      }
    } catch {
      toast.error("Error de red al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="Cal.com"
      description="Agenda, reprograma y cancela citas desde WhatsApp con Cal.com (cloud o self-hosted)."
    >
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="calcom-api-key">API Key</Label>
          <Input
            id="calcom-api-key"
            type="password"
            placeholder="cal_live_..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="calcom-base-url">Base URL de la API</Label>
          <Input
            id="calcom-base-url"
            type="url"
            placeholder="https://api.cal.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Déjalo en <code>https://api.cal.com</code> para Cal.com Cloud, o pon
            la URL de tu instancia self-hosted.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="calcom-event-type">Event Type ID por defecto</Label>
          <Input
            id="calcom-event-type"
            type="number"
            placeholder="123"
            value={eventTypeId}
            onChange={(e) => setEventTypeId(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="calcom-timezone">Zona horaria (opcional)</Label>
          <Input
            id="calcom-timezone"
            placeholder="America/Mexico_City"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Si la dejas vacía se usa la zona horaria del negocio.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="calcom-event-types">
            Tipos de cita con nombre (opcional, JSON)
          </Label>
          <Textarea
            id="calcom-event-types"
            rows={3}
            placeholder={'{ "consulta": 123, "limpieza": 456 }'}
            value={eventTypesJson}
            onChange={(e) => setEventTypesJson(e.target.value)}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Deja que el agente elija el tipo por nombre. Si lo omites, siempre
            usa el Event Type ID por defecto.
          </p>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing}
            aria-busy={testing}
          >
            {testing && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
            )}
            Probar conexión
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            aria-busy={saving}
          >
            {saving && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
            )}
            Guardar
          </Button>
        </div>
      </div>
    </Section>
  );
}
```

- [ ] **Step 3: Render it in `IntegrationsTab`**

In the `IntegrationsTab` component, add after the `highlevel` lookup:

```ts
const calcom = findIntegration(integrations, "caldotcom");
```

And in the returned JSX, after the `HighLevelSection` block and its `<Separator />`:

```tsx
      <Separator />
      <CalDotComSection
        workspaceId={workspaceId}
        initial={calcom}
        onSaved={refresh}
      />
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Manual check**

`npm run dev` → workspace → Settings → Integraciones. The Cal.com section renders, saves, and "Probar conexión" works against a real key.

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/components/integrations-tab.tsx
git commit -m "feat(calcom): Cal.com section in the integrations tab"
```

---

## Task 16: Tool icons (cosmetic)

**Files:**

- Modify: `src/features/settings/components/tools-catalog.tsx`

- [ ] **Step 1: Add icons for the new tool keys**

In the `TOOL_ICONS` record, add entries (reusing already-imported lucide icons):

```ts
  calcom_check_availability: CalendarSearch,
  calcom_book: CalendarPlus,
  calcom_reschedule: CalendarClock,
  calcom_cancel: CalendarClock,
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/components/tools-catalog.tsx
git commit -m "feat(calcom): icons for the Cal.com tools in the catalog"
```

---

## Task 17: Manual verification guide + spec follow-up

**Files:**

- Create: `docs/superpowers/plans/2026-08-27-calcom-manual-verification.md`

- [ ] **Step 1: Write the verification guide**

```markdown
# Cal.com — manual end-to-end verification

Prereq: a Cal.com account (cloud or self-hosted), one event type, its numeric ID.

1. **Connect:** workspace → Settings → Integraciones → Cal.com. Paste the API key,
   set the Event Type ID, leave Base URL default. Save → "Probar conexión" shows
   your account name.
2. **Enable tools:** Settings → Herramientas → toggle on `calcom_check_availability`,
   `calcom_book`, `calcom_reschedule`, `calcom_cancel`. Leave the HighLevel tools off.
3. **Playground booking:** Agentes → Probar chat:
   - "¿qué horarios tienes esta semana?" → agent calls `calcom_check_availability`,
     lists real slots.
   - "agéndame el <slot> a nombre de Ana, ana@example.com" → agent confirms, then
     calls `calcom_book`. Check the Cal.com dashboard: the booking exists. Check
     the DB: `select * from appointments order by created_at desc limit 1;`
   - "muévela al <otro slot>" → `calcom_reschedule`. Cal.com + `appointments`
     row both updated.
   - "mejor cancélala" → `calcom_cancel`. Cal.com shows cancelled; row `status='cancelled'`.
4. **Not-connected path:** disable the Cal.com integration, retry a booking in the
   playground → agent reports it can't schedule right now.
5. **Regression:** a workspace with HighLevel still books via `schedule_highlevel`
   unchanged.
```

- [ ] **Step 2: Run the full guide against a real Cal.com account**

Do each step. Fix any defects found (new task-style commits).

- [ ] **Step 3: Final full verification**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-27-calcom-manual-verification.md
git commit -m "docs(calcom): manual end-to-end verification guide"
```

- [ ] **Step 5: Update the EJEMPLO-CLINICA agent prompt (optional)**

If keeping `EJEMPLO-CLINICA.md`, add to the agent prompt a line about the
booking flow with Cal.com: _"Antes de agendar pide el correo del cliente para la
confirmación. Confirma fecha y hora antes de usar calcom_book. Confirma con el
cliente antes de cancelar."_ Commit if changed.

---

## Self-Review

**Spec coverage:**

| Spec section                                | Task                            |
| ------------------------------------------- | ------------------------------- |
| Integration credentials & config            | Task 13 (enum), Task 15 (UI)    |
| `calcom-client.ts` service                  | Tasks 2–5                       |
| `appointments` table + RLS                  | Task 6                          |
| Tool seed into `public.tools`               | Task 6                          |
| `calcom_check_availability`                 | Task 8                          |
| `calcom_book` (+ email backfill)            | Task 9                          |
| `calcom_reschedule` ("which booking" logic) | Task 10                         |
| `calcom_cancel`                             | Task 11                         |
| Tool registration (no agent changes)        | Task 12                         |
| Connection test endpoint                    | Task 14                         |
| Tool icons                                  | Task 16                         |
| Error handling table                        | covered across Tasks 8–11 tests |
| Testing (Vitest)                            | Task 1 + per-task tests         |
| Manual verification                         | Task 17                         |

**Placeholder scan:** none — every code step has full content. Task 15 step 3 references named anchors in an existing file rather than repeating the whole 800-line file; the anchor strings are exact.

**Type consistency:** `CalComConfig`, `CalBooking`, `AppointmentRow` defined in Tasks 2/4/7 and used consistently. `resolveEventTypeId(cfg, name?)` defined in Task 2, mocked/used in Tasks 8–9. `getSlots` takes `{ eventTypeId, startISO, endISO, timeZone }` in Task 3 and is called with exactly that shape in Task 8. `insertAppointment` input keys match between Task 7 and Task 9. `findUpcomingAppointments(workspaceId, contactId | null)` consistent across Tasks 7/10/11.

**Deviations from spec:** the `appointments.status` CHECK is `('accepted','cancelled')` only — the spec's unused `'rescheduled'` value was dropped (a completed reschedule stays `accepted`), as flagged during spec review.
