# CLAUDE.md — notas para agentes

Fork comercial de `Carlos-Dominguez-faber/whatsapp-saas`. Remote `fork` →
`skyrosslife/whatsapp-saas` (pusheable); `origin` es el upstream (sin push).
Deploy de producción: `vercel --prod` manual (no git-connected), alias
`whatsapp-saas-eta-sooty.vercel.app`.

## Verificación (correr antes de dar por hecho un cambio)

```bash
npm run test:run    # Vitest — unit. Archivos: src/**/*.test.ts
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src/ middleware.ts
npm run build        # next build
```

- Config de Vitest: `vitest.config.mts` (`.mts`, no `.ts` — el repo es CommonJS).
- Mock de Supabase para tests: `src/test/supabase-mock.ts` → `makeSupabaseMock()`.
  Encadena `.select/.eq/.gt/.not/.order/.single/.maybeSingle`; registra filtros en
  `.filters` y payloads de escritura en `.writes`.
- No hay tests unitarios previos a la integración Cal.com — el runner se añadió
  con esa feature.

## Convenciones

- **Feature-first**: `src/features/<dominio>/{components,services,tools,lib}`.
  Lo reutilizable en `src/shared/`.
- **Proveedores** (WhatsApp / calendario / CRM): se conectan por workspace en
  `integrations` (credenciales cifradas con `shared/lib/integration-secrets.ts`,
  AAD = `workspaceId:provider`). Añadir un proveedor es **aditivo** — no tocar los
  existentes (YCloud, HighLevel, Cal.com). El proveedor de WhatsApp vive en una
  rama (`main` = YCloud, `provider/kapso` = Kapso), no en config.
- **Tools del agente**: archivo en `src/features/tools/tools/`, registrado en
  `tools/index.ts`, sembrado en `public.tools` vía migración. Se activan por
  workspace en `tool_configs`. El agente los recoge solos (`getEnabledTools` →
  `openrouter.ts`); no hay que tocar el motor.
- **Migraciones**: nuevas con timestamp posterior, idempotentes
  (`IF NOT EXISTS` / `ON CONFLICT`). Nunca editar una migración existente.
- **UI**: ver `COMPONENT_RULES.md` (tokens de color, no hex; fuentes del proyecto).

## Docs de trabajo

- `docs/superpowers/specs/` — specs de diseño
- `docs/superpowers/plans/` — planes de implementación (con sus desviaciones)
- `docs/2026-08-28-reporte-jornada.md` — resumen de la instalación + feature Cal.com
- `INSTALAR.md` — instalador guiado (no modificar `src/` ni migraciones al instalar)

## Cal.com (feature en `feat/calcom-integration`, PR #1)

Cliente en `src/features/inbox/services/calcom-client.ts`, repo de citas en
`appointments-repo.ts`, 4 tools `calcom_*`. La tabla `appointments` (de foundation,
antes sin uso) se extendió con columnas nuevas — start time es `scheduled_at`,
raw es `meta`, status nuevo es `'booked'`. Follow-ups pendientes I2/I3/I5 en el
plan doc.
