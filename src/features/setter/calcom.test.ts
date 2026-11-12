import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  matchingCalcomSecret,
  parseCalcomBooking,
  phonesMatch,
  stageAfterBooking,
  verifyCalcomSignature,
} from "./calcom";

function sign(raw: string, secret: string): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

describe("Cal.com signature", () => {
  const raw = JSON.stringify({ triggerEvent: "BOOKING_CREATED" });
  const secret = "topsecret";

  it("accepts the hex HMAC and rejects a bad or missing secret", () => {
    const signature = sign(raw, secret);
    assert.equal(verifyCalcomSignature(raw, signature, secret), true);
    assert.equal(verifyCalcomSignature(raw, `sha256=${signature}`, secret), true);
    assert.equal(verifyCalcomSignature(raw, signature, "other"), false);
    assert.equal(verifyCalcomSignature(raw, null, secret), false);
    assert.equal(verifyCalcomSignature(raw, signature, ""), false);
  });

  it("accepts the env secret or a per-workspace secret", () => {
    const rawBody = "{\"ok\":true}";
    const env = matchingCalcomSecret(rawBody, sign(rawBody, "env-secret"), "env-secret", []);
    assert.deepEqual(env, { ok: true, workspaceId: null });

    const workspace = matchingCalcomSecret(
      rawBody,
      sign(rawBody, "ws-secret"),
      "env-secret",
      [{ workspaceId: "ws-1", secret: "ws-secret" }],
    );
    assert.deepEqual(workspace, { ok: true, workspaceId: "ws-1" });

    const rejected = matchingCalcomSecret(rawBody, sign(rawBody, "nope"), "env-secret", []);
    assert.deepEqual(rejected, { ok: false });
  });
});

describe("Cal.com booking parse and stage", () => {
  it("reads the attendee phone and email and ignores the organizer", () => {
    const booking = parseCalcomBooking({
      triggerEvent: "BOOKING_CREATED",
      payload: {
        uid: "book_1",
        startTime: "2026-11-20T15:00:00.000Z",
        organizer: { email: "sky@skala.cl", name: "Sky" },
        attendees: [
          { email: "ana@clinica.cl", name: "Ana", phoneNumber: "+56912345678" },
        ],
        responses: {
          phone: { label: "Teléfono", value: "+56912345678" },
          email: { value: "ana@clinica.cl" },
        },
      },
    });
    assert.ok(booking);
    assert.equal(booking.event, "BOOKING_CREATED");
    assert.equal(booking.uid, "book_1");
    assert.deepEqual(booking.phones, ["+56912345678"]);
    assert.deepEqual(booking.emails, ["ana@clinica.cl"]);
    assert.equal(booking.emails.includes("sky@skala.cl"), false);
    assert.equal(phonesMatch("+56912345678", "912345678"), true);
    assert.equal(phonesMatch("+56912345678", "11111111"), false);
  });

  it("sets AGENDADO on create and returns LINK_ENVIADO on cancel, never touching CLIENTE", () => {
    assert.equal(stageAfterBooking("LINK_ENVIADO", "BOOKING_CREATED"), "AGENDADO");
    assert.equal(stageAfterBooking("CALIFICANDO", "BOOKING_RESCHEDULED"), "AGENDADO");
    assert.equal(stageAfterBooking("AGENDADO", "BOOKING_CANCELLED"), "LINK_ENVIADO");
    assert.equal(stageAfterBooking("CLIENTE", "BOOKING_CREATED"), null);
    assert.equal(stageAfterBooking("CLIENTE", "BOOKING_CANCELLED"), null);
    assert.equal(stageAfterBooking("NUTRIR", "BOOKING_CANCELLED"), null);
    assert.equal(parseCalcomBooking({ triggerEvent: "PING" }), null);
  });
});
