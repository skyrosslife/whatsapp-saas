/**
 * appointments-repo.ts — persistence helpers for Cal.com-backed appointments.
 *
 * Used by the Cal.com booking tools. Follows the highlevel-client.ts style: a
 * `svc()` helper wrapping `createClient`, `console.error` on failure, never throws.
 */

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
  status: string;
  scheduled_at: string;
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
  scheduledAt: string;
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
      status: "booked",
      scheduled_at: input.scheduledAt,
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
      "id, external_uid, event_type_id, status, scheduled_at, end_at, attendee_email, attendee_name",
    )
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .eq("status", "booked")
    .gt("scheduled_at", new Date().toISOString())
    .order("scheduled_at");

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
