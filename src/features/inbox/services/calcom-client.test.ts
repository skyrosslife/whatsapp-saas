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
    const fetchMock = vi.fn(async (_url: string, _opts: RequestInit) => ({
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
    const fetchMock = vi.fn(async (_url: string, _opts: RequestInit) => ({
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
    const fetchMock = vi.fn(async (_url: string, _opts: RequestInit) => ({
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
    const fetchMock = vi.fn(async (_url: string, _opts: RequestInit) => ({
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
