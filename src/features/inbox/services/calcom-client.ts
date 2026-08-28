/**
 * calcom-client.ts — Cal.com API client.
 *
 * Auth: a Cal.com API key. The workspace stores its key in
 * integrations.credentials.calcom_api_key and its event-type ids / base url /
 * timezone in integrations.config. No OAuth, no token refresh — the key is
 * long-lived.
 *
 * API v2 docs: https://cal.com/docs/api-reference/v2/introduction
 */

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

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface CalComConfig {
  apiKey: string;
  baseUrl: string; // no trailing slash
  defaultEventTypeId: number | null;
  timezone: string | null;
  eventTypes: Record<string, number>;
}

interface IntegrationRow {
  credentials: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  enabled: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// Config loader
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Loads the workspace's Cal.com API key + event-type ids / base url / timezone.
 * Timezone falls back to business_info.structured.timezone when config.timezone
 * is unset. Returns null when Cal.com is not connected (no row or no api key).
 */
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

  const row = data as IntegrationRow;

  let creds: Record<string, unknown>;
  try {
    creds = await decryptCredentials(row.credentials, workspaceId, "caldotcom");
  } catch (err) {
    console.error("[calcom] getCalComConfig: credential decrypt failed:", err);
    return null;
  }
  const config = row.config ?? {};

  const apiKey = creds.calcom_api_key;
  if (typeof apiKey !== "string" || apiKey.length === 0) return null;

  const rawBase =
    typeof config.base_url === "string" && config.base_url.length > 0
      ? config.base_url
      : DEFAULT_BASE_URL;
  const baseUrl = rawBase.replace(/\/+$/, "");

  const parsedEventTypeId = Number(config.default_event_type_id);
  const defaultEventTypeId =
    Number.isInteger(parsedEventTypeId) && parsedEventTypeId > 0
      ? parsedEventTypeId
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

// ──────────────────────────────────────────────────────────────────────────────
// API v2 calls
// ──────────────────────────────────────────────────────────────────────────────

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

export interface CalBooking {
  uid: string;
  start: string;
  end: string | null;
  status: string;
}

interface BookingResponse {
  data?: { uid?: string; start?: string; end?: string; status?: string };
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
