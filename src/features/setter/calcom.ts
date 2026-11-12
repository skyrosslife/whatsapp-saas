// Cal.com booking webhooks. Signature check and stage changes are pure;
// the route applies them.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { PipelineStage } from "./qualify";

export type CalBookingEvent =
  | "BOOKING_CREATED"
  | "BOOKING_RESCHEDULED"
  | "BOOKING_CANCELLED";

const EVENTS = new Set<string>([
  "BOOKING_CREATED",
  "BOOKING_RESCHEDULED",
  "BOOKING_CANCELLED",
]);

export interface BookingIdentity {
  event: CalBookingEvent;
  uid: string | null;
  startTime: string | null;
  phones: string[];
  emails: string[];
  title: string | null;
}

export function verifyCalcomSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): boolean {
  if (!secret || !header) return false;
  const received = header.trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]+$/i.test(received)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(received.toLowerCase(), "utf8"),
  );
}

export function matchingCalcomSecret(
  rawBody: string,
  header: string | null,
  envSecret: string,
  workspaceSecrets: { workspaceId: string; secret: string }[],
): { ok: true; workspaceId: string | null } | { ok: false } {
  if (verifyCalcomSignature(rawBody, header, envSecret)) {
    return { ok: true, workspaceId: null };
  }
  for (const row of workspaceSecrets) {
    if (verifyCalcomSignature(rawBody, header, row.secret)) {
      return { ok: true, workspaceId: row.workspaceId };
    }
  }
  return { ok: false };
}

export function phonesMatch(a: string, b: string): boolean {
  const left = a.replace(/\D/g, "");
  const right = b.replace(/\D/g, "");
  if (left.length < 8 || right.length < 8) return false;
  return left.endsWith(right) || right.endsWith(left);
}

function pushUnique(list: string[], value: string | null): void {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed || list.includes(trimmed)) return;
  list.push(trimmed);
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return textValue(record.value);
    if ("phone" in record) return textValue(record.phone);
  }
  return null;
}

function collectFromResponses(
  responses: unknown,
  phones: string[],
  emails: string[],
): void {
  if (!responses || typeof responses !== "object") return;
  for (const [key, value] of Object.entries(responses as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    const text = textValue(value);
    if (!text) continue;
    if (normalized.includes("phone") || normalized.includes("telefono") || normalized.includes("tel")) {
      pushUnique(phones, text);
    } else if (normalized.includes("email") || normalized.includes("correo")) {
      pushUnique(emails, text);
    }
  }
}

/**
 * Reads a Cal.com webhook body. Attendee phone and email are used to match
 * the lead. The organizer is ignored so Sky's own address is not the match.
 */
export function parseCalcomBooking(body: unknown): BookingIdentity | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const eventName =
    (typeof root.triggerEvent === "string" && root.triggerEvent) ||
    (typeof root.event === "string" && root.event) ||
    "";
  if (!EVENTS.has(eventName)) return null;
  const payload =
    root.payload && typeof root.payload === "object"
      ? (root.payload as Record<string, unknown>)
      : root;

  const phones: string[] = [];
  const emails: string[] = [];

  if (Array.isArray(payload.attendees)) {
    for (const attendee of payload.attendees) {
      if (!attendee || typeof attendee !== "object") continue;
      const row = attendee as Record<string, unknown>;
      pushUnique(phones, textValue(row.phoneNumber ?? row.phone));
      pushUnique(emails, textValue(row.email));
    }
  }

  collectFromResponses(payload.responses, phones, emails);
  collectFromResponses(payload.userFieldsResponses, phones, emails);

  return {
    event: eventName as CalBookingEvent,
    uid: textValue(payload.uid ?? payload.bookingId),
    startTime: textValue(payload.startTime ?? payload.start),
    phones,
    emails,
    title: textValue(payload.title),
  };
}

/**
 * BOOKING_CREATED and BOOKING_RESCHEDULED move the lead to AGENDADO.
 * BOOKING_CANCELLED returns AGENDADO to LINK_ENVIADO.
 * CLIENTE is never changed. Returns null when the stage should stay put.
 */
export function stageAfterBooking(
  current: PipelineStage | null,
  event: CalBookingEvent,
): PipelineStage | null {
  if (current === "CLIENTE") return null;
  if (event === "BOOKING_CANCELLED") {
    return current === "AGENDADO" ? "LINK_ENVIADO" : null;
  }
  return "AGENDADO";
}
