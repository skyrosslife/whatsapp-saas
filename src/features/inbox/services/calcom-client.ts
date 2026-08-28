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

  const creds = await decryptCredentials(
    row.credentials,
    workspaceId,
    "caldotcom",
  );
  const config = row.config ?? {};

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
