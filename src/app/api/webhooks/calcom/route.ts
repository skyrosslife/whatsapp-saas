// Cal.com → pipeline AGENDADO.
// HMAC with CALCOM_WEBHOOK_SECRET. If that env var is unset, every request
// is rejected. A per-workspace setter_configs.calcom_webhook_secret is an
// extra accepted key and, when it matches, limits the contact search to
// that workspace.

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSbClient } from "@supabase/supabase-js";
import {
  matchingCalcomSecret,
  parseCalcomBooking,
  phonesMatch,
  stageAfterBooking,
  type BookingIdentity,
} from "@/features/setter/calcom";
import { contactStageFor, isPipelineStage } from "@/features/setter/qualify";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface ContactHit {
  id: string;
  workspace_id: string;
  phone: string;
  email: string | null;
  pipeline_stage: string | null;
  stage: string | null;
  custom_fields: Record<string, unknown> | null;
}

async function workspaceSecrets(): Promise<
  { workspaceId: string; secret: string }[]
> {
  const { data, error } = await svc()
    .from("setter_configs")
    .select("workspace_id, calcom_webhook_secret")
    .not("calcom_webhook_secret", "is", null);
  if (error || !data) return [];
  return data.flatMap((row) => {
    const secret =
      typeof row.calcom_webhook_secret === "string"
        ? row.calcom_webhook_secret.trim()
        : "";
    if (!secret) return [];
    return [{ workspaceId: row.workspace_id as string, secret }];
  });
}

async function findContacts(
  booking: BookingIdentity,
  workspaceId: string | null,
): Promise<ContactHit[]> {
  const db = svc();
  const found = new Map<string, ContactHit>();
  const columns =
    "id, workspace_id, phone, email, pipeline_stage, stage, custom_fields";

  for (const email of booking.emails) {
    let query = db.from("contacts").select(columns).ilike("email", email);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    const { data } = await query.limit(10);
    for (const row of (data ?? []) as ContactHit[]) found.set(row.id, row);
  }

  for (const phone of booking.phones) {
    const last8 = phone.replace(/\D/g, "").slice(-8);
    if (last8.length < 8) continue;
    let query = db.from("contacts").select(columns).ilike("phone", `%${last8}%`);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    const { data } = await query.limit(20);
    for (const row of (data ?? []) as ContactHit[]) {
      if (phonesMatch(row.phone, phone)) found.set(row.id, row);
    }
  }

  return [...found.values()];
}

async function pickContact(contacts: ContactHit[]): Promise<{
  contact: ContactHit;
  conversationId: string | null;
  conversationStage: string | null;
  setterState: Record<string, unknown>;
} | null> {
  if (contacts.length === 0) return null;
  const db = svc();
  const { data } = await db
    .from("conversations")
    .select("id, contact_id, pipeline_stage, setter_state, updated_at")
    .in(
      "contact_id",
      contacts.map((contact) => contact.id),
    )
    .order("updated_at", { ascending: false })
    .limit(20);

  const conversation = (data ?? [])[0] as
    | {
        id: string;
        contact_id: string;
        pipeline_stage: string | null;
        setter_state: Record<string, unknown> | null;
      }
    | undefined;
  const contact =
    contacts.find((item) => item.id === conversation?.contact_id) ??
    contacts[0];
  return {
    contact,
    conversationId: conversation?.id ?? null,
    conversationStage: conversation?.pipeline_stage ?? null,
    setterState: conversation?.setter_state ?? {},
  };
}

function noteFor(
  booking: BookingIdentity,
  stage: string | null,
  unchanged: boolean,
): string {
  const when = booking.startTime ? `\nInicio: ${booking.startTime}` : "";
  const stageLine = unchanged
    ? "Etapa sin cambio (no se baja de CLIENTE)."
    : `Etapa: ${stage ?? "sin cambio"}`;
  return `Cal.com · ${booking.event}${when}\n${stageLine}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const envSecret = process.env.CALCOM_WEBHOOK_SECRET?.trim() ?? "";
  if (!envSecret) {
    return NextResponse.json(
      { error: "CALCOM_WEBHOOK_SECRET no está configurado" },
      { status: 401 },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-cal-signature-256");
  let secrets: { workspaceId: string; secret: string }[] = [];
  try {
    secrets = await workspaceSecrets();
  } catch {
    secrets = [];
  }
  const matched = matchingCalcomSecret(rawBody, signature, envSecret, secrets);
  if (!matched.ok) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const booking = parseCalcomBooking(body);
  if (!booking) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (booking.phones.length === 0 && booking.emails.length === 0) {
    return NextResponse.json({ ok: true, matched: false, reason: "sin_contacto" });
  }

  try {
    const contacts = await findContacts(booking, matched.workspaceId);
    const picked = await pickContact(contacts);
    if (!picked) {
      return NextResponse.json({ ok: true, matched: false });
    }

    const { contact, conversationId, conversationStage, setterState } = picked;
    const previousEvent = setterState.cal_booking_event;
    const previousUid = setterState.cal_booking_uid;
    if (
      booking.uid &&
      previousUid === booking.uid &&
      previousEvent === booking.event
    ) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const current = isPipelineStage(conversationStage)
      ? conversationStage
      : isPipelineStage(contact.pipeline_stage)
        ? contact.pipeline_stage
        : null;
    const next = stageAfterBooking(current, booking.event);
    const unchanged = next === null;
    const stage = next ?? current;
    const db = svc();

    if (next) {
      const contactUpdate: Record<string, unknown> = {
        pipeline_stage: next,
        custom_fields: {
          ...(contact.custom_fields ?? {}),
          cal_booking_uid: booking.uid,
          cal_booking_event: booking.event,
          pipeline_stage: next,
        },
      };
      const mapped = contactStageFor(next, contact.stage);
      if (mapped) contactUpdate.stage = mapped;
      await db.from("contacts").update(contactUpdate).eq("id", contact.id);

      if (conversationId) {
        await db
          .from("conversations")
          .update({
            pipeline_stage: next,
            setter_state: {
              ...setterState,
              cal_booking_uid: booking.uid,
              cal_booking_event: booking.event,
              cal_booking_start: booking.startTime,
            },
          })
          .eq("id", conversationId);
      }
    } else if (conversationId) {
      await db
        .from("conversations")
        .update({
          setter_state: {
            ...setterState,
            cal_booking_uid: booking.uid,
            cal_booking_event: booking.event,
          },
        })
        .eq("id", conversationId);
    }

    const text = noteFor(booking, stage, unchanged);
    if (conversationId) {
      const { error: noteError } = await db.from("messages").insert({
        workspace_id: contact.workspace_id,
        conversation_id: conversationId,
        direction: "out",
        type: "system",
        body: text,
        status: "sent",
        meta: { internal: true, calcom: true, event: booking.event },
      });
      if (noteError) {
        console.error("[calcom] internal note failed:", noteError.message);
      }
      await db.from("events").insert({
        type: "calcom_booking",
        level: "info",
        workspace_id: contact.workspace_id,
        conversation_id: conversationId,
        payload: {
          event: booking.event,
          uid: booking.uid,
          stage: stage,
          unchanged,
          contact_id: contact.id,
        },
      });
    }
    await db.from("notifications").insert({
      workspace_id: contact.workspace_id,
      conversation_id: conversationId,
      contact_id: contact.id,
      kind: "calcom_booking",
      body: text,
      payload: {
        event: booking.event,
        uid: booking.uid,
        stage,
      },
    });

    return NextResponse.json({
      ok: true,
      matched: true,
      stage,
      unchanged,
    });
  } catch (err) {
    console.error(
      "[calcom] webhook failed:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
