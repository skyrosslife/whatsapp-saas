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
