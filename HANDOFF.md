# HANDOFF — instalación Agente WhatsApp (traspaso entre sesiones)

> Archivo temporal para continuar la instalación en esta carpeta.
> Bórralo cuando termines (`rm HANDOFF.md`). NO lo commitees.

## Contexto

El usuario está siguiendo `INSTALAR.md` para instalar este SaaS (inbox de
WhatsApp con IA). Es dueño de negocio, no técnico. Confírmale cada paso en
**español, tuteo**, con mensajes cortos, antes de ejecutar.

Reglas (de INSTALAR.md):

- NO modificar `src/` ni `supabase/migrations/`. Solo correr los scripts.
- NUNCA pegar secrets en el chat. El usuario los pega; tú los pasas **inline**
  como env vars a `scripts/setup.mjs`. No escribir secrets a mano en archivos.
- NUNCA commitear `.env.local` ni `*.filled.sql` (ya en `.gitignore`).
- Si algo falla: detente, muestra el error exacto, explícalo simple, no sigas.

## Estado actual (2026-08-27)

- Repo clonado en `~/whatsapp-saas`, rama `main`, árbol limpio.
- `npm install` YA hecho (`node_modules/` presente).
- Prerequisitos OK: `node -v` = v26.7.0 (>=20 ✓), CLI `supabase` ✓, CLI `vercel` ✓.
- `.env.local` **NO existe todavía** → siguiente paso es el #4 (env).
- El usuario dice que YA tiene las cuentas (Supabase, Vercel, OpenRouter, YCloud)
  y que YA creó el proyecto en Supabase.

## Próximos pasos (retomar en el #4)

### 4. Generar secrets + escribir .env.local

Pídele al usuario y córrelo inline (una sola línea):

```bash
NEXT_PUBLIC_SUPABASE_URL='https://xxxx.supabase.co' \
NEXT_PUBLIC_SUPABASE_ANON_KEY='eyJ...' \
SUPABASE_SERVICE_ROLE_KEY='eyJ...' \
OPENROUTER_API_KEY='sk-or-...' \
node scripts/setup.mjs env
```

- Las keys están en Supabase → **Settings → API Keys**. Si el dashboard ya muestra
  las nuevas "publishable/secret", usar la pestaña **Legacy API keys** (el código
  usa los nombres viejos `anon` / `service_role`).
- Si aún no tiene la de OpenRouter, correr `env` sin ella y repetir después
  (idempotente, no rota secrets ya generados).
- Verificar luego: `node scripts/setup.mjs doctor`.

### 5. Migraciones

```bash
supabase login   # abre browser, que inicie sesión
SUPABASE_DB_PASSWORD='la-contraseña-de-la-DB' node scripts/setup.mjs db-push
```

DB password = la que guardó al crear el proyecto (o resetear en Settings → Database).

### 6. Deploy a Vercel

```bash
vercel login
vercel link
node scripts/setup.mjs vercel-env
vercel --prod                     # copiar la URL que imprime
node scripts/setup.mjs set-app-url 'https://TU-URL.vercel.app'
node scripts/setup.mjs vercel-env
vercel --prod
```

### 7. Site URL en Supabase

Pedir Management API token (supabase.com/dashboard/account/tokens):

```bash
export SUPABASE_ACCESS_TOKEN='sbp_...'
node scripts/setup.mjs site-url
```

### 8. Super admin

```bash
ADMIN_EMAIL='tu@correo.com' ADMIN_PASSWORD='min-8-chars' node scripts/seed-admin.mjs
```

### 9. Cron del buffer

```bash
node scripts/setup.mjs cron-apply   # usa el SUPABASE_ACCESS_TOKEN del paso 7
```

### 10–13. En la app

Login → `/workspaces` → crear workspace → Settings → Integraciones: pegar API Key
y Webhook Signing Secret de YCloud, copiar el Webhook URL a YCloud → Webhooks →
conectar número. Probar mandando un WhatsApp (responde en ~1 min cuando corre el cron).

Ver `INSTALAR.md` para el detalle completo y el troubleshooting.
