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
      { external_uid: "bk_1", scheduled_at: "2050-09-06T10:00:00Z" },
      { external_uid: "bk_2", scheduled_at: "2050-09-08T10:00:00Z" },
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
      { external_uid: "bk_1", scheduled_at: "2050-09-06T10:00:00Z" },
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
        scheduled_at: "2050-09-10T10:00:00Z",
        reschedule_reason: "conflicto",
      }),
    );
  });

  it("uses an explicit appointment_uid when it belongs to the contact", async () => {
    findUpcomingAppointments.mockResolvedValue([
      { external_uid: "bk_9", scheduled_at: "2050-09-11T09:00:00Z" },
    ]);
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
    expect(rescheduleBooking).toHaveBeenCalledWith(
      expect.anything(),
      "bk_9",
      expect.objectContaining({ startISO: "2050-09-11T10:00:00Z" }),
    );
  });

  it("rejects an appointment_uid that is not the contact's own", async () => {
    findUpcomingAppointments.mockResolvedValue([
      { external_uid: "bk_1", scheduled_at: "2050-09-06T10:00:00Z" },
    ]);
    const res = await calcomRescheduleTool.run(
      { new_datetime_iso: "2050-09-11T10:00:00Z", appointment_uid: "bk_other" },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no encuentro esa cita/i);
    expect(rescheduleBooking).not.toHaveBeenCalled();
  });

  it("returns an error when the Cal.com reschedule fails", async () => {
    findUpcomingAppointments.mockResolvedValue([
      { external_uid: "bk_1", scheduled_at: "2050-09-06T10:00:00Z" },
    ]);
    rescheduleBooking.mockResolvedValue(null);
    const res = await calcomRescheduleTool.run(
      { new_datetime_iso: "2050-09-10T10:00:00Z" },
      ctx,
    );
    expect(res.ok).toBe(false);
  });
});
