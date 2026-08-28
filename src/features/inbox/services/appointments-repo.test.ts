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
      scheduledAt: "2050-09-05T15:00:00Z",
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
        status: "booked",
        scheduled_at: "2050-09-05T15:00:00Z",
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
      scheduledAt: "2050-09-05T15:00:00Z",
      endAt: null,
      attendeeEmail: null,
      attendeeName: null,
    });
    expect(id).toBeNull();
  });
});

describe("findUpcomingAppointments", () => {
  it("filters by workspace, contact, booked status and returns rows", async () => {
    sb.table("appointments").result = {
      data: [
        {
          id: "ap1",
          external_uid: "bk_1",
          scheduled_at: "2050-09-05T15:00:00Z",
        },
      ],
      error: null,
    };
    const rows = await findUpcomingAppointments("ws1", "c1");
    expect(rows).toHaveLength(1);
    const f = sb.table("appointments").filters;
    expect(f).toContainEqual({ col: "workspace_id", val: "ws1" });
    expect(f).toContainEqual({ col: "contact_id", val: "c1" });
    expect(f).toContainEqual({ col: "status", val: "booked" });
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
