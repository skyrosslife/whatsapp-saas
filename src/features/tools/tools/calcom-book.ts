import { createClient as createSbClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const schema = z.object({
  datetime_iso: z
    .string()
    .describe(
      "Inicio de la cita en ISO 8601 con offset, ej: 2026-06-12T10:00:00-06:00",
    ),
  attendee_email: z
    .string()
    .describe("Email del cliente para la confirmación de Cal.com"),
  attendee_name: z.string().optional().describe("Nombre del cliente"),
  event_type: z
    .string()
    .optional()
    .describe(
      "Nombre del tipo de cita configurado; si se omite usa el por defecto",
    ),
  timezone: z.string().optional().describe("Zona horaria IANA"),
});

type Args = z.infer<typeof schema>;

interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
}

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  if (!EMAIL_RE.test(args.attendee_email)) {
    return {
      ok: false,
      output: null,
      error: "Falta un email válido del cliente para agendar en Cal.com",
    };
  }

  const { getCalComConfig, createBooking, resolveEventTypeId } =
    await import("../../inbox/services/calcom-client");
  const { insertAppointment } =
    await import("../../inbox/services/appointments-repo");

  const cfg = await getCalComConfig(ctx.workspaceId);
  if (!cfg) {
    return {
      ok: false,
      output: null,
      error: "Cal.com no está conectado para este workspace",
    };
  }

  const eventTypeId = resolveEventTypeId(cfg, args.event_type);
  if (eventTypeId == null) {
    return {
      ok: false,
      output: null,
      error: "No hay un tipo de cita (event type) configurado para Cal.com",
    };
  }

  const supabase = svc();
  let contact: ContactRow | null = null;
  if (ctx.contactId) {
    const { data } = await supabase
      .from("contacts")
      .select("id, phone, name, email")
      .eq("id", ctx.contactId)
      .single();
    contact = (data as ContactRow | null) ?? null;
  }

  const name = args.attendee_name ?? contact?.name ?? "Cliente";
  const timeZone = args.timezone ?? cfg.timezone ?? "UTC";

  const booking = await createBooking(cfg, {
    eventTypeId,
    startISO: args.datetime_iso,
    attendee: { name, email: args.attendee_email },
    timeZone,
  });

  if (!booking) {
    return {
      ok: false,
      output: null,
      error:
        "No se pudo agendar en Cal.com (horario no disponible o error de API)",
    };
  }

  const appointmentId = await insertAppointment({
    workspaceId: ctx.workspaceId,
    contactId: contact?.id ?? null,
    conversationId: ctx.conversationId || null,
    externalUid: booking.uid,
    eventTypeId: String(eventTypeId),
    scheduledAt: booking.start,
    endAt: booking.end,
    attendeeEmail: args.attendee_email,
    attendeeName: name,
  });

  if (contact && !contact.email) {
    await supabase
      .from("contacts")
      .update({ email: args.attendee_email })
      .eq("id", contact.id);
  }

  return {
    ok: true,
    output: {
      appointment_id: appointmentId,
      uid: booking.uid,
      datetime: booking.start,
      message: `Cita agendada para ${booking.start}.`,
    },
  };
}

export const calcomBookTool: Tool<Args> = {
  name: "calcom_book",
  description:
    "Reserva una cita en Cal.com. Requiere el email del cliente. Llama primero a calcom_check_availability y confirma fecha y hora con el cliente antes de usar esta herramienta.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
