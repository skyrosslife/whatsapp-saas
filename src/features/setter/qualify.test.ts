import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SKALA_LINK_AGENDA_EXAMPLE,
  SKALA_WORKSPACE_EXAMPLE,
  buildTurnDirective,
  classifyInboundReply,
  decideLink,
  emptyLeadProfile,
  enforceSetterGuardrails,
  followUpMessage,
  formalityFromText,
  isWindowOpen,
  mergeLeadProfile,
  qualify,
  scoreLead,
  shouldSendFollowUp,
  tierFor,
  type LeadProfile,
  type QualifyConfig,
} from "./qualify";

const THRESHOLDS = {
  umbral_agenda: 55,
  umbral_prioritario: 75,
};

function config(link: string | null): QualifyConfig {
  return {
    ...THRESHOLDS,
    link_agenda: link,
    link_demo: null,
    call_minutes: 20,
    garantia_activa: false,
    bot_name: "Asistente de Skala",
    system_prompt: "PROMPT",
  };
}

function profile(patch: Partial<LeadProfile>): LeadProfile {
  return { ...emptyLeadProfile(), ...patch };
}

const dental = profile({
  rol: "decisor",
  num_profesionales: 4,
  multisede: false,
  consultas_whatsapp_dia: 20,
  dolores: ["fuera_de_horario"],
  tipo_clinica: "dental",
});

const multisede = profile({
  rol: "decisor",
  num_profesionales: 20,
  multisede: true,
  consultas_whatsapp_dia: 30,
  dolores: ["fuera_de_horario", "no_shows"],
  urgencia: true,
  tipo_clinica: "estetica",
  software_agenda: "Dentalink",
});

const physio = profile({
  rol: "decisor",
  num_profesionales: 1,
  consultas_whatsapp_dia: 3,
  tipo_clinica: "fisioterapia",
});

describe("scoreLead", () => {
  it("scores a dental owner from the profile, ignoring any extra score field", () => {
    const result = scoreLead({ ...dental, score: 1 } as LeadProfile);
    assert.equal(result.score, 60);
    assert.equal(result.parts.rol, 20);
    assert.equal(result.parts.profesionales, 15);
    assert.equal(result.parts.consultas, 15);
    assert.equal(result.parts.dolores, 10);
  });

  it("caps pains at +20 and gives multisede the 16+ band once", () => {
    const result = scoreLead(
      profile({
        multisede: true,
        num_profesionales: 40,
        dolores: ["fuera_de_horario", "demora_mas_1h", "no_shows"],
      }),
    );
    assert.equal(result.parts.profesionales, 25);
    assert.equal(result.parts.dolores, 20);
  });

  it("applies the documented penalties", () => {
    const result = scoreLead(
      profile({
        rol: "decisor",
        evasiones_pregunta_clave: 2,
        solo_precio_se_niega: true,
        rubro_fuera: true,
      }),
    );
    assert.equal(result.parts.evasiones, -10);
    assert.equal(result.parts.solo_precio, -10);
    assert.equal(result.parts.rubro_fuera, -30);
    assert.equal(result.score, 20 - 50);
  });
});

describe("tiers", () => {
  it("uses the 35 / 55 / 75 cuts", () => {
    assert.equal(tierFor(34, THRESHOLDS), "NUTRIR");
    assert.equal(tierFor(35, THRESHOLDS), "REVISION");
    assert.equal(tierFor(54, THRESHOLDS), "REVISION");
    assert.equal(tierFor(55, THRESHOLDS), "CALIFICADO");
    assert.equal(tierFor(74, THRESHOLDS), "CALIFICADO");
    assert.equal(tierFor(75, THRESHOLDS), "PRIORITARIO");
  });
});

describe("required scenarios", () => {
  it("dental owner with 4 professionals, 20 msgs/day and after-hours pain is CALIFICADO and gets the link", () => {
    const result = qualify(dental, config(SKALA_LINK_AGENDA_EXAMPLE));
    assert.equal(result.score, 60);
    assert.equal(result.tier, "CALIFICADO");
    assert.equal(result.route, "piloto");
    assert.equal(result.link.send, true);
    assert.equal(result.link.missingLink, false);
    assert.equal(result.stage, "LINK_ENVIADO");
  });

  it("a multisede center is PRIORITARIO and raises an alert", () => {
    const result = qualify(multisede, config(SKALA_LINK_AGENDA_EXAMPLE));
    assert.equal(result.score, 90);
    assert.equal(result.tier, "PRIORITARIO");
    assert.equal(result.route, "multisede");
    assert.equal(result.link.send, true);
    assert.equal(result.handoff.required, true);
    assert.ok(result.handoff.reasons.includes("prioritario"));
    assert.ok(result.handoff.reasons.includes("multisede"));
    assert.equal(result.alert, true);
    assert.match(result.alertText, /^🔔 Lead multisede · estetica · 20 prof\. · 30 consultas\/día/);
    assert.match(result.alertText, /Dolor: fuera de horario · Software: Dentalink · Urgencia: sí/);
    assert.match(result.alertText, /Score 90 · Estado: no · Canal: WA/);
    assert.match(result.alertText, /Siguiente paso sugerido:/);
  });

  it("a solo physio with 3 msgs/day is NUTRIR and is not offered a call", () => {
    const result = qualify(physio, config(SKALA_LINK_AGENDA_EXAMPLE));
    assert.equal(result.score, 25);
    assert.equal(result.tier, "NUTRIR");
    assert.equal(result.route, "nutrir");
    assert.equal(result.link.send, false);
    assert.equal(result.pause, true);
    assert.equal(result.stage, "NUTRIR");
    assert.equal(result.alert, false);
  });

  it("a second price ask while qualified hands off", () => {
    const once = qualify(
      profile({ ...dental, pidio_precio_veces: 1 }),
      config(SKALA_LINK_AGENDA_EXAMPLE),
    );
    assert.equal(once.handoff.reasons.includes("precio"), false);

    const twice = qualify(
      profile({ ...dental, pidio_precio_veces: 2 }),
      config(SKALA_LINK_AGENDA_EXAMPLE),
    );
    assert.equal(twice.tier, "CALIFICADO");
    assert.equal(twice.handoff.required, true);
    assert.ok(twice.handoff.reasons.includes("precio"));
    assert.equal(twice.alert, true);
  });

  it("a vendor is discarded as proveedor and never gets a link", () => {
    const result = qualify(
      profile({
        ...multisede,
        es_proveedor: true,
      }),
      config(SKALA_LINK_AGENDA_EXAMPLE),
    );
    assert.equal(result.route, "proveedor");
    assert.equal(result.link.send, false);
    assert.equal(result.link.eligible, false);
    assert.equal(result.handoff.required, false);
    assert.equal(result.alert, false);
    assert.equal(result.stage, "PERDIDO");
    assert.equal(result.pause, true);
  });

  it("an empty link_agenda never sends a link and hands the lead to a human", () => {
    for (const link of [null, "", "   "]) {
      const result = qualify(dental, config(link));
      assert.equal(result.link.eligible, true);
      assert.equal(result.link.send, false);
      assert.equal(result.link.missingLink, true);
      assert.ok(result.handoff.reasons.includes("sin_link"));
      assert.equal(result.stage, "REVISION");
      const directive = buildTurnDirective({
        config: config(link),
        profile: dental,
        qualification: result,
        formality: "tu",
      });
      assert.equal(directive.includes("http"), false);
      assert.equal(directive.includes("cal.com"), false);
    }
  });
});

describe("link gate", () => {
  it("documents the Skala workspace booking link", () => {
    assert.equal(
      SKALA_WORKSPACE_EXAMPLE.link_agenda,
      "https://cal.com/sky-ross/diagnostico-skala",
    );
    assert.equal(SKALA_WORKSPACE_EXAMPLE.call_minutes, 20);
    assert.equal(SKALA_WORKSPACE_EXAMPLE.enabled, false);
  });

  it("sends below 55 only when a clinic decisor explicitly asks for the call", () => {
    const asking = profile({
      rol: "decisor",
      tipo_clinica: "dental",
      pide_demo: true,
    });
    const result = qualify(asking, config(SKALA_LINK_AGENDA_EXAMPLE));
    assert.ok(result.score < 55);
    assert.equal(result.link.send, true);
    assert.equal(result.link.tagRevisar, true);
    assert.ok(result.tags.includes("revisar"));

    const influencer = qualify(
      profile({ ...asking, rol: "influenciador" }),
      config(SKALA_LINK_AGENDA_EXAMPLE),
    );
    assert.equal(influencer.link.send, false);

    const nurtureAsk = qualify(
      profile({ ...physio, pide_demo: true }),
      config(SKALA_LINK_AGENDA_EXAMPLE),
    );
    assert.equal(nurtureAsk.route, "nutrir");
    assert.ok(nurtureAsk.score < 55);
    assert.equal(nurtureAsk.link.send, true);
    assert.equal(nurtureAsk.link.tagRevisar, true);

    const blocked = decideLink(dental, 54, config(SKALA_LINK_AGENDA_EXAMPLE));
    assert.equal(blocked.send, false);
    const allowed = decideLink(dental, 55, config(SKALA_LINK_AGENDA_EXAMPLE));
    assert.equal(allowed.send, true);
  });

  it("requires clinic type and role or headcount before a normal link", () => {
    const noType = qualify(
      profile({ ...dental, tipo_clinica: null }),
      config(SKALA_LINK_AGENDA_EXAMPLE),
    );
    assert.equal(noType.score >= 55, true);
    assert.equal(noType.link.send, false);

    const noIdentity = qualify(
      profile({
        tipo_clinica: "dental",
        rol: "desconocido",
        num_profesionales: null,
        dolores: ["fuera_de_horario"],
        consultas_whatsapp_dia: 40,
        urgencia: true,
        ya_intento: true,
        agenda_digital: true,
        pide_demo: true,
      }),
      config(SKALA_LINK_AGENDA_EXAMPLE),
    );
    assert.equal(noIdentity.link.send, false);
  });

  it("routes an independent professional only onto a call at the agenda threshold", () => {
    const low = qualify(
      profile({
        rol: "decisor",
        num_profesionales: 1,
        consultas_whatsapp_dia: 8,
        tipo_clinica: "fisioterapia",
      }),
      config(SKALA_LINK_AGENDA_EXAMPLE),
    );
    assert.equal(low.route, "independiente");
    assert.ok(low.score < 55);
    assert.equal(low.link.send, false);

    const ready = qualify(
      profile({
        rol: "decisor",
        num_profesionales: 1,
        consultas_whatsapp_dia: 10,
        dolores: ["fuera_de_horario", "no_shows"],
        urgencia: true,
        tipo_clinica: "fisioterapia",
      }),
      config(SKALA_LINK_AGENDA_EXAMPLE),
    );
    assert.equal(ready.route, "independiente");
    assert.ok(ready.score >= 55);
    assert.equal(ready.link.send, true);
  });
});

describe("guardrails", () => {
  it("strips prices, extra questions, human claims and links the gate did not allow", () => {
    const priced = enforceSetterGuardrails(
      "El plan cuesta $199 dólares al mes.\n¿Te agendo?\n¿Quieres otro horario?",
      {
        allowLink: false,
        linkAgenda: SKALA_LINK_AGENDA_EXAMPLE,
        botName: "Asistente de Skala",
      },
    );
    assert.equal(priced.text.includes("$"), false);
    assert.equal(priced.text.toLowerCase().includes("dólares"), false);
    assert.equal(priced.text.split("?").length - 1, 1);
    assert.ok(priced.removed.includes("price"));

    const claim = enforceSetterGuardrails("Soy Sky, te ayudo yo mismo.", {
      allowLink: false,
      linkAgenda: null,
      botName: "Asistente de Skala",
    });
    assert.match(claim.text, /inteligencia artificial/i);
    assert.equal(/\bsoy sky\b/i.test(claim.text), false);

    const leaked = enforceSetterGuardrails(
      `Te dejo el link ${SKALA_LINK_AGENDA_EXAMPLE}`,
      {
        allowLink: false,
        linkAgenda: SKALA_LINK_AGENDA_EXAMPLE,
        botName: "Asistente de Skala",
      },
    );
    assert.equal(leaked.text.includes("http"), false);
    assert.equal(leaked.text.includes("cal.com"), false);
  });

  it("appends the configured booking link only when the gate allows it", () => {
    const sent = enforceSetterGuardrails("¿Agendamos la llamada de 20 minutos?", {
      allowLink: true,
      linkAgenda: SKALA_LINK_AGENDA_EXAMPLE,
      botName: "Asistente de Skala",
    });
    assert.ok(sent.text.includes(SKALA_LINK_AGENDA_EXAMPLE));
    assert.equal(sent.text.split("?").length - 1, 1);
  });
});

describe("follow-ups and formality", () => {
  const now = new Date("2026-11-12T15:00:00.000Z");
  const open = "2026-11-12T20:00:00.000Z";
  const base = {
    seguimientosMax: 2,
    followupCount: 0,
    noCount: 0,
    optedOut: false,
    waitingOnLead: true,
    windowExpiresAt: open,
    lastOutboundAt: "2026-11-12T10:00:00.000Z",
    now,
    state: "ai_active",
    stage: "CALIFICANDO" as const,
  };

  it("sends at most two follow-ups, inside the 24h window, and stops after two nos or an opt-out", () => {
    assert.equal(shouldSendFollowUp(base).send, true);
    assert.equal(
      shouldSendFollowUp({ ...base, followupCount: 2 }).reason,
      "max_reached",
    );
    assert.equal(shouldSendFollowUp({ ...base, noCount: 2 }).reason, "two_nos");
    assert.equal(
      shouldSendFollowUp({ ...base, optedOut: true }).reason,
      "opt_out",
    );
    assert.equal(
      shouldSendFollowUp({ ...base, windowExpiresAt: null }).reason,
      "window_closed",
    );
    assert.equal(
      shouldSendFollowUp({
        ...base,
        windowExpiresAt: "2026-11-12T14:00:00.000Z",
      }).reason,
      "window_closed",
    );
    assert.equal(
      shouldSendFollowUp({
        ...base,
        lastOutboundAt: "2026-11-12T14:00:00.000Z",
      }).reason,
      "too_soon",
    );
    assert.equal(isWindowOpen(open, now), true);
    assert.equal(isWindowOpen(null, now), false);
  });

  it("treats a short no as a no, and a longer sentence as conversation", () => {
    assert.equal(classifyInboundReply("No, gracias.").no, true);
    assert.equal(classifyInboundReply("No me escribas más").optOut, true);
    assert.equal(
      classifyInboundReply("No, tengo 4 profesionales en la clínica").no,
      false,
    );
  });

  it("uses usted for Dr./Dra. or when the lead uses usted", () => {
    assert.equal(formalityFromText("Hola, soy la Dra. Pérez"), "usted");
    assert.equal(formalityFromText("¿Usted puede ayudarme?"), "usted");
    assert.equal(formalityFromText("Hola, tengo una clínica"), "tu");
    const message = followUpMessage("Asistente de Skala", "tu");
    assert.equal(message.includes("http"), false);
    assert.equal(message.split("?").length - 1, 1);
  });
});

describe("mergeLeadProfile", () => {
  it("keeps learned facts when a later extraction is empty", () => {
    const merged = mergeLeadProfile(dental, {
      rol: "desconocido",
      dolores: ["no_shows"],
      evasiones_pregunta_clave: 1,
      num_profesionales: null,
    });
    assert.equal(merged.rol, "decisor");
    assert.deepEqual(merged.dolores, ["fuera_de_horario", "no_shows"]);
    assert.equal(merged.num_profesionales, 4);
    assert.equal(merged.evasiones_pregunta_clave, 1);
  });
});
