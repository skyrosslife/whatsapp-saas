// Runs one Skala setter turn: extract, score in code, persist, alert, hand off.
// Scoring lives in qualify.ts. This module only reads and writes.

import { createClient as createSbClient } from "@supabase/supabase-js";
import { applyTransition } from "@/features/inbox/services/decision-engine";
import { dispatchText } from "@/features/inbox/services/dispatch";
import {
  createHLOpportunity,
  syncContactToHL,
} from "@/features/inbox/services/highlevel-client";
import { extractLeadUpdate } from "./extract";
import {
  ROUTE_TAGS,
  buildTurnDirective,
  classifyInboundReply,
  coerceLeadProfile,
  contactStageFor,
  enforceSetterGuardrails,
  followUpMessage,
  isPipelineStage,
  mergeLeadProfile,
  nextFormality,
  qualify,
  shouldSendFollowUp,
  type Formality,
  type LeadProfile,
  type PipelineStage,
  type Qualification,
  type QualifyConfig,
} from "./qualify";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface SkalaRuntimeConfig extends QualifyConfig {
  id: string;
  enabled: boolean;
  engine: "generic" | "skala";
  seguimientos_max: number;
}

export interface PreparedSkalaTurn {
  profile: LeadProfile;
  qualification: Qualification;
  directive: string;
  formality: Formality;
  allowLink: boolean;
  sideEffects: boolean;
  inbound: { optOut: boolean; no: boolean };
  currentStage: PipelineStage;
  followupCount: number;
  followupNoCount: number;
  followupStopped: boolean;
  alertKey: string | null;
}

interface SetterState {
  formality?: Formality;
  waiting_on_lead?: boolean;
  last_outbound_at?: string | null;
  alert_key?: string | null;
  note_key?: string | null;
  link_sent?: boolean;
}

function readState(raw: unknown): SetterState {
  if (!raw || typeof raw !== "object") return {};
  return raw as SetterState;
}

function alertKey(qualification: Qualification): string | null {
  if (!qualification.alert) return null;
  return qualification.handoff.reasons.join("|") || qualification.tier;
}

/**
 * Extracts the latest turn and decides the reply. Returns null when Skala
 * mode cannot run (missing migration or unexpected error). On an extraction
 * failure the previous profile is kept and the link is withheld.
 */
export async function prepareSkalaTurn(input: {
  workspaceId: string;
  conversationId: string;
  config: SkalaRuntimeConfig;
  history: { role: string; content: string }[];
  mergedText: string;
}): Promise<PreparedSkalaTurn | null> {
  const supabase = svc();
  try {
    const { data, error } = await supabase
      .from("conversations")
      .select(
        "lead_profile, pipeline_stage, setter_state, followup_count, followup_no_count, followup_stopped",
      )
      .eq("id", input.conversationId)
      .maybeSingle();

    if (error || !data) {
      console.error("[setter] prepareSkalaTurn load failed:", error?.message);
      return null;
    }

    const currentStage = isPipelineStage(data.pipeline_stage)
      ? data.pipeline_stage
      : "NUEVO";
    const state = readState(data.setter_state);
    const prev = coerceLeadProfile(data.lead_profile);
    const inbound = classifyInboundReply(input.mergedText);
    const formality = nextFormality(state.formality ?? "tu", input.mergedText);

    const transcript =
      input.history.map((turn) => `${turn.role}: ${turn.content}`).join("\n") +
      `\nuser: ${input.mergedText}`;
    const extracted = await extractLeadUpdate({
      workspaceId: input.workspaceId,
      transcript,
    });
    const profile = extracted ? mergeLeadProfile(prev, extracted) : prev;
    const qualification = qualify(profile, input.config, { currentStage });
    const allowLink = Boolean(extracted) && qualification.link.send;
    const directiveQualification = allowLink
      ? qualification
      : {
          ...qualification,
          link: { ...qualification.link, send: false },
        };
    let directive = buildTurnDirective({
      config: input.config,
      profile,
      qualification: directiveQualification,
      formality,
    });
    if (inbound.optOut) {
      directive +=
        "\n\n## Opt-out\nEl lead pidió no recibir más mensajes. Confirma en una línea que no le escribes más. Sin enlace y sin pregunta de venta.";
    }

    return {
      profile,
      qualification,
      directive,
      formality,
      allowLink,
      sideEffects: Boolean(extracted),
      inbound,
      currentStage,
      followupCount: Number(data.followup_count ?? 0),
      followupNoCount: Number(data.followup_no_count ?? 0),
      followupStopped: data.followup_stopped === true,
      alertKey: state.alert_key ?? null,
    };
  } catch (err) {
    console.error(
      "[setter] prepareSkalaTurn error:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export function guardSkalaReply(
  text: string,
  input: { allowLink: boolean; config: QualifyConfig; fallback?: string },
): string {
  return enforceSetterGuardrails(text, {
    allowLink: input.allowLink,
    linkAgenda: input.config.link_agenda,
    linkDemo: input.config.link_demo,
    botName: input.config.bot_name,
    fallback: input.fallback,
  }).text;
}

const STATUS_TAGS = new Set<string>([...ROUTE_TAGS, "prioritario", "revisar"]);

export async function commitSkalaTurn(input: {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  config: SkalaRuntimeConfig;
  prepared: PreparedSkalaTurn;
  outboundBody: string;
  dispatchOk: boolean;
}): Promise<void> {
  const supabase = svc();
  const { prepared } = input;
  try {
    const linkSent =
      input.dispatchOk &&
      prepared.allowLink &&
      Boolean(input.config.link_agenda) &&
      input.outboundBody.includes(input.config.link_agenda!.trim());

    const qualification = linkSent
      ? prepared.qualification
      : qualify(prepared.profile, input.config, {
          currentStage: prepared.currentStage,
        });
    if (!linkSent && prepared.qualification.link.send) {
      qualification.link = { ...qualification.link, send: false };
      qualification.stage =
        prepared.currentStage === "LINK_ENVIADO"
          ? "LINK_ENVIADO"
          : qualification.handoff.required
            ? "REVISION"
            : "CALIFICANDO";
    }

    const noCount =
      prepared.followupNoCount + (prepared.inbound.no ? 1 : 0);
    const stopped =
      prepared.followupStopped ||
      prepared.inbound.optOut ||
      noCount >= 2;
    const now = new Date().toISOString();
    const nextAlertKey = alertKey(qualification);
    const notify =
      prepared.sideEffects &&
      qualification.alert &&
      nextAlertKey !== prepared.alertKey;

    if (prepared.sideEffects) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("tags, stage, custom_fields")
        .eq("id", input.contactId)
        .maybeSingle();

      const existingTags = Array.isArray(contact?.tags)
        ? (contact.tags as string[])
        : [];
      const tags = [
        ...existingTags.filter((tag) => !STATUS_TAGS.has(tag)),
        ...qualification.tags,
      ];
      const customFields = {
        ...((contact?.custom_fields as Record<string, unknown> | null) ?? {}),
        pipeline_stage: qualification.stage,
        setter_score: qualification.score,
        setter_tier: qualification.tier,
        setter_route: qualification.route,
        lead_profile: prepared.profile,
      };
      const currentContactStage =
        typeof contact?.stage === "string" ? contact.stage : null;
      const nextContactStage = contactStageFor(
        qualification.stage,
        currentContactStage,
      );

      await supabase
        .from("contacts")
        .update({
          tags: [...new Set(tags)],
          pipeline_stage: qualification.stage,
          custom_fields: customFields,
          ...(nextContactStage ? { stage: nextContactStage } : {}),
          ...(prepared.inbound.optOut ? { opt_in: false } : {}),
        })
        .eq("id", input.contactId);

      await supabase
        .from("conversations")
        .update({
          lead_profile: prepared.profile,
          pipeline_stage: qualification.stage,
          setter_route: qualification.route,
          followup_no_count: noCount,
          followup_stopped: stopped,
          setter_state: {
            formality: prepared.formality,
            waiting_on_lead: true,
            last_outbound_at: now,
            alert_key: notify ? nextAlertKey : prepared.alertKey,
            note_key: notify ? nextAlertKey : prepared.alertKey,
            link_sent: linkSent || prepared.currentStage === "LINK_ENVIADO",
          },
        })
        .eq("id", input.conversationId);

      await supabase.from("events").insert({
        type: "setter_qualification",
        level: qualification.handoff.required ? "warn" : "info",
        workspace_id: input.workspaceId,
        conversation_id: input.conversationId,
        payload: {
          score: qualification.score,
          tier: qualification.tier,
          route: qualification.route,
          stage: qualification.stage,
          link_sent: linkSent,
          handoff: qualification.handoff.reasons,
          contact_id: input.contactId,
          config_id: input.config.id,
        },
      });

      if (notify) {
        try {
          await supabase.from("notifications").insert({
            workspace_id: input.workspaceId,
            conversation_id: input.conversationId,
            contact_id: input.contactId,
            kind: "setter_alert",
            body: qualification.alertText,
            payload: {
              score: qualification.score,
              tier: qualification.tier,
              route: qualification.route,
              reasons: qualification.handoff.reasons,
            },
          });
          await supabase.from("messages").insert({
            workspace_id: input.workspaceId,
            conversation_id: input.conversationId,
            direction: "out",
            type: "system",
            body: qualification.alertText,
            status: "sent",
            meta: { internal: true, setter: true },
          });
        } catch (err) {
          console.error(
            "[setter] alert record failed:",
            err instanceof Error ? err.message : err,
          );
        }
        const tipo = prepared.profile.tipo_clinica ?? "clínica";
        await createHLOpportunity(input.workspaceId, input.contactId, {
          name: `Skala · ${qualification.route ?? "lead"} · ${tipo}`,
        });
      }

      await syncContactToHL(input.workspaceId, input.contactId);

      if (qualification.handoff.required) {
        try {
          await applyTransition(input.conversationId, "handoff_pending", {
            trigger: "setter",
          });
        } catch (err) {
          console.warn(
            "[setter] handoff skipped:",
            err instanceof Error ? err.message : err,
          );
        }
      } else if (qualification.pause) {
        try {
          await applyTransition(input.conversationId, "paused", {
            trigger: "setter_close",
          });
        } catch (err) {
          console.warn(
            "[setter] pause skipped:",
            err instanceof Error ? err.message : err,
          );
        }
      }
    } else {
      await supabase
        .from("conversations")
        .update({
          followup_no_count: noCount,
          followup_stopped: stopped,
          setter_state: {
            formality: prepared.formality,
            waiting_on_lead: true,
            last_outbound_at: now,
            alert_key: prepared.alertKey,
            link_sent: prepared.currentStage === "LINK_ENVIADO",
          },
        })
        .eq("id", input.conversationId);
    }
  } catch (err) {
    console.error(
      "[setter] commitSkalaTurn error:",
      err instanceof Error ? err.message : err,
    );
  }
}

interface FollowupRow {
  id: string;
  workspace_id: string;
  contact_id: string;
  state: string;
  window_expires_at: string | null;
  pipeline_stage: string | null;
  followup_count: number;
  followup_no_count: number;
  followup_stopped: boolean;
  setter_state: unknown;
}

/**
 * Sends at most `seguimientos_max` nudges after the first reply, only while
 * the 24h window is open. dispatchText applies the same window guard again.
 */
export async function runSetterFollowups(
  loadConfig: (workspaceId: string) => Promise<SkalaRuntimeConfig | null>,
): Promise<{ sent: number }> {
  const supabase = svc();
  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id, workspace_id, contact_id, state, window_expires_at, pipeline_stage, followup_count, followup_no_count, followup_stopped, setter_state",
    )
    .eq("state", "ai_active")
    .eq("followup_stopped", false)
    .in("pipeline_stage", ["NUEVO", "CALIFICANDO", "LINK_ENVIADO"])
    .gt("window_expires_at", new Date().toISOString())
    .order("updated_at", { ascending: true })
    .limit(20);

  if (error || !data) {
    console.error("[setter] followups query failed:", error?.message);
    return { sent: 0 };
  }

  const cache = new Map<string, SkalaRuntimeConfig | null>();
  let sent = 0;
  const now = new Date();

  for (const row of data as FollowupRow[]) {
    if (!cache.has(row.workspace_id)) {
      cache.set(row.workspace_id, await loadConfig(row.workspace_id));
    }
    const config = cache.get(row.workspace_id);
    if (!config || config.engine !== "skala" || !config.enabled) continue;

    const state = readState(row.setter_state);
    const decision = shouldSendFollowUp({
      seguimientosMax: config.seguimientos_max,
      followupCount: row.followup_count ?? 0,
      noCount: row.followup_no_count ?? 0,
      optedOut: row.followup_stopped === true,
      waitingOnLead: state.waiting_on_lead === true,
      windowExpiresAt: row.window_expires_at,
      lastOutboundAt: state.last_outbound_at ?? null,
      now,
      state: row.state,
      stage: isPipelineStage(row.pipeline_stage) ? row.pipeline_stage : null,
    });
    if (!decision.send) continue;

    const body = guardSkalaReply(
      followUpMessage(config.bot_name, state.formality ?? "tu"),
      { allowLink: false, config },
    );
    const result = await dispatchText({
      workspaceId: row.workspace_id,
      conversationId: row.id,
      body,
    });
    if (!result.ok) continue;

    sent += 1;
    await supabase
      .from("conversations")
      .update({
        followup_count: (row.followup_count ?? 0) + 1,
        setter_state: {
          ...state,
          waiting_on_lead: true,
          last_outbound_at: now.toISOString(),
        },
      })
      .eq("id", row.id);
  }

  return { sent };
}
