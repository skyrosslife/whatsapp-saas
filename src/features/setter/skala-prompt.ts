// Renders the Skala system prompt for one turn.
// The template lives in docs/setter/skala/SYSTEM_PROMPT.txt and is mirrored
// by SKALA_SYSTEM_PROMPT so the server does not depend on reading the file.

import { SKALA_SYSTEM_PROMPT } from "./skala-prompt-text";

export { SKALA_SYSTEM_PROMPT };

export const SKALA_GARANTIA_TEXT =
  "Si el lead está escéptico, puedes mencionar que, si en los primeros 30 días el bot no responde 24/7 y no agenda al menos 5 citas, el segundo mes no se cobra, y que Sky explica las condiciones.";

export const SKALA_SIN_GARANTIA_TEXT =
  "La garantía no está activa. No la menciones, no hables de meses sin cobro ni de pruebas gratis.";

export interface SkalaPromptVars {
  bot_name: string;
  link_agenda: string | null;
  link_demo?: string | null;
  call_minutes: number;
  garantia_activa: boolean;
}

export function isPlaceholderPrompt(text: string | null | undefined): boolean {
  const trimmed = (text ?? "").trim();
  return trimmed.length === 0 || trimmed.startsWith("PLACEHOLDER");
}

/** Uses the committed Skala template when the workspace still has the placeholder. */
export function resolveSkalaPromptTemplate(
  stored: string | null | undefined,
): string {
  if (isPlaceholderPrompt(stored)) return SKALA_SYSTEM_PROMPT;
  return stored as string;
}

/**
 * Fills bot name, call length and the guarantee. The booking URL is inserted
 * only when `allowLink` is true. Otherwise every line that would tell the
 * model to send a link is removed, and any URL left in the template is stripped.
 */
export function renderSkalaSystemPrompt(
  template: string,
  vars: SkalaPromptVars,
  allowLink: boolean,
): string {
  const link = (vars.link_agenda ?? "").trim();
  const demo = (vars.link_demo ?? "").trim();
  const canLink = allowLink && link.length > 0;
  let text = resolveSkalaPromptTemplate(template);

  text = text.replaceAll(
    "{{bot_name}}",
    vars.bot_name.trim() || "Asistente de Skala",
  );
  text = text.replaceAll("{{call_minutes}}", String(vars.call_minutes));
  text = text.replaceAll(
    "{{GARANTIA_BLOCK}}",
    vars.garantia_activa ? SKALA_GARANTIA_TEXT : SKALA_SIN_GARANTIA_TEXT,
  );

  if (canLink) {
    text = text.replaceAll("{{LINK_AGENDA}}", link);
  } else {
    text = text
      .split("\n")
      .filter((line) => !line.includes("{{LINK_AGENDA}}"))
      .join("\n");
  }

  if (canLink && demo) {
    text = text.replaceAll(
      "{{LINK_DEMO}}",
      `Si este turno autoriza enlaces, puedes mencionar también este link de demo: ${demo}`,
    );
  } else {
    text = text
      .split("\n")
      .filter((line) => !line.includes("{{LINK_DEMO}}"))
      .join("\n");
  }

  if (!canLink) {
    text = text.replace(/https?:\/\/\S+/g, "");
  }

  return text.replace(/\n{3,}/g, "\n\n").trim();
}
