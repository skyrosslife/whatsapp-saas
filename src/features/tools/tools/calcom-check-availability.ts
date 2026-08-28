import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";

const schema = z.object({
  date_from: z
    .string()
    .describe("Fecha inicial del rango a consultar (ISO, ej: 2026-06-12)"),
  date_to: z.string().describe("Fecha final del rango (ISO, ej: 2026-06-19)"),
  timezone: z
    .string()
    .optional()
    .describe("Zona horaria IANA, ej: America/Mexico_City"),
  event_type: z
    .string()
    .optional()
    .describe(
      "Nombre del tipo de cita configurado (ej: 'consulta'); si se omite usa el tipo por defecto del workspace",
    ),
});

type Args = z.infer<typeof schema>;

async function run(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const { getCalComConfig, getSlots, resolveEventTypeId } =
    await import("../../inbox/services/calcom-client");

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
      error:
        "No hay un tipo de cita (event type) configurado para Cal.com en este workspace",
    };
  }

  const startMs = Date.parse(args.date_from);
  let endMs = Date.parse(args.date_to);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return { ok: false, output: null, error: "Fechas inválidas" };
  }
  endMs = Math.max(endMs + 24 * 60 * 60 * 1000 - 1, startMs);

  const timeZone = args.timezone ?? cfg.timezone ?? "UTC";

  const slots = await getSlots(cfg, {
    eventTypeId,
    startISO: new Date(startMs).toISOString(),
    endISO: new Date(endMs).toISOString(),
    timeZone,
  });

  if (slots === null) {
    return {
      ok: false,
      output: null,
      error: "No se pudo consultar la disponibilidad en Cal.com",
    };
  }

  return {
    ok: true,
    output: {
      slots,
      count: slots.length,
      message:
        slots.length === 0
          ? "No hay horarios disponibles en ese rango."
          : `Hay ${slots.length} horarios disponibles.`,
    },
  };
}

export const calcomCheckAvailabilityTool: Tool<Args> = {
  name: "calcom_check_availability",
  description:
    "Consulta los horarios libres reales de Cal.com en un rango de fechas. Úsalo ANTES de agendar para ofrecer horarios que sí existen.",
  sensitivity: "read",
  schema,
  enabledFor: () => true,
  run,
};
