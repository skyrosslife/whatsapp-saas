import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  appointment_uid: z
    .string()
    .optional()
    .describe(
      "UID de la cita de Cal.com; si se omite se usa la próxima cita del contacto",
    ),
  reason: z.string().optional().describe("Motivo de la cancelación"),
});

type Args = z.infer<typeof schema>;

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const { getCalComConfig, cancelBooking } =
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

  let uid = args.appointment_uid ?? null;
  if (!uid) {
    const upcoming = await findUpcomingAppointments(
      ctx.workspaceId,
      ctx.contactId || null,
    );
    if (upcoming.length === 0) {
      return {
        ok: false,
        output: null,
        error: "No encuentro una cita próxima a tu nombre para cancelar",
      };
    }
    if (upcoming.length > 1) {
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
          "Hay más de una cita próxima; pregunta al cliente cuál quiere cancelar",
      };
    }
    uid = upcoming[0].external_uid;
  }

  const ok = await cancelBooking(cfg, uid, { reason: args.reason });
  if (!ok) {
    return {
      ok: false,
      output: null,
      error: "No se pudo cancelar la cita en Cal.com",
    };
  }

  await updateAppointmentByUid(ctx.workspaceId, uid, {
    status: "cancelled",
    cancel_reason: args.reason ?? null,
    updated_at: new Date().toISOString(),
  });

  return {
    ok: true,
    output: { uid, message: "Cita cancelada." },
  };
}

export const calcomCancelTool: Tool<Args> = {
  name: "calcom_cancel",
  description:
    "Cancela la próxima cita del cliente en Cal.com. Confirma con el cliente que quiere cancelar antes de usar esta herramienta.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run,
};
