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
      { external_uid: "bk_1", scheduled_at: "2050-09-06T10:00:00Z" },
      { external_uid: "bk_2", scheduled_at: "2050-09-08T10:00:00Z" },
    ]);
    const res = await calcomCancelTool.run({}, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toMatchObject({ needs_disambiguation: true });
    expect(cancelBooking).not.toHaveBeenCalled();
  });

  it("cancels the single upcoming appointment and marks the row cancelled", async () => {
    findUpcomingAppointments.mockResolvedValue([
      { external_uid: "bk_1", scheduled_at: "2050-09-06T10:00:00Z" },
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
      { external_uid: "bk_1", scheduled_at: "2050-09-06T10:00:00Z" },
    ]);
    cancelBooking.mockResolvedValue(false);
    const res = await calcomCancelTool.run({}, ctx);
    expect(res.ok).toBe(false);
    expect(updateAppointmentByUid).not.toHaveBeenCalled();
  });
});
