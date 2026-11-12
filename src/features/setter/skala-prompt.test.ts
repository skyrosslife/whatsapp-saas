import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SKALA_LINK_AGENDA_EXAMPLE } from "./qualify";
import {
  SKALA_SYSTEM_PROMPT,
  renderSkalaSystemPrompt,
} from "./skala-prompt";

const vars = {
  bot_name: "Asistente de Skala",
  link_agenda: SKALA_LINK_AGENDA_EXAMPLE,
  link_demo: null as string | null,
  call_minutes: 20,
  garantia_activa: false,
};

describe("Skala system prompt", () => {
  it("matches the committed template and does not ask the model to score", () => {
    const disk = readFileSync("docs/setter/skala/SYSTEM_PROMPT.txt", "utf8");
    assert.equal(disk, SKALA_SYSTEM_PROMPT);
    assert.equal(SKALA_SYSTEM_PROMPT.includes("###DATOS###"), false);
    assert.equal(SKALA_SYSTEM_PROMPT.includes("+20 decisor"), false);
    assert.match(SKALA_SYSTEM_PROMPT, /No calcules puntajes/);
  });

  it("injects runtime values and withholds the link unless the gate allows it", () => {
    const blocked = renderSkalaSystemPrompt(SKALA_SYSTEM_PROMPT, vars, false);
    assert.match(blocked, /Asistente de Skala/);
    assert.match(blocked, /20 minutos/);
    assert.match(blocked, /garantía no está activa/i);
    assert.equal(blocked.includes("segundo mes"), false);
    assert.equal(blocked.includes("http"), false);
    assert.equal(blocked.includes("cal.com"), false);
    assert.equal(blocked.includes("{{LINK_AGENDA}}"), false);
    assert.equal(blocked.includes("{{bot_name}}"), false);

    const allowed = renderSkalaSystemPrompt(SKALA_SYSTEM_PROMPT, vars, true);
    assert.ok(allowed.includes(SKALA_LINK_AGENDA_EXAMPLE));

    const withGuarantee = renderSkalaSystemPrompt(
      SKALA_SYSTEM_PROMPT,
      { ...vars, garantia_activa: true, link_demo: "https://demo.example/clinica" },
      true,
    );
    assert.match(withGuarantee, /segundo mes no se cobra/);
    assert.ok(withGuarantee.includes("https://demo.example/clinica"));
  });

  it("replaces a leftover placeholder with the Skala template before rendering", () => {
    const rendered = renderSkalaSystemPrompt(
      "PLACEHOLDER — reemplaza este texto",
      { ...vars, link_agenda: null },
      true,
    );
    assert.match(rendered, /Asistente de Skala/);
    assert.equal(rendered.includes("http"), false);
  });
});
