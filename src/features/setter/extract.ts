// Structured extraction for the Skala setter. The schema has no score field.

import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { getOpenRouterApiKey } from "@/features/inbox/services/openrouter";
import {
  DOLORES,
  coerceLeadProfile,
  type LeadProfile,
} from "./qualify";

const LeadExtractionSchema = z.object({
  rol: z.enum(["decisor", "influenciador", "otro", "desconocido"]),
  num_profesionales: z.number().int().nullable(),
  multisede: z.boolean(),
  consultas_whatsapp_dia: z.number().int().nullable(),
  dolores: z.array(z.enum(DOLORES)),
  urgencia: z.boolean(),
  ya_intento: z.boolean(),
  agenda_digital: z.boolean(),
  software_agenda: z.string().nullable(),
  pide_demo: z.boolean(),
  evasiones_pregunta_clave: z.number().int(),
  solo_precio_se_niega: z.boolean(),
  rubro_fuera: z.boolean(),
  es_proveedor: z.boolean(),
  es_paciente: z.boolean(),
  es_contacto_conocido: z.boolean(),
  pidio_humano: z.boolean(),
  pidio_precio_veces: z.number().int(),
  pregunta_legal_tecnica: z.boolean(),
  molesto: z.boolean(),
  tipo_clinica: z.string().nullable(),
});

async function extractionModel(workspaceId: string) {
  const openai = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: await getOpenRouterApiKey(workspaceId),
    headers: {
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "Agente WhatsApp",
    },
  });
  return openai.chat(
    process.env.OPENROUTER_SETTER_MODEL ?? "openai/gpt-4o-mini",
  );
}

/**
 * Reads qualification fields from the conversation. Returns null when the
 * model call fails. Never returns a score.
 */
export async function extractLeadUpdate(input: {
  workspaceId: string;
  transcript: string;
}): Promise<LeadProfile | null> {
  const prompt = `Eres un extractor de datos de una conversación de WhatsApp. No redactas la respuesta al lead y no calculas ningún puntaje.

Lee la conversación completa y devuelve el estado acumulado del lead.
- No inventes. Si un dato no está, usa null, false, 0 o "desconocido" según el campo.
- rol: decisor si decide en la clínica (dueño, director, gerente). influenciador si acompaña pero no decide. otro si tiene otro rol claro. desconocido si no se sabe.
- num_profesionales: personas que atienden pacientes. null si no lo dijo.
- multisede: true solo si dice que tiene 2 o más sedes o locales.
- consultas_whatsapp_dia: mensajes o consultas de pacientes por WhatsApp en un día. null si no lo dijo.
- dolores: solo valores de esta lista, y solo si el lead los mencionó: ${DOLORES.join(", ")}.
- urgencia: quiere resolverlo pronto.
- ya_intento: ya probó otra herramienta o proceso.
- agenda_digital y software_agenda: si ya usa un software de agenda, y cuál.
- pide_demo: pidió la llamada, la demo o agendar.
- evasiones_pregunta_clave: cuántas veces evadió la misma pregunta de calificación.
- solo_precio_se_niega: solo quiere el precio y se niega a conversar de la clínica.
- rubro_fuera: no es una clínica dental, de estética ni de fisioterapia.
- es_proveedor: quiere venderle algo a Skala.
- es_paciente: escribe como paciente (hora para sí mismo, dolor, tratamiento), no como clínica.
- es_contacto_conocido: conoce a Sky, es cliente, amigo o Sky le pidió escribir.
- pidio_humano: pidió hablar con una persona.
- pidio_precio_veces: cuántas veces pidió el precio.
- pregunta_legal_tecnica: pregunta de contrato, legal o técnica específica.
- molesto: queja, insulto o enojo.
- tipo_clinica: dental, estetica, fisioterapia u otra etiqueta corta. null si no se sabe.

Conversación:
${input.transcript}`;

  try {
    const { object } = await generateObject({
      model: await extractionModel(input.workspaceId),
      schema: LeadExtractionSchema,
      prompt,
    });
    return coerceLeadProfile(object);
  } catch (err) {
    console.error(
      "[setter] extractLeadUpdate failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
