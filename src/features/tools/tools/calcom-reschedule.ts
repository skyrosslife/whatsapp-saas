import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  new_datetime_iso: z
    .string()
    .describe("Nuevo inicio de la cita en ISO 8601 con offset"),
  appointment_uid: z
    .string()
    .optional()
    .describe(
      "UID de la cita de Cal.com; si se omite se usa la próxima cita del contacto",
    ),
  reason: z.string().optional().describe("Motivo del cambio"),
});

type Args = z.infer<typeof schema>;

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const { getCalComConfig, rescheduleBooking } =
    await import("../../inbox/services/calcom-client");
  const { findUpcomingAppointments, updateAppointmentByUid } =
    await import("../../inbox/services/appointments-repo");

  const cfg = await getCalComConfig(ctx.workspaceId);
  if (!cfg) {
    return {
      ok: false,
      output: null,
      error: "Cal.com no está conectado para este workspace",
    };
  }

  const upcoming = await findUpcomingAppointments(
    ctx.workspaceId,
    ctx.contactId || null,
  );

  let uid: string;
  if (args.appointment_uid) {
    const match = upcoming.find((a) => a.external_uid === args.appointment_uid);
    if (!match) {
      return {
        ok: false,
        output: null,
        error: "No encuentro esa cita a tu nombre",
      };
    }
    uid = match.external_uid;
  } else if (upcoming.length === 0) {
    return {
      ok: false,
      output: null,
      error: "No encuentro una cita próxima a tu nombre para reprogramar",
    };
  } else if (upcoming.length > 1) {
    return {
      ok: false,
      output: {
        needs_disambiguation: true,
        appointments: upcoming.map((a) => ({
          uid: a.external_uid,
          start: a.scheduled_at,
        })),
      },
      error:
        "Hay más de una cita próxima; pregunta al cliente cuál quiere reprogramar",
    };
  } else {
    uid = upcoming[0].external_uid;
  }

  const booking = await rescheduleBooking(cfg, uid, {
    startISO: args.new_datetime_iso,
    reason: args.reason,
  });

  if (!booking) {
    return {
      ok: false,
      output: null,
      error: "No se pudo reprogramar la cita en Cal.com",
    };
  }

  const patch: Record<string, unknown> = {
    external_uid: booking.uid,
    scheduled_at: booking.start,
    end_at: booking.end,
    reschedule_reason: args.reason ?? null,
    updated_at: new Date().toISOString(),
  };
  if (uid !== booking.uid) patch.meta = { previous_uid: uid };

  await updateAppointmentByUid(ctx.workspaceId, uid, patch);

  return {
    ok: true,
    output: {
      uid: booking.uid,
      datetime: booking.start,
      message: `Cita reprogramada para ${booking.start}.`,
    },
  };
}

export const calcomRescheduleTool: Tool<Args> = {
  name: "calcom_reschedule",
  description:
    "Reprograma la próxima cita del cliente en Cal.com a una nueva fecha y hora. Confirma la nueva hora con el cliente antes de usar esta herramienta.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
