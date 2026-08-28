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
        scheduledAt: "2050-09-05T15:00:00Z",
      }),
    );
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
