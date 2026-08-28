# Cal.com — verificación manual end-to-end

Prerrequisitos: una cuenta de Cal.com (cloud o self-hosted), un event type creado,
y su ID numérico (Cal.com → Event Types → el evento → la URL trae `?id=NNN`, o
Settings → Developer). Una API key de Cal.com (Settings → Developer → API keys).

## 1. Conectar

1. Workspace → **Settings → Integraciones → Cal.com**.
2. Pega la **API Key**, el **Event Type ID** por defecto. Deja la Base URL en
   `https://api.cal.com` (o pon la de tu instancia self-hosted).
3. (Opcional) Zona horaria y el JSON de tipos con nombre.
4. **Guardar** → **Probar conexión** → debe mostrar el nombre de tu cuenta.
5. Re-abre la sección: la API key aparece enmascarada (`••••••`), como las demás.

## 2. Activar los tools

Settings → **Herramientas** → activa:
`calcom_check_availability`, `calcom_book`, `calcom_reschedule`, `calcom_cancel`.
Deja los de HighLevel apagados en este workspace.

## 3. Probar en el playground (sin WhatsApp)

Agentes → **Probar chat**:

| Prueba                                        | Esperado                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| "¿qué horarios tienes esta semana?"           | llama `calcom_check_availability`, lista horarios reales de Cal.com                 |
| "agéndame el <slot>, soy Ana, ana@correo.com" | confirma, llama `calcom_book`. La cita aparece en el dashboard de Cal.com           |
| "muévela al <otro slot>"                      | `calcom_reschedule` — Cal.com y la fila local se actualizan                         |
| "mejor cancélala"                             | `calcom_cancel` — Cal.com marca cancelada, la fila local queda `status='cancelled'` |

Verifica la fila local:

```sql
select provider, external_uid, status, scheduled_at, attendee_email
from appointments order by created_at desc limit 3;
```

## 4. Caminos de error

- Deshabilita la integración Cal.com → reintenta agendar en el playground → el
  agente responde que no puede agendar ahora (no crashea).
- Event Type ID vacío → `calcom_check_availability` responde que no hay tipo de
  cita configurado.
- Email inválido / ausente → `calcom_book` pide un email válido antes de llamar a
  Cal.com.

## 5. Regresión (no romper HighLevel)

Un workspace con HighLevel conectado y sus tools activos sigue agendando con
`schedule_highlevel` / `check_availability` sin cambios. La tabla `appointments`
conserva sus columnas originales; solo se agregaron columnas nuevas.

## 6. Notas de operación

- Los recordatorios/confirmaciones por correo los envía **Cal.com** al email que
  el cliente dio en el chat. Configúralos en el event type de Cal.com.
- Citas creadas **fuera de WhatsApp** (link público de Cal.com) no entran en la
  tabla `appointments` en v1 → `calcom_reschedule` / `calcom_cancel` no las
  encuentran. Fase 2: webhooks de Cal.com (`BOOKING_CREATED/CANCELLED`).
- El prompt del agente debe: pedir el email antes de agendar, confirmar fecha y
  hora antes de `calcom_book`, y confirmar antes de `calcom_cancel`. Ver el
  prompt de ejemplo en `EJEMPLO-CLINICA.md`.
