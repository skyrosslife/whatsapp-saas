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
      baseUrl: "https://api.cal.com",
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
    expect(cfg?.baseUrl).toBe("https://api.cal.com");
  });
});
