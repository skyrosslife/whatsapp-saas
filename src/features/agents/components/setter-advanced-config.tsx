"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Bot, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  SKALA_LINK_AGENDA_EXAMPLE,
  SKALA_SYSTEM_PROMPT_PLACEHOLDER,
} from "@/features/setter/qualify";

// ── Types ─────────────────────────────────────────────────────────────────────

type QuestionType = "open" | "yes_no" | "multiple";
type KnockoutAction = "disqualify" | "continue" | "handoff";
type PostActionType =
  | "send_template"
  | "create_hl_opportunity"
  | "handoff"
  | "add_tag";

interface SetterQuestion {
  id: string;
  text: string;
  type: QuestionType;
  weight: number;
}

interface KnockoutRule {
  question_id: string;
  condition: string;
  action: KnockoutAction;
}

interface PostAction {
  type: PostActionType;
  tag?: string;
  template_name?: string;
}

interface SetterConfig {
  id: string;
  name: string;
  enabled: boolean;
  engine: "generic" | "skala";
  bot_name: string;
  link_agenda: string | null;
  link_demo: string | null;
  call_minutes: number;
  garantia_activa: boolean;
  umbral_agenda: number;
  umbral_prioritario: number;
  seguimientos_max: number;
  system_prompt: string;
  questions: SetterQuestion[];
  knockout_rules: KnockoutRule[];
  scoring: { threshold: number; max_score: number };
  post_action: PostAction;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  open: "Abierta",
  yes_no: "Sí / No",
  multiple: "Múltiple",
};

const KNOCKOUT_ACTION_LABELS: Record<KnockoutAction, string> = {
  disqualify: "Descalificar",
  continue: "Continuar",
  handoff: "Handoff a humano",
};

const POST_ACTION_LABELS: Record<PostActionType, string> = {
  send_template: "Enviar template",
  create_hl_opportunity: "Crear oportunidad en HL",
  handoff: "Handoff a humano",
  add_tag: "Agregar etiqueta",
};

const DEFAULT_CONFIG: Omit<SetterConfig, "id"> = {
  name: "Setter Ventas",
  enabled: false,
  engine: "generic",
  bot_name: "Asistente de Skala",
  link_agenda: "",
  link_demo: "",
  call_minutes: 20,
  garantia_activa: false,
  umbral_agenda: 55,
  umbral_prioritario: 75,
  seguimientos_max: 2,
  system_prompt: SKALA_SYSTEM_PROMPT_PLACEHOLDER,
  questions: [],
  knockout_rules: [],
  scoring: { threshold: 50, max_score: 100 },
  post_action: { type: "handoff" },
};

function toDraft(cfg: SetterConfig): Omit<SetterConfig, "id"> {
  return {
    name: cfg.name,
    enabled: cfg.enabled,
    engine: cfg.engine === "skala" ? "skala" : "generic",
    bot_name: cfg.bot_name || "Asistente de Skala",
    link_agenda: cfg.link_agenda ?? "",
    link_demo: cfg.link_demo ?? "",
    call_minutes: cfg.call_minutes ?? 20,
    garantia_activa: cfg.garantia_activa === true,
    umbral_agenda: cfg.umbral_agenda ?? 55,
    umbral_prioritario: cfg.umbral_prioritario ?? 75,
    seguimientos_max: cfg.seguimientos_max ?? 2,
    system_prompt: cfg.system_prompt || SKALA_SYSTEM_PROMPT_PLACEHOLDER,
    questions: cfg.questions ?? [],
    knockout_rules: cfg.knockout_rules ?? [],
    scoring: cfg.scoring ?? { threshold: 50, max_score: 100 },
    post_action: (cfg.post_action as PostAction) ?? { type: "handoff" },
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h3 className="font-display text-sm font-medium text-foreground">
        {title}
      </h3>
      {description && (
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function QuestionRow({
  question,
  index,
  onChange,
  onDelete,
}: {
  question: SetterQuestion;
  index: number;
  onChange: (updated: SetterQuestion) => void;
  onDelete: () => void;
}) {
  return (
    <li className="grid gap-3 rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="mt-0.5 font-mono text-xs text-muted-foreground select-none">
          #{index + 1}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto text-muted-foreground hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-label={`Eliminar pregunta ${index + 1}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`q-text-${question.id}`}>Pregunta</Label>
        <Input
          id={`q-text-${question.id}`}
          value={question.text}
          placeholder="¿Cuál es tu presupuesto mensual?"
          onChange={(e) => onChange({ ...question, text: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`q-type-${question.id}`}>Tipo</Label>
          <select
            id={`q-type-${question.id}`}
            value={question.type}
            onChange={(e) =>
              onChange({ ...question, type: e.target.value as QuestionType })
            }
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`q-weight-${question.id}`}>
            Peso: {question.weight}
          </Label>
          <input
            id={`q-weight-${question.id}`}
            type="range"
            min={0}
            max={10}
            step={1}
            value={question.weight}
            onChange={(e) =>
              onChange({ ...question, weight: Number(e.target.value) })
            }
            className="w-full h-9 cursor-pointer accent-primary"
            aria-label={`Peso de la pregunta ${index + 1}`}
          />
        </div>
      </div>
    </li>
  );
}

function KnockoutRuleRow({
  rule,
  index,
  questions,
  onChange,
  onDelete,
}: {
  rule: KnockoutRule;
  index: number;
  questions: SetterQuestion[];
  onChange: (updated: KnockoutRule) => void;
  onDelete: () => void;
}) {
  return (
    <li className="grid gap-3 rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">
          Regla #{index + 1}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-label={`Eliminar regla ${index + 1}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`kr-question-${index}`}>Pregunta</Label>
        <select
          id={`kr-question-${index}`}
          value={rule.question_id}
          onChange={(e) => onChange({ ...rule, question_id: e.target.value })}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Seleccionar pregunta…</option>
          {questions.map((q, qi) => (
            <option key={q.id} value={q.id}>
              #{qi + 1} {q.text.slice(0, 60) || "(sin texto)"}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`kr-condition-${index}`}>Condición</Label>
        <Input
          id={`kr-condition-${index}`}
          value={rule.condition}
          placeholder='responde "No", presupuesto &lt; 1000…'
          onChange={(e) => onChange({ ...rule, condition: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`kr-action-${index}`}>Acción</Label>
        <select
          id={`kr-action-${index}`}
          value={rule.action}
          onChange={(e) =>
            onChange({ ...rule, action: e.target.value as KnockoutAction })
          }
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {(Object.keys(KNOCKOUT_ACTION_LABELS) as KnockoutAction[]).map(
            (a) => (
              <option key={a} value={a}>
                {KNOCKOUT_ACTION_LABELS[a]}
              </option>
            ),
          )}
        </select>
      </div>
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
}

export function SetterAdvancedConfig({ workspaceId }: Props) {
  const [config, setConfig] = useState<SetterConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Draft state — tracks unsaved changes
  const [draft, setDraft] = useState<Omit<SetterConfig, "id"> | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/setter`);
      const json = (await res.json()) as {
        data?: SetterConfig | null;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Error al cargar");
      const cfg = json.data ?? null;
      setConfig(cfg);
      if (cfg) setDraft(toDraft(cfg));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: load resets loading/error before each (re)fetch
    load();
  }, [load]);

  async function handleCreate() {
    setIsCreating(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/setter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(DEFAULT_CONFIG),
      });
      const json = (await res.json()) as {
        data?: SetterConfig;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Error al crear");
      const cfg = json.data!;
      setConfig(cfg);
      setDraft(toDraft(cfg));
      toast.success("Configuración de setter creada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSave() {
    if (!config || !draft) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/setter`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: config.id, ...draft }),
      });
      const json = (await res.json()) as {
        data?: SetterConfig;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Error al guardar");
      setConfig(json.data!);
      toast.success("Configuración guardada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setIsSaving(false);
    }
  }

  function addQuestion() {
    if (!draft) return;
    const newQ: SetterQuestion = {
      id: generateId(),
      text: "",
      type: "open",
      weight: 5,
    };
    setDraft({ ...draft, questions: [...draft.questions, newQ] });
  }

  function updateQuestion(index: number, updated: SetterQuestion) {
    if (!draft) return;
    const questions = draft.questions.map((q, i) =>
      i === index ? updated : q,
    );
    setDraft({ ...draft, questions });
  }

  function deleteQuestion(index: number) {
    if (!draft) return;
    const deletedId = draft.questions[index].id;
    const questions = draft.questions.filter((_, i) => i !== index);
    // Remove knockout rules that reference this question
    const knockout_rules = draft.knockout_rules.filter(
      (r) => r.question_id !== deletedId,
    );
    setDraft({ ...draft, questions, knockout_rules });
  }

  function addKnockoutRule() {
    if (!draft) return;
    const newRule: KnockoutRule = {
      question_id: draft.questions[0]?.id ?? "",
      condition: "",
      action: "disqualify",
    };
    setDraft({
      ...draft,
      knockout_rules: [...draft.knockout_rules, newRule],
    });
  }

  function updateKnockoutRule(index: number, updated: KnockoutRule) {
    if (!draft) return;
    const knockout_rules = draft.knockout_rules.map((r, i) =>
      i === index ? updated : r,
    );
    setDraft({ ...draft, knockout_rules });
  }

  function deleteKnockoutRule(index: number) {
    if (!draft) return;
    setDraft({
      ...draft,
      knockout_rules: draft.knockout_rules.filter((_, i) => i !== index),
    });
  }

  // ── Loading state ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-32" />
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden />
        <div>
          <p className="text-sm font-medium text-foreground">
            No pudimos cargar la configuración
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Reintentar
        </Button>
      </div>
    );
  }

  // ── Empty state (no config yet) ────────────────────────────────────────────

  if (!config) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border/60 bg-muted/40">
          <Bot className="h-7 w-7 text-muted-foreground" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            Sin configuración de setter
          </p>
          <p className="mt-1 text-xs text-muted-foreground max-w-xs">
            El modo setter califica prospectos con preguntas estructuradas antes
            de pasarlos al equipo de ventas.
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={isCreating}
          aria-busy={isCreating}
        >
          {isCreating && (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
          )}
          Crear configuración
        </Button>
      </div>
    );
  }

  // ── Data state ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Section 1 — Toggle + nombre */}
      <div className="space-y-4">
        <SectionHeading
          title="General"
          description="Activa el modo setter y asigna un nombre a esta configuración."
        />

        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Activar modo setter
            </p>
            <p className="text-xs text-muted-foreground">
              El agente calificará prospectos antes de hacer handoff.
            </p>
          </div>
          <Switch
            checked={draft?.enabled ?? false}
            onCheckedChange={(v) => draft && setDraft({ ...draft, enabled: v })}
            aria-label="Activar modo setter"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="setter-name">Nombre de la configuración</Label>
          <Input
            id="setter-name"
            value={draft?.name ?? ""}
            placeholder="Setter Ventas"
            onChange={(e) =>
              draft && setDraft({ ...draft, name: e.target.value })
            }
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <SectionHeading
          title="Calificación Skala"
          description="Setter para dueños de clínicas. El puntaje se calcula en código. El link solo se envía si la puerta de score lo permite."
        />

        <div className="space-y-1.5">
          <Label htmlFor="setter-engine">Motor</Label>
          <select
            id="setter-engine"
            value={draft?.engine ?? "generic"}
            onChange={(e) =>
              draft &&
              setDraft({
                ...draft,
                engine: e.target.value as "generic" | "skala",
              })
            }
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="generic">Genérico (preguntas y knockout)</option>
            <option value="skala">Skala (calificación de clínicas)</option>
          </select>
        </div>

        {draft?.engine === "skala" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="setter-bot-name">Nombre del bot</Label>
              <Input
                id="setter-bot-name"
                value={draft.bot_name}
                onChange={(e) =>
                  setDraft({ ...draft, bot_name: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                Se presenta como inteligencia artificial. No dice ser Sky ni una persona.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setter-link-agenda">Link de agenda</Label>
              <Input
                id="setter-link-agenda"
                value={draft.link_agenda ?? ""}
                placeholder={SKALA_LINK_AGENDA_EXAMPLE}
                onChange={(e) =>
                  setDraft({ ...draft, link_agenda: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                Si queda vacío, el bot nunca envía un link: etiqueta al lead y lo pasa a un humano. Workspace de Skala (llamada de 20 min en Cal.com): {SKALA_LINK_AGENDA_EXAMPLE}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setter-link-demo">Link de demo (opcional)</Label>
              <Input
                id="setter-link-demo"
                value={draft.link_demo ?? ""}
                placeholder="https://"
                onChange={(e) =>
                  setDraft({ ...draft, link_demo: e.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="setter-minutes">Minutos de la llamada</Label>
                <Input
                  id="setter-minutes"
                  type="number"
                  min={5}
                  max={180}
                  value={draft.call_minutes}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      call_minutes: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setter-followups">Seguimientos máximos</Label>
                <Input
                  id="setter-followups"
                  type="number"
                  min={0}
                  max={5}
                  value={draft.seguimientos_max}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      seguimientos_max: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="setter-umbral-agenda">
                  Umbral para enviar link ({draft.umbral_agenda})
                </Label>
                <Input
                  id="setter-umbral-agenda"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.umbral_agenda}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      umbral_agenda: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setter-umbral-prio">
                  Umbral prioritario ({draft.umbral_prioritario})
                </Label>
                <Input
                  id="setter-umbral-prio"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.umbral_prioritario}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      umbral_prioritario: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card p-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Garantía activa
                </p>
                <p className="text-xs text-muted-foreground">
                  Apagada: el bot no menciona garantías.
                </p>
              </div>
              <Switch
                checked={draft.garantia_activa}
                onCheckedChange={(value) =>
                  setDraft({ ...draft, garantia_activa: value })
                }
                aria-label="Garantía activa"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setter-system-prompt">Prompt del sistema</Label>
              <Textarea
                id="setter-system-prompt"
                value={draft.system_prompt}
                rows={8}
                onChange={(e) =>
                  setDraft({ ...draft, system_prompt: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                Placeholder hasta pegar el prompt final. El score, la ruta y el link los decide el código, no el modelo.
              </p>
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Section 2 — Preguntas */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeading
            title="Preguntas de calificación"
            description="Define las preguntas que el agente hará al prospecto."
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addQuestion}
          >
            <Plus className="h-4 w-4 mr-1.5" aria-hidden />
            Agregar pregunta
          </Button>
        </div>

        {draft && draft.questions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
            Sin preguntas. Agrega al menos una para que el setter funcione.
          </p>
        ) : (
          <ul className="space-y-3" role="list">
            {draft?.questions.map((q, i) => (
              <QuestionRow
                key={q.id}
                question={q}
                index={i}
                onChange={(updated) => updateQuestion(i, updated)}
                onDelete={() => deleteQuestion(i)}
              />
            ))}
          </ul>
        )}
      </div>

      <Separator />

      {/* Section 3 — Knockout rules */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeading
            title="Reglas de knockout"
            description="Si se cumple una condición, aplica la acción definida."
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addKnockoutRule}
            disabled={!draft || draft.questions.length === 0}
          >
            <Plus className="h-4 w-4 mr-1.5" aria-hidden />
            Agregar regla
          </Button>
        </div>

        {draft && draft.knockout_rules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
            Sin reglas de knockout. El scoring determinará la calificación.
          </p>
        ) : (
          <ul className="space-y-3" role="list">
            {draft?.knockout_rules.map((r, i) => (
              <KnockoutRuleRow
                key={i}
                rule={r}
                index={i}
                questions={draft.questions}
                onChange={(updated) => updateKnockoutRule(i, updated)}
                onDelete={() => deleteKnockoutRule(i)}
              />
            ))}
          </ul>
        )}
      </div>

      <Separator />

      {/* Section 4 — Puntuación */}
      <div className="space-y-4">
        <SectionHeading
          title="Puntuación"
          description={`Calificado si score ≥ ${draft?.scoring.threshold ?? 50}`}
        />

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="scoring-threshold">
              Umbral de calificación ({draft?.scoring.threshold ?? 50})
            </Label>
            <input
              id="scoring-threshold"
              type="range"
              min={0}
              max={100}
              step={5}
              value={draft?.scoring.threshold ?? 50}
              onChange={(e) =>
                draft &&
                setDraft({
                  ...draft,
                  scoring: {
                    ...draft.scoring,
                    threshold: Number(e.target.value),
                  },
                })
              }
              className="w-full h-9 cursor-pointer accent-primary"
              aria-label="Umbral de calificación"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="scoring-max">Score máximo</Label>
            <Input
              id="scoring-max"
              type="number"
              min={1}
              max={100}
              value={draft?.scoring.max_score ?? 100}
              onChange={(e) =>
                draft &&
                setDraft({
                  ...draft,
                  scoring: {
                    ...draft.scoring,
                    max_score: Number(e.target.value),
                  },
                })
              }
            />
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Un prospecto es{" "}
          <span className="font-medium text-foreground">calificado</span> si su
          score alcanza{" "}
          <span className={cn("font-mono font-semibold", "text-primary")}>
            {draft?.scoring.threshold ?? 50} / {draft?.scoring.max_score ?? 100}
          </span>
          .
        </p>
      </div>

      <Separator />

      {/* Section 5 — Post-action */}
      <div className="space-y-4">
        <SectionHeading
          title="Acción post-calificación"
          description="Qué hacer cuando un prospecto es calificado exitosamente."
        />

        <div className="space-y-1.5">
          <Label htmlFor="post-action-type">Acción</Label>
          <select
            id="post-action-type"
            value={draft?.post_action.type ?? "handoff"}
            onChange={(e) =>
              draft &&
              setDraft({
                ...draft,
                post_action: {
                  type: e.target.value as PostActionType,
                },
              })
            }
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {(Object.keys(POST_ACTION_LABELS) as PostActionType[]).map((t) => (
              <option key={t} value={t}>
                {POST_ACTION_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        {draft?.post_action.type === "add_tag" && (
          <div className="space-y-1.5">
            <Label htmlFor="post-action-tag">Etiqueta</Label>
            <Input
              id="post-action-tag"
              value={draft.post_action.tag ?? ""}
              placeholder="calificado"
              onChange={(e) =>
                setDraft({
                  ...draft,
                  post_action: { ...draft.post_action, tag: e.target.value },
                })
              }
            />
          </div>
        )}

        {draft?.post_action.type === "send_template" && (
          <div className="space-y-1.5">
            <Label htmlFor="post-action-template">Nombre del template</Label>
            <Input
              id="post-action-template"
              value={draft.post_action.template_name ?? ""}
              placeholder="bienvenida_calificado"
              onChange={(e) =>
                setDraft({
                  ...draft,
                  post_action: {
                    ...draft.post_action,
                    template_name: e.target.value,
                  },
                })
              }
            />
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="flex justify-end pt-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          aria-busy={isSaving}
        >
          {isSaving && (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
          )}
          Guardar configuración
        </Button>
      </div>
    </div>
  );
}
