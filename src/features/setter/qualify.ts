// Skala lead qualification. Pure functions only: no database, no model.
// The model may extract fields. It never supplies the score, the tier, the
// route, or the decision to send a booking link.

export const DOLORES = [
  "fuera_de_horario",
  "demora_mas_1h",
  "recepcion_saturada",
  "no_shows",
] as const;

export type Dolor = (typeof DOLORES)[number];

export const DOLOR_LABEL: Record<Dolor, string> = {
  fuera_de_horario: "fuera de horario",
  demora_mas_1h: "demora de más de 1 hora",
  recepcion_saturada: "recepción saturada",
  no_shows: "inasistencias",
};

export type Rol = "decisor" | "influenciador" | "otro" | "desconocido";

export type Tier = "PRIORITARIO" | "CALIFICADO" | "REVISION" | "NUTRIR";

export type RouteName =
  | "proveedor"
  | "paciente"
  | "multisede"
  | "piloto"
  | "independiente"
  | "nutrir";

export type PipelineStage =
  | "NUEVO"
  | "CALIFICANDO"
  | "REVISION"
  | "LINK_ENVIADO"
  | "AGENDADO"
  | "CLIENTE"
  | "NUTRIR"
  | "PERDIDO";

export type HandoffReason =
  | "contacto_conocido"
  | "humano"
  | "multisede"
  | "prioritario"
  | "precio"
  | "legal"
  | "molesto"
  | "revision"
  | "sin_link";

export const ROUTE_TAGS: RouteName[] = [
  "proveedor",
  "paciente",
  "multisede",
  "piloto",
  "independiente",
  "nutrir",
];

export const PIPELINE_STAGES: PipelineStage[] = [
  "NUEVO",
  "CALIFICANDO",
  "REVISION",
  "LINK_ENVIADO",
  "AGENDADO",
  "CLIENTE",
  "NUTRIR",
  "PERDIDO",
];

/** Scores at or above this and below the agenda threshold are REVISION. */
export const REVISION_MIN = 35;

/**
 * Documented booking link for the Skala Studio workspace.
 * 20-minute diagnostic call on Cal.com. This is an example value, not a
 * default: a workspace with an empty link_agenda never sends a link.
 */
export const SKALA_LINK_AGENDA_EXAMPLE =
  "https://cal.com/sky-ross/diagnostico-skala";

export const SKALA_SYSTEM_PROMPT_PLACEHOLDER = `PLACEHOLDER — reemplaza este texto con el prompt final del setter de Skala.

Identidad provisional: eres el Asistente de Skala, una inteligencia artificial. Si te preguntan, dilo con claridad. Nunca te hagas pasar por Sky ni por una persona.

Idioma: español neutro, sin jerga chilena. Tutea por defecto. Usa usted si el lead usa usted o se presenta como Dr. o Dra.

Objetivo: conversar con dueños de clínicas (dental, estética o fisioterapia), entender su operación y, solo cuando el sistema lo indique en el turno, ofrecer una llamada con Sky.

No inventes precios, montos, garantías ni enlaces. Si este texto aún es el placeholder, sigue las instrucciones de turno que el sistema agrega al final.`;

/** Example config for the Skala workspace. `enabled` stays off until a human turns it on. */
export const SKALA_WORKSPACE_EXAMPLE = {
  engine: "skala" as const,
  enabled: false,
  bot_name: "Asistente de Skala",
  link_agenda: SKALA_LINK_AGENDA_EXAMPLE,
  link_demo: null as string | null,
  call_minutes: 20,
  garantia_activa: false,
  umbral_agenda: 55,
  umbral_prioritario: 75,
  seguimientos_max: 2,
  system_prompt: SKALA_SYSTEM_PROMPT_PLACEHOLDER,
};

export interface LeadProfile {
  rol: Rol;
  num_profesionales: number | null;
  multisede: boolean;
  consultas_whatsapp_dia: number | null;
  dolores: Dolor[];
  urgencia: boolean;
  ya_intento: boolean;
  agenda_digital: boolean;
  software_agenda: string | null;
  pide_demo: boolean;
  evasiones_pregunta_clave: number;
  solo_precio_se_niega: boolean;
  rubro_fuera: boolean;
  es_proveedor: boolean;
  es_paciente: boolean;
  es_contacto_conocido: boolean;
  pidio_humano: boolean;
  pidio_precio_veces: number;
  pregunta_legal_tecnica: boolean;
  molesto: boolean;
  tipo_clinica: string | null;
}

export interface QualifyConfig {
  link_agenda: string | null;
  link_demo?: string | null;
  umbral_agenda: number;
  umbral_prioritario: number;
  call_minutes: number;
  garantia_activa: boolean;
  bot_name: string;
  system_prompt: string;
}

export interface ScoreParts {
  rol: number;
  profesionales: number;
  consultas: number;
  dolores: number;
  urgencia: number;
  ya_intento: number;
  agenda_digital: number;
  pide_demo: number;
  evasiones: number;
  solo_precio: number;
  rubro_fuera: number;
}

export interface ScoreResult {
  score: number;
  parts: ScoreParts;
}

export interface LinkDecision {
  /** True only when this turn may include the booking URL. */
  send: boolean;
  /** Gate would pass, but link_agenda is empty. Never send a URL. */
  missingLink: boolean;
  /** Eligible to book, ignoring whether the URL is configured. */
  eligible: boolean;
  /** Explicit demo ask from a clinic decisor below the agenda threshold. */
  tagRevisar: boolean;
}

export interface Qualification {
  score: number;
  parts: ScoreParts;
  tier: Tier;
  route: RouteName | null;
  link: LinkDecision;
  handoff: { required: boolean; reasons: HandoffReason[] };
  pause: boolean;
  alert: boolean;
  tags: string[];
  stage: PipelineStage;
  nextStep: string;
  alertText: string;
}

const ROLES: readonly Rol[] = [
  "decisor",
  "influenciador",
  "otro",
  "desconocido",
];

export function emptyLeadProfile(): LeadProfile {
  return {
    rol: "desconocido",
    num_profesionales: null,
    multisede: false,
    consultas_whatsapp_dia: null,
    dolores: [],
    urgencia: false,
    ya_intento: false,
    agenda_digital: false,
    software_agenda: null,
    pide_demo: false,
    evasiones_pregunta_clave: 0,
    solo_precio_se_niega: false,
    rubro_fuera: false,
    es_proveedor: false,
    es_paciente: false,
    es_contacto_conocido: false,
    pidio_humano: false,
    pidio_precio_veces: 0,
    pregunta_legal_tecnica: false,
    molesto: false,
    tipo_clinica: null,
  };
}

function isRol(value: unknown): value is Rol {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function isDolor(value: unknown): value is Dolor {
  return (
    typeof value === "string" && (DOLORES as readonly string[]).includes(value)
  );
}

function intOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

export function coerceLeadProfile(raw: unknown): LeadProfile {
  const record =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const dolores = Array.isArray(record.dolores)
    ? record.dolores.filter(isDolor)
    : [];
  return {
    rol: isRol(record.rol) ? record.rol : "desconocido",
    num_profesionales: intOrNull(record.num_profesionales),
    multisede: bool(record.multisede),
    consultas_whatsapp_dia: intOrNull(record.consultas_whatsapp_dia),
    dolores: [...new Set(dolores)],
    urgencia: bool(record.urgencia),
    ya_intento: bool(record.ya_intento),
    agenda_digital: bool(record.agenda_digital),
    software_agenda: textOrNull(record.software_agenda),
    pide_demo: bool(record.pide_demo),
    evasiones_pregunta_clave: Math.max(
      0,
      intOrNull(record.evasiones_pregunta_clave) ?? 0,
    ),
    solo_precio_se_niega: bool(record.solo_precio_se_niega),
    rubro_fuera: bool(record.rubro_fuera),
    es_proveedor: bool(record.es_proveedor),
    es_paciente: bool(record.es_paciente),
    es_contacto_conocido: bool(record.es_contacto_conocido),
    pidio_humano: bool(record.pidio_humano),
    pidio_precio_veces: Math.max(0, intOrNull(record.pidio_precio_veces) ?? 0),
    pregunta_legal_tecnica: bool(record.pregunta_legal_tecnica),
    molesto: bool(record.molesto),
    tipo_clinica: textOrNull(record.tipo_clinica),
  };
}

/**
 * Merges an extraction into the stored profile.
 * Counters and "once true" flags only move forward. A later "desconocido"
 * does not wipe a role we already learned.
 */
export function mergeLeadProfile(
  prev: LeadProfile,
  patch: Partial<LeadProfile> | null | undefined,
): LeadProfile {
  const incoming = patch ?? {};
  const rol =
    incoming.rol && incoming.rol !== "desconocido" ? incoming.rol : prev.rol;
  const dolores = [
    ...new Set([...(prev.dolores ?? []), ...(incoming.dolores ?? [])]),
  ];
  const software =
    textOrNull(incoming.software_agenda) ?? prev.software_agenda;
  const tipo = textOrNull(incoming.tipo_clinica) ?? prev.tipo_clinica;
  return {
    rol,
    num_profesionales:
      incoming.num_profesionales != null
        ? incoming.num_profesionales
        : prev.num_profesionales,
    multisede: prev.multisede || incoming.multisede === true,
    consultas_whatsapp_dia:
      incoming.consultas_whatsapp_dia != null
        ? incoming.consultas_whatsapp_dia
        : prev.consultas_whatsapp_dia,
    dolores,
    urgencia: prev.urgencia || incoming.urgencia === true,
    ya_intento: prev.ya_intento || incoming.ya_intento === true,
    agenda_digital: prev.agenda_digital || incoming.agenda_digital === true,
    software_agenda: software,
    pide_demo: prev.pide_demo || incoming.pide_demo === true,
    evasiones_pregunta_clave: Math.max(
      prev.evasiones_pregunta_clave,
      incoming.evasiones_pregunta_clave ?? 0,
    ),
    solo_precio_se_niega:
      prev.solo_precio_se_niega || incoming.solo_precio_se_niega === true,
    rubro_fuera: prev.rubro_fuera || incoming.rubro_fuera === true,
    es_proveedor: prev.es_proveedor || incoming.es_proveedor === true,
    es_paciente: prev.es_paciente || incoming.es_paciente === true,
    es_contacto_conocido:
      prev.es_contacto_conocido || incoming.es_contacto_conocido === true,
    pidio_humano: prev.pidio_humano || incoming.pidio_humano === true,
    pidio_precio_veces: Math.max(
      prev.pidio_precio_veces,
      incoming.pidio_precio_veces ?? 0,
    ),
    pregunta_legal_tecnica:
      prev.pregunta_legal_tecnica || incoming.pregunta_legal_tecnica === true,
    molesto: prev.molesto || incoming.molesto === true,
    tipo_clinica: tipo,
  };
}

function profesionalesPoints(profile: LeadProfile): number {
  const count = profile.num_profesionales;
  if (profile.multisede || (count != null && count >= 16)) return 25;
  if (count == null || count <= 0) return 0;
  if (count === 1) return 5;
  if (count <= 5) return 15;
  if (count <= 15) return 20;
  return 25;
}

function consultasPoints(count: number | null): number {
  if (count == null || count < 5) return 0;
  if (count <= 15) return 10;
  if (count <= 40) return 15;
  return 20;
}

/** Score computed from the profile. There is no model-supplied score input. */
export function scoreLead(profile: LeadProfile): ScoreResult {
  const parts: ScoreParts = {
    rol:
      profile.rol === "decisor" ? 20 : profile.rol === "influenciador" ? 10 : 0,
    profesionales: profesionalesPoints(profile),
    consultas: consultasPoints(profile.consultas_whatsapp_dia),
    dolores: Math.min(new Set(profile.dolores).size, 2) * 10,
    urgencia: profile.urgencia ? 10 : 0,
    ya_intento: profile.ya_intento ? 5 : 0,
    agenda_digital: profile.agenda_digital ? 5 : 0,
    pide_demo: profile.pide_demo ? 10 : 0,
    evasiones: profile.evasiones_pregunta_clave >= 2 ? -10 : 0,
    solo_precio: profile.solo_precio_se_niega ? -10 : 0,
    rubro_fuera: profile.rubro_fuera ? -30 : 0,
  };
  const score = Object.values(parts).reduce((sum, value) => sum + value, 0);
  return { score, parts };
}

export function tierFor(
  score: number,
  config: Pick<QualifyConfig, "umbral_agenda" | "umbral_prioritario">,
): Tier {
  if (score >= config.umbral_prioritario) return "PRIORITARIO";
  if (score >= config.umbral_agenda) return "CALIFICADO";
  if (score >= REVISION_MIN && score < config.umbral_agenda) return "REVISION";
  return "NUTRIR";
}

/**
 * Decision order: proveedor, paciente, multisede, piloto, independiente, nutrir.
 * Returns null while the size of the clinic is still unknown.
 */
export function routeFor(profile: LeadProfile): RouteName | null {
  if (profile.es_proveedor) return "proveedor";
  if (profile.es_paciente) return "paciente";
  if (profile.rubro_fuera) return "nutrir";
  const count = profile.num_profesionales;
  if (profile.multisede || (count != null && count >= 16)) return "multisede";
  if (
    count != null &&
    count >= 2 &&
    count <= 15 &&
    !profile.multisede &&
    profile.dolores.length > 0
  ) {
    return "piloto";
  }
  if (
    count === 1 &&
    profile.consultas_whatsapp_dia != null &&
    profile.consultas_whatsapp_dia >= 5
  ) {
    return "independiente";
  }
  if (
    count === 1 &&
    profile.consultas_whatsapp_dia != null &&
    profile.consultas_whatsapp_dia < 5
  ) {
    return "nutrir";
  }
  return null;
}

function agendaUrl(config: Pick<QualifyConfig, "link_agenda">): string {
  return (config.link_agenda ?? "").trim();
}

function identityKnown(profile: LeadProfile): boolean {
  const tipo = Boolean(profile.tipo_clinica && profile.tipo_clinica.trim());
  const rolKnown =
    profile.rol === "decisor" ||
    profile.rol === "influenciador" ||
    profile.rol === "otro";
  const sizeKnown =
    profile.num_profesionales != null && profile.num_profesionales > 0;
  return tipo && (rolKnown || sizeKnown);
}

/**
 * Booking-link gate. `score` must be the value returned by `scoreLead`.
 * Never sends a link when link_agenda is empty.
 * Never sends a link below the agenda threshold unless the lead explicitly
 * asks for the call and is the decisor of a real clinic (tag revisar).
 */
export function decideLink(
  profile: LeadProfile,
  score: number,
  config: Pick<QualifyConfig, "link_agenda" | "umbral_agenda">,
): LinkDecision {
  if (
    profile.es_proveedor ||
    profile.es_paciente ||
    profile.rubro_fuera
  ) {
    return {
      send: false,
      missingLink: false,
      eligible: false,
      tagRevisar: false,
    };
  }

  const route = routeFor(profile);
  const tipo = Boolean(profile.tipo_clinica && profile.tipo_clinica.trim());
  const exception =
    profile.pide_demo &&
    profile.rol === "decisor" &&
    tipo &&
    score < config.umbral_agenda;
  // Nutrir does not get a call on its own. An explicit ask from the decisor
  // of a real clinic is the only under-threshold exception, and it is tagged
  // for human review.
  if (route === "nutrir" && !(exception && identityKnown(profile))) {
    return {
      send: false,
      missingLink: false,
      eligible: false,
      tagRevisar: false,
    };
  }
  const routeOk =
    route === "multisede" ||
    route === "piloto" ||
    route === "independiente" ||
    (route === "nutrir" && exception);
  const normal =
    score >= config.umbral_agenda && identityKnown(profile) && routeOk;
  const eligible = normal || (exception && identityKnown(profile));
  if (!eligible) {
    return {
      send: false,
      missingLink: false,
      eligible: false,
      tagRevisar: false,
    };
  }

  const tagRevisar = exception;
  if (!agendaUrl(config)) {
    return { send: false, missingLink: true, eligible: true, tagRevisar };
  }
  return { send: true, missingLink: false, eligible: true, tagRevisar };
}

export function handoffReasons(input: {
  profile: LeadProfile;
  score: number;
  tier: Tier;
  route: RouteName | null;
  link: LinkDecision;
  config: Pick<QualifyConfig, "umbral_agenda" | "umbral_prioritario">;
}): HandoffReason[] {
  if (input.profile.es_proveedor || input.profile.es_paciente) return [];

  const reasons: HandoffReason[] = [];
  if (input.profile.es_contacto_conocido) reasons.push("contacto_conocido");
  if (input.profile.pidio_humano) reasons.push("humano");
  if (input.profile.molesto) reasons.push("molesto");
  if (input.profile.pregunta_legal_tecnica) reasons.push("legal");

  if (!input.profile.rubro_fuera) {
    if (input.route === "multisede") reasons.push("multisede");
    if (input.score >= input.config.umbral_prioritario) {
      reasons.push("prioritario");
    }
    if (
      input.score >= input.config.umbral_agenda &&
      input.profile.pidio_precio_veces >= 2
    ) {
      reasons.push("precio");
    }
    if (input.tier === "REVISION") reasons.push("revision");
  }

  if (input.link.missingLink) reasons.push("sin_link");
  return reasons;
}

export function suggestNextStep(
  profile: LeadProfile,
  qualification: Pick<
    Qualification,
    "link" | "tier" | "route" | "handoff" | "stage"
  >,
  callMinutes: number,
): string {
  if (profile.es_proveedor) return "Cerrar con cortesía. No agendar.";
  if (profile.es_paciente) {
    return "Redirigir: Skala trabaja con clínicas, no con pacientes. No pedir datos de salud.";
  }
  if (profile.es_contacto_conocido && !qualification.link.send) {
    return "No calificar. Avisar que el equipo le escribe.";
  }
  if (qualification.link.send) {
    return `Enviar el link de la llamada de ${callMinutes} minutos.`;
  }
  if (qualification.link.missingLink) {
    return "No hay link de agenda configurado. Pasar a un humano, sin inventar un enlace.";
  }
  if (!profile.tipo_clinica) {
    return "¿Tu clínica es dental, de estética o de fisioterapia?";
  }
  if (profile.rol === "desconocido" && profile.num_profesionales == null) {
    return "¿Tú tomas las decisiones de la clínica y cuántos profesionales atienden?";
  }
  if (profile.num_profesionales == null) {
    return "¿Cuántos profesionales atienden en la clínica?";
  }
  if (profile.consultas_whatsapp_dia == null) {
    return "¿Cuántas consultas les llegan por WhatsApp en un día normal?";
  }
  if (profile.dolores.length === 0 && !profile.multisede) {
    return "¿Qué les pasa hoy con WhatsApp: mensajes fuera de horario, demoras de más de una hora, recepción saturada o inasistencias?";
  }
  if (qualification.route === "nutrir" || qualification.tier === "NUTRIR") {
    return "Cerrar con amabilidad, sin ofrecer una llamada.";
  }
  if (qualification.handoff.required) return "Pasar a un humano y pausar el bot.";
  return "Hacer una sola pregunta para completar la calificación.";
}

export function formatSetterAlert(input: {
  route: RouteName | null;
  profile: LeadProfile;
  score: number;
  booked: boolean;
  nextStep: string;
}): string {
  const ruta = input.route ?? "calificando";
  const tipo = input.profile.tipo_clinica?.trim() || "—";
  const prof =
    input.profile.num_profesionales == null
      ? "—"
      : String(input.profile.num_profesionales);
  const consultas =
    input.profile.consultas_whatsapp_dia == null
      ? "—"
      : String(input.profile.consultas_whatsapp_dia);
  const dolor = input.profile.dolores[0]
    ? DOLOR_LABEL[input.profile.dolores[0]]
    : "—";
  const software = input.profile.software_agenda?.trim() || "—";
  const urgencia = input.profile.urgencia ? "sí" : "no";
  const estado = input.booked ? "agendado" : "no";
  return [
    `🔔 Lead ${ruta} · ${tipo} · ${prof} prof. · ${consultas} consultas/día`,
    `Dolor: ${dolor} · Software: ${software} · Urgencia: ${urgencia}`,
    `Score ${input.score} · Estado: ${estado} · Canal: WA`,
    `Siguiente paso sugerido: ${input.nextStep}`,
  ].join("\n");
}

export function tagsFor(input: {
  route: RouteName | null;
  tier: Tier;
  link: LinkDecision;
}): string[] {
  const tags: string[] = [];
  if (input.route) tags.push(input.route);
  if (input.tier === "PRIORITARIO") tags.push("prioritario");
  if (
    input.tier === "REVISION" ||
    input.link.tagRevisar ||
    input.link.missingLink
  ) {
    tags.push("revisar");
  }
  return tags;
}

export function pipelineStageFor(input: {
  current: PipelineStage;
  route: RouteName | null;
  tier: Tier;
  linkSend: boolean;
  handoff: boolean;
  rubroFuera: boolean;
  proveedor: boolean;
  paciente: boolean;
}): PipelineStage {
  if (input.current === "CLIENTE" || input.current === "AGENDADO") {
    return input.current;
  }
  if (input.linkSend) return "LINK_ENVIADO";
  if (input.current === "LINK_ENVIADO") return "LINK_ENVIADO";
  if (input.proveedor) return "PERDIDO";
  if (input.paciente || input.route === "nutrir" || input.rubroFuera) {
    return "NUTRIR";
  }
  if (input.handoff || input.tier === "REVISION") return "REVISION";
  return "CALIFICANDO";
}

export function qualify(
  profile: LeadProfile,
  config: QualifyConfig,
  options?: { currentStage?: PipelineStage; booked?: boolean },
): Qualification {
  const current = options?.currentStage ?? "NUEVO";
  const booked = options?.booked ?? current === "AGENDADO";
  const { score, parts } = scoreLead(profile);
  const route = routeFor(profile);
  const tier = profile.rubro_fuera
    ? "NUTRIR"
    : profile.es_proveedor || profile.es_paciente
      ? "NUTRIR"
      : tierFor(score, config);
  const link = decideLink(profile, score, config);
  const reasons = handoffReasons({
    profile,
    score,
    tier,
    route,
    link,
    config,
  });
  const handoff = { required: reasons.length > 0, reasons };
  const stage = pipelineStageFor({
    current,
    route,
    tier,
    linkSend: link.send,
    handoff: handoff.required,
    rubroFuera: profile.rubro_fuera,
    proveedor: profile.es_proveedor,
    paciente: profile.es_paciente,
  });
  const pause =
    (stage === "NUTRIR" || stage === "PERDIDO") && !handoff.required;
  const alert =
    handoff.required || tier === "PRIORITARIO" || route === "multisede";
  const partial = {
    link,
    tier,
    route,
    handoff,
    stage,
  };
  const nextStep = suggestNextStep(profile, partial, config.call_minutes);
  const alertText = formatSetterAlert({
    route,
    profile,
    score,
    booked,
    nextStep,
  });
  return {
    score,
    parts,
    tier,
    route,
    link,
    handoff,
    pause,
    alert,
    tags: tagsFor({ route, tier, link }),
    stage,
    nextStep,
    alertText,
  };
}

export function buildTurnDirective(input: {
  config: QualifyConfig;
  profile: LeadProfile;
  qualification: Qualification;
  formality: "tu" | "usted";
}): string {
  const { config, profile, qualification, formality } = input;
  const trato = formality === "usted" ? "usted" : "tú";
  const url = agendaUrl(config);
  const linkLine = qualification.link.send
    ? `Puedes enviar este enlace de agenda, una sola vez, en su propia línea:\n${url}`
    : "NO envíes ningún enlace ni URL. Si lo piden, di que alguien del equipo les escribe. No inventes un enlace.";
  const garantia = config.garantia_activa
    ? "La garantía está activa. Menciónala solo si el prompt del workspace la describe."
    : "La garantía NO está activa. No menciones garantías ni promesas de resultado.";

  let instruction: string;
  if (profile.es_proveedor) {
    instruction =
      "Cierra con cortesía en una o dos líneas. No hagas preguntas de calificación, no ofrezcas llamada ni enlace.";
  } else if (profile.es_paciente) {
    instruction =
      "Aclara con amabilidad que Skala trabaja con clínicas, no con pacientes. No pidas síntomas ni datos de salud. No ofrezcas llamada ni enlace.";
  } else if (profile.es_contacto_conocido && !qualification.link.send) {
    instruction =
      "Saluda breve y no hagas preguntas de calificación. Di que alguien del equipo le escribe. No digas que eres Sky.";
  } else if (qualification.link.send && url) {
    instruction = `Invita a una llamada de ${config.call_minutes} minutos con Sky e incluye exactamente este enlace, una sola vez:\n${url}\nNo inventes otro enlace.`;
  } else if (
    qualification.link.missingLink ||
    (qualification.handoff.required && !qualification.link.send)
  ) {
    instruction =
      "No envíes ningún enlace. Di en una línea que alguien del equipo le escribe. Como máximo una pregunta.";
  } else if (qualification.pause || qualification.stage === "NUTRIR") {
    instruction =
      "Cierra con amabilidad, sin ofrecer una llamada ni un enlace. No hagas una pregunta de venta.";
  } else {
    instruction = `Haz una sola pregunta y ninguna más: ${qualification.nextStep}`;
  }

  const profileLines = [
    `Rol: ${profile.rol}`,
    `Tipo de clínica: ${profile.tipo_clinica ?? "desconocido"}`,
    `Profesionales: ${profile.num_profesionales ?? "desconocido"}`,
    `Multisede: ${profile.multisede ? "sí" : "no"}`,
    `Consultas WhatsApp/día: ${profile.consultas_whatsapp_dia ?? "desconocido"}`,
    `Dolores: ${profile.dolores.join(", ") || "ninguno"}`,
    `Score interno (no lo menciones): ${qualification.score}`,
    `Ruta: ${qualification.route ?? "calificando"}`,
  ];

  return [
    "## Prompt del workspace",
    config.system_prompt.trim(),
    "## Identidad de este turno",
    `Te llamas ${config.bot_name}. Eres una inteligencia artificial. Si te preguntan, lo dices. No eres Sky y no eres una persona.`,
    "## Trato",
    `Habla en español neutro, sin jerga. En este mensaje usa ${trato}.`,
    "## Hechos",
    `La llamada dura ${config.call_minutes} minutos y es con Sky.`,
    garantia,
    linkLine,
    "## Perfil ya conocido",
    profileLines.join("\n"),
    "## Qué hacer en este mensaje",
    instruction,
    "## Formato obligatorio",
    "Máximo 3 líneas cortas. Una sola pregunta. Sin precios, montos ni monedas. Sin afirmar que eres humano o que eres Sky.",
  ].join("\n\n");
}

const PRICE_LINE =
  /(?:(?:usd|clp|eur|uf|€|\$)\s?\d[\d.]*(?:,\d+)?)|(?:\d[\d.]*(?:,\d+)?\s?(?:usd|clp|pesos|d[oó]lares|euros|uf)\b)/i;

const HUMAN_CLAIM =
  /\b(?:soy|me llamo|habla)\s+sky\b|\bsoy\s+(?:un\s+|una\s+)?(?:humano|humana|persona|asesor|asesora)\b|\bno soy (?:un |una )?(?:bot|robot|ia|inteligencia artificial)\b/i;

const URL_RE = /https?:\/\/[^\s)]+/gi;

export function enforceSetterGuardrails(
  text: string,
  options: {
    allowLink: boolean;
    linkAgenda: string | null;
    linkDemo?: string | null;
    botName: string;
    fallback?: string;
  },
): { text: string; removed: string[] } {
  const removed: string[] = [];
  let body = text.replace(/\r\n/g, "\n").trim();

  if (HUMAN_CLAIM.test(body)) {
    removed.push("human_claim");
    body = `Soy ${options.botName}, una inteligencia artificial.`;
  }

  const keptLines: string[] = [];
  for (const line of body.split("\n")) {
    if (PRICE_LINE.test(line)) {
      removed.push("price");
      continue;
    }
    const trimmed = line.trim();
    if (trimmed) keptLines.push(trimmed);
  }
  body = keptLines.join("\n");

  const agenda = (options.linkAgenda ?? "").trim();
  const demo = (options.linkDemo ?? "").trim();
  const found = body.match(URL_RE) ?? [];
  body = body.replace(URL_RE, "").replace(/[ \t]{2,}/g, " ").trim();
  const allowedUrls: string[] = [];
  if (options.allowLink) {
    for (const raw of found) {
      const clean = raw.replace(/[.,;]+$/, "");
      if (
        (agenda && clean.startsWith(agenda)) ||
        (demo && clean.startsWith(demo))
      ) {
        if (!allowedUrls.includes(clean)) allowedUrls.push(clean);
      } else {
        removed.push("url");
      }
    }
    if (agenda && !allowedUrls.some((url) => url.startsWith(agenda))) {
      allowedUrls.push(agenda);
    }
  } else if (found.length > 0) {
    removed.push("url");
  }

  const questionAt = body.indexOf("?");
  if (questionAt !== -1) {
    const rest = body.slice(questionAt + 1);
    if (rest.includes("?")) {
      removed.push("extra_question");
      body = body.slice(0, questionAt + 1).trim();
    }
  }

  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => (line.length > 280 ? line.slice(0, 280).trim() : line));
  body = lines.join("\n");

  if (!body) {
    body =
      options.fallback ??
      "¿Me cuentas un poco más de tu clínica?";
  }

  if (options.allowLink && allowedUrls.length > 0) {
    const missing = allowedUrls.filter((url) => !body.includes(url));
    if (missing.length > 0) body = `${body}\n${missing.join("\n")}`;
  }

  return { text: body.trim(), removed };
}

export type Formality = "tu" | "usted";

export function formalityFromText(text: string): Formality {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
  if (/\busted\b/.test(normalized) || /\bdr\.?\b/.test(normalized) || /\bdra\.?\b/.test(normalized)) {
    return "usted";
  }
  return "tu";
}

export function nextFormality(prev: Formality, inbound: string): Formality {
  if (prev === "usted") return "usted";
  return formalityFromText(inbound);
}

function normalizeInbound(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[!?.]+$/g, "")
    .trim();
}

const OPT_OUT_RE =
  /no me escribas|no me contactes|no me hables mas|deja de escribir|no quiero mas mensajes|darme de baja|unsubscribe|\bstop\b/;

const NO_EXACT = new Set([
  "no",
  "nop",
  "nope",
  "no gracias",
  "no, gracias",
  "no me interesa",
  "ahora no",
  "despues no",
  "paso",
  "nel",
]);

export function classifyInboundReply(text: string): {
  optOut: boolean;
  no: boolean;
} {
  const normalized = normalizeInbound(text);
  return {
    optOut: OPT_OUT_RE.test(normalized),
    no: NO_EXACT.has(normalized),
  };
}

/** True only inside an open Meta 24h window. A null window is closed. */
export function isWindowOpen(
  windowExpiresAt: string | null,
  now: Date,
): boolean {
  if (!windowExpiresAt) return false;
  const expires = new Date(windowExpiresAt).getTime();
  if (Number.isNaN(expires)) return false;
  return now.getTime() <= expires;
}

export const FOLLOWUP_MIN_GAP_MS = 3 * 60 * 60 * 1000;

const FOLLOWUP_STAGES = new Set<PipelineStage>([
  "NUEVO",
  "CALIFICANDO",
  "LINK_ENVIADO",
]);

export function shouldSendFollowUp(input: {
  seguimientosMax: number;
  followupCount: number;
  noCount: number;
  optedOut: boolean;
  waitingOnLead: boolean;
  windowExpiresAt: string | null;
  lastOutboundAt: string | null;
  now: Date;
  state: string;
  stage: PipelineStage | null;
}): { send: boolean; reason: string } {
  if (input.state !== "ai_active") return { send: false, reason: "not_active" };
  if (input.optedOut) return { send: false, reason: "opt_out" };
  if (input.noCount >= 2) return { send: false, reason: "two_nos" };
  if (input.followupCount >= input.seguimientosMax) {
    return { send: false, reason: "max_reached" };
  }
  if (!input.stage || !FOLLOWUP_STAGES.has(input.stage)) {
    return { send: false, reason: "terminal_stage" };
  }
  if (!isWindowOpen(input.windowExpiresAt, input.now)) {
    return { send: false, reason: "window_closed" };
  }
  if (!input.waitingOnLead) return { send: false, reason: "not_waiting" };
  if (!input.lastOutboundAt) return { send: false, reason: "no_outbound" };
  const elapsed = input.now.getTime() - new Date(input.lastOutboundAt).getTime();
  if (elapsed < FOLLOWUP_MIN_GAP_MS) return { send: false, reason: "too_soon" };
  return { send: true, reason: "ok" };
}

export function followUpMessage(botName: string, formality: Formality): string {
  const clinic = formality === "usted" ? "su clínica" : "tu clínica";
  return `Hola, soy ${botName}, una inteligencia artificial.\n¿Seguimos con lo de ${clinic} o lo dejamos por ahora?`;
}

export function contactStageFor(
  pipeline: PipelineStage,
  current: string | null,
): string | null {
  if (current === "customer" && pipeline !== "CLIENTE") return null;
  switch (pipeline) {
    case "NUEVO":
      return "new";
    case "CALIFICANDO":
    case "REVISION":
    case "NUTRIR":
      return "engaged";
    case "LINK_ENVIADO":
    case "AGENDADO":
      return "qualified";
    case "CLIENTE":
      return "customer";
    case "PERDIDO":
      return "lost";
    default:
      return null;
  }
}

export function isPipelineStage(value: unknown): value is PipelineStage {
  return (
    typeof value === "string" &&
    (PIPELINE_STAGES as readonly string[]).includes(value)
  );
}
