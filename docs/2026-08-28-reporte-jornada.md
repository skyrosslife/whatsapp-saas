# Reporte de jornada — 2026-08-27 / 28

Fork: `skyrosslife/whatsapp-saas` · Rama: `feat/calcom-integration` · PR: [#1](https://github.com/skyrosslife/whatsapp-saas/pull/1)

---

## 1. Instalación desde cero

Se instaló el proyecto siguiendo `INSTALAR.md`:

| Componente                                                    | Estado                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Repo + `npm install`                                          | ✅                                                                  |
| Supabase (proyecto `fqwkvkmvnrzbdnnahqdz` — "whatsapp agent") | ✅ 19 migraciones base, extensiones `vector` / `pg_cron` / `pg_net` |
| `.env.local`                                                  | ✅ 3 keys de Supabase + OpenRouter + 3 secrets generados            |
| Vercel (`skala13/whatsapp-saas`)                              | ✅ deploy, 11 env vars, alias `whatsapp-saas-eta-sooty.vercel.app`  |
| Site URL + Redirect en Supabase                               | ✅ vía Management API                                               |
| Cron `buffer-flush`                                           | ✅ activo cada minuto, corridas `succeeded`                         |
| Super admin (`sross17i@gmail.com`)                            | ✅                                                                  |

Verificación end-to-end: `/login` 200, endpoint del cron protegido (401 sin secret), extensiones y cron confirmados por query directa.

**Extra:** `EJEMPLO-CLINICA.md` en la raíz — pack de datos de demo (clínica dental CDMX: business info, 6 artículos de KB, prompt de agente, 6 conversaciones de prueba). Desechable.

---

## 2. Integración Cal.com (feature nueva)

Proveedor de calendario **por workspace**, aditivo — HighLevel y YCloud sin tocar. Cada workspace conecta HighLevel _o_ Cal.com.

### Proceso seguido

`brainstorming` → spec (`docs/superpowers/specs/2026-08-27-calcom-integration-design.md`) → `writing-plans` → plan de 17 tareas (`docs/superpowers/plans/2026-08-27-calcom-integration.md`) → `subagent-driven-development` (implementación por subagentes + revisión) → code review final → fixes → `finishing-a-development-branch`.

### Qué se construyó

| Pieza                                                                                                                 | Archivo(s)                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Cliente API v2 (config loader, `getSlots`, `createBooking`, `rescheduleBooking`, `cancelBooking` — nunca lanza)       | `src/features/inbox/services/calcom-client.ts`                   |
| Repo de citas locales (`insertAppointment`, `findUpcomingAppointments`, `updateAppointmentByUid`)                     | `src/features/inbox/services/appointments-repo.ts`               |
| 4 tools del agente: `calcom_check_availability` (read), `calcom_book` / `calcom_reschedule` / `calcom_cancel` (write) | `src/features/tools/tools/calcom-*.ts`                           |
| Migración: extiende la tabla `appointments` + seed de los 4 tools en `public.tools`                                   | `supabase/migrations/20260828000000_calcom_and_appointments.sql` |
| Provider `caldotcom` en el enum de la API de integraciones                                                            | `src/app/api/workspace/[id]/integrations/route.ts`               |
| Endpoint "Probar conexión" (`GET {baseUrl}/v2/me`)                                                                    | `src/app/api/workspace/[id]/integrations/calcom/test/route.ts`   |
| Sección Cal.com en Settings → Integraciones (API key, base URL, event type, timezone, tipos con nombre)               | `src/features/settings/components/integrations-tab.tsx`          |
| Íconos en el catálogo de herramientas                                                                                 | `src/features/settings/components/tools-catalog.tsx`             |
| **Vitest** — primer runner de tests unitarios del repo + helper de mock de Supabase                                   | `vitest.config.mts`, `src/test/supabase-mock.ts`                 |

### Decisiones de diseño

- El email del cliente se pide en el chat (Cal.com lo exige) y se persiste en `contacts.email` si estaba vacío.
- Base URL configurable → soporta Cal.com Cloud y self-hosted.
- `appointments` local es la fuente de verdad para "cuál cita" reprogramar/cancelar. Webhooks de Cal.com (citas hechas fuera de WhatsApp) = fase 2.
- Confirmación de reschedule/cancel = conversacional (el gate `sensitive` del registry no tiene flujo de reanudación).

### Desviaciones del plan (todas documentadas en el plan doc)

1. `vitest.config.mts` en vez de `.ts` — el repo es CommonJS y `vite-tsconfig-paths` es ESM-only.
2. Ya existía una tabla `appointments` (de foundation, sin uso). Se **extendió** con `ALTER TABLE ADD COLUMN` en vez de crear una nueva → columnas reales: `scheduled_at` (no `start_at`), `meta` (no `raw`), status `'booked'` (no `'accepted'`). Reutiliza las RLS policies preexistentes.

### Code review — bloqueadores encontrados y corregidos

| ID        | Problema                                                                                                         | Fix                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **C1**    | `appointment_uid` del LLM se saltaba la verificación de dueño → un contacto podía cancelar/mover la cita de otro | Siempre se resuelve contra las citas propias del contacto |
| **C2**    | `Number(null) === 0` → sin Event Type ID, `defaultEventTypeId` quedaba en `0` y el guard no disparaba            | Resuelve a `null` si no es entero positivo                |
| **I1**    | `findUpcomingAppointments` sin filtro de provider / `external_uid` no nulo                                       | Añadidos ambos filtros                                    |
| **I4**    | `getCalComConfig` podía lanzar (vía `decryptCredentials`)                                                        | Envuelto en try/catch → `null`                            |
| **I6/I7** | uid previo se perdía en reschedule; faltaba test del caso `bk_old → bk_new`                                      | `meta.previous_uid` + test                                |

### Follow-ups pendientes (no bloquean — en el plan doc)

- **I2** — `calcom_book` responde `ok` aunque falle el insert local (reserva inalcanzable desde el chat).
- **I3** — el retry del registry (10 s + 1 reintento) puede duplicar una reserva lenta.
- **I5** — `config.base_url` sin validar → SSRF. Aplicar `ssrf-guard.ts` (`validateWebhookUrl`, SEC-08) al guardar.
- Menores: `minRole:"manager"` en la ruta de test, `count` real de slots vs cap de 20, `resolveEventTypeId` cae al default con nombre desconocido, `attendee_email` en `events.payload`.

---

## 3. Verificación final

```
npm run test:run   → 44 passed (7 files)
npm run typecheck  → clean
npm run lint       → clean
npm run build      → Compiled successfully
```

- Migración aplicada al Supabase de producción (`supabase db push`).
- Deploy a producción desde la rama `feat/calcom-integration` (`vercel --prod`) — `/login` 200, ruta `calcom/test` 401 (auth OK), cron 401 (protegido).

---

## 4. Estado y pendientes

### ✅ Listo

- App base en producción, operativa.
- Cal.com desplegado y funcional a nivel código.
- 26 commits en `feat/calcom-integration`, respaldados en el fork, PR #1 abierto.

### ⏳ Pendiente (usuario)

1. **Cambiar el password del super admin** (estuvo en texto plano en el chat de instalación). Vía app → perfil, o "¿Olvidaste tu contraseña?" en `/login`. _(El token de Supabase ya fue revocado.)_
2. **Conectar una cuenta Cal.com real** en un workspace (Settings → Integraciones → Cal.com) + activar los 4 tools + probar en el playground. Guía: `docs/superpowers/plans/2026-08-27-calcom-manual-verification.md`.
3. Ajustar el prompt del agente de agendamiento (pedir email, confirmar antes de agendar/cancelar).
4. **Mergear PR #1** a `main` del fork (producción corre desde la rama; un `vercel --prod` desde `main` revertiría Cal.com).
5. `rm -rf ~/whatsapp-saas/whatsapp-saas` (subcarpeta que `gh repo fork` clonó de más).
6. Follow-ups I2 / I3 / I5 cuando toque endurecer.

### Operación diaria

Todo desde la app (`https://whatsapp-saas-eta-sooty.vercel.app`): crear workspaces en `/workspaces`, conectar integraciones, ajustar prompts. Claude solo hace falta para cambios de código.
