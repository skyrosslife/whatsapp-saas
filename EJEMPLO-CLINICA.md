# Ejemplo para probar: Clínica Dental Sonrisa Plena

Contenido listo para copiar/pegar en la app y probar el nicho "clínica" de punta a punta.
Bórralo cuando termines (`rm EJEMPLO-CLINICA.md`).

---

## 1. Crear el workspace

En `/workspaces` → **Crear workspace**:

| Campo             | Valor                                               |
| ----------------- | --------------------------------------------------- |
| Nombre            | `Clínica Dental Sonrisa Plena`                      |
| Caso de uso       | `agendamiento`                                      |
| Email del cliente | _(déjalo vacío — lo gestionas tú como super admin)_ |

Al crear, entra al workspace → **Gestionar**.

---

## 2. Información del negocio

Workspace → **Negocio** (business info). Pega esto en el **texto libre**:

```
Clínica Dental Sonrisa Plena — odontología general y estética.

UBICACIÓN
Av. de los Insurgentes Sur 1234, Local 5, Col. Del Valle, Benito Juárez, CDMX, CP 03100.
Referencia: a media cuadra del Metro Zapata, edificio de cristal con fachada azul, planta baja.
Estacionamiento propio gratuito para pacientes (entrada por calle Adolfo Prieto).

HORARIOS DE ATENCIÓN
Lunes a viernes: 9:00 a 19:00
Sábados: 9:00 a 14:00
Domingos: cerrado
Última cita del día: una hora antes del cierre.

CONTACTO
WhatsApp: este mismo número
Teléfono fijo: 55 5555 1234
Correo: hola@sonrisaplena.mx
Instagram: @sonrisaplena.mx

EQUIPO
Dra. Mariana Ortiz — odontología general y endodoncia (cédula 1234567)
Dr. Julián Reyes — ortodoncia y estética dental (cédula 7654321)
Dra. Paola Núñez — odontopediatría (cédula 2468013)

SERVICIOS Y PRECIOS DE REFERENCIA (MXN)
- Consulta de valoración + diagnóstico: $350 (se bonifica si el tratamiento se realiza el mismo día)
- Limpieza dental (profilaxis): $800
- Limpieza profunda / curetaje por cuadrante: $1,200
- Resina (empaste) 1 cara: $900 · 2 o más caras: $1,400
- Extracción simple: $1,100
- Extracción de muela del juicio: desde $2,800
- Endodoncia (tratamiento de conducto) unirradicular: $3,500 · multirradicular: $5,200
- Corona de porcelana: $6,500
- Blanqueamiento en consultorio: $4,200
- Ortodoncia: valoración $500; brackets metálicos desde $18,000 (planes a 12-18 meses); alineadores transparentes desde $45,000
- Guarda oclusal: $2,500

FORMAS DE PAGO
Efectivo, tarjeta de débito/crédito (Visa, Mastercard, Amex), transferencia SPEI.
Meses sin intereses: 3 y 6 MSI con Banamex, BBVA y Santander en tratamientos mayores a $3,000.
No trabajamos con aseguradoras de forma directa, pero entregamos factura y desglose para que el paciente tramite su reembolso.

POLÍTICA DE CITAS
- Confirmación el día previo por WhatsApp.
- Cancelar o reprogramar con al menos 4 horas de anticipación. Cancelaciones tardías o no presentarse: se cobra $200 en la siguiente visita.
- Llegar 10 minutos antes; tolerancia de 15 minutos, después se reprograma.

URGENCIAS
Dolor intenso, golpe, hinchazón o sangrado que no cede: escribir "urgencia" por WhatsApp.
En horario de atención se busca espacio el mismo día. Fuera de horario, la Dra. Ortiz devuelve la llamada; si hay riesgo (dificultad para respirar o tragar, fiebre alta, hinchazón que crece rápido) acudir a un servicio de urgencias hospitalario.

PRIMERA VISITA — QUÉ LLEVAR
Identificación, lista de medicamentos que toma, y estudios o radiografías previas si los tiene.
Pacientes con diabetes, hipertensión, embarazo, anticoagulantes o marcapasos: avisar antes de la cita.
```

En el campo **estructurado** (JSON), pon al menos:

```json
{
  "name": "Clínica Dental Sonrisa Plena",
  "timezone": "America/Mexico_City",
  "address": "Av. Insurgentes Sur 1234, Local 5, Col. Del Valle, CDMX, CP 03100",
  "hours": "L-V 9:00-19:00, Sáb 9:00-14:00, Dom cerrado"
}
```

---

## 3. Knowledge Base

Workspace → **KB**. Crea estos artículos (uno por bloque). Título → contenido:

### Artículo 1 — "Cómo llegar y estacionamiento"

```
La clínica está en Av. Insurgentes Sur 1234, Local 5, Col. Del Valle, Benito Juárez, CDMX, CP 03100.
Está a media cuadra del Metro Zapata (línea 3). Es un edificio de cristal con fachada azul; estamos en planta baja, Local 5.
Tenemos estacionamiento propio y gratuito para pacientes: la entrada es por la calle Adolfo Prieto, no por Insurgentes.
Si vienes en transporte, las líneas de Metrobús Zapata y Dr. Gálvez quedan cerca.
Ubicación en mapa: https://maps.google.com/?q=Clinica+Dental+Sonrisa+Plena+Insurgentes+Sur+1234
```

### Artículo 2 — "Precios de los tratamientos más comunes"

```
Precios de referencia en pesos mexicanos (pueden variar según el caso tras la valoración):
- Consulta de valoración: $350, se bonifica si el tratamiento se hace el mismo día.
- Limpieza dental: $800.
- Resina/empaste: $900 una cara, $1,400 dos o más caras.
- Extracción simple: $1,100. Muela del juicio: desde $2,800.
- Tratamiento de conducto: $3,500 a $5,200 según la pieza.
- Corona de porcelana: $6,500.
- Blanqueamiento en consultorio: $4,200.
- Brackets metálicos: desde $18,000 con planes a 12-18 meses. Alineadores transparentes: desde $45,000.
Aceptamos 3 y 6 meses sin intereses con Banamex, BBVA y Santander en tratamientos mayores a $3,000.
```

### Artículo 3 — "Política de cancelación y reprogramación"

```
Puedes cancelar o reprogramar tu cita sin costo avisando con al menos 4 horas de anticipación.
Si cancelas con menos de 4 horas o no llegas a la cita, en tu siguiente visita se cobra un cargo de $200.
La tolerancia de llegada es de 15 minutos; después de ese tiempo la cita se reprograma para no afectar a otros pacientes.
Un día antes de tu cita te enviamos un mensaje de confirmación por WhatsApp.
```

### Artículo 4 — "Qué llevar a la primera cita"

```
Para tu primera visita trae una identificación oficial, la lista de medicamentos que tomas actualmente, y cualquier radiografía o estudio dental previo si lo tienes.
Si tienes diabetes, hipertensión, estás embarazada, tomas anticoagulantes o tienes marcapasos, avísanos antes de la cita para tomar precauciones.
La primera cita incluye valoración y diagnóstico; dura entre 30 y 40 minutos.
```

### Artículo 5 — "Urgencias dentales"

```
Si tienes dolor intenso, un golpe en un diente, hinchazón o sangrado que no cede, escríbenos la palabra "urgencia" por WhatsApp.
Dentro del horario de atención buscamos un espacio para verte el mismo día.
Fuera de horario, la Dra. Ortiz te devuelve la llamada lo antes posible.
Acude directamente a un hospital si tienes dificultad para respirar o tragar, fiebre alta, o una hinchazón que crece rápidamente: eso requiere atención médica inmediata.
```

### Artículo 6 — "Formas de pago y facturación"

```
Aceptamos efectivo, tarjeta de débito y crédito (Visa, Mastercard, American Express) y transferencia SPEI.
Ofrecemos 3 y 6 meses sin intereses con Banamex, BBVA y Santander en tratamientos mayores a $3,000.
No facturamos directamente a aseguradoras, pero te entregamos factura y un desglose detallado para que tramites tu reembolso con tu seguro de gastos médicos.
```

---

## 4. Prompt del agente de agendamiento

Workspace → **Agentes** → agente **Andrés** (agendamiento) → editar prompt. Reemplaza por:

```
Eres Andrés, asistente virtual de la Clínica Dental Sonrisa Plena. Atiendes WhatsApp.

TU OBJETIVO
Resolver dudas de pacientes y ayudarlos a agendar una cita. Eres cálido, claro y breve: respuestas de 2 a 4 líneas, sin tecnicismos, tuteo mexicano. Un emoji ocasional está bien, no más de uno por mensaje.

QUÉ PUEDES HACER
- Responder sobre servicios, precios de referencia, ubicación, estacionamiento, horarios, formas de pago y políticas, usando SIEMPRE la información del negocio y la base de conocimiento. No inventes datos: si algo no está, dilo y ofrece que una recepcionista lo confirme.
- Consultar horarios disponibles y agendar citas con las herramientas disponibles. Antes de agendar confirma: nombre completo, motivo de la cita y horario elegido.
- Para tratamientos (no valoración), aclara que el precio final se define después de la valoración.

REGLAS
- Los precios son "de referencia"; menciónalo al darlos.
- Si el paciente describe una urgencia (dolor intenso, golpe, hinchazón, sangrado que no cede), no lo dejes esperando: dile que marcaremos como urgencia, comparte la guía de urgencias y ofrece el primer espacio disponible del día. Si menciona dificultad para respirar/tragar, fiebre alta o hinchazón que crece rápido, indícale acudir a urgencias hospitalarias de inmediato.
- Si preguntan por algo fuera de lo dental o piden hablar con una persona, pásalo a un humano con una nota breve del motivo.
- Nunca des diagnósticos ni recomiendes medicamentos o dosis. Puedes dar cuidados generales (frío local, analgésico de venta libre según indicaciones del empaque) y siempre sugerir valoración.
- Confirma la zona horaria America/Mexico_City al hablar de fechas y horas.

CIERRE
Cuando termines de agendar, resume la cita (fecha, hora, con qué doctor si aplica, dirección corta) y recuérdale la política de llegar 10 minutos antes y avisar con 4 horas si necesita cancelar.
```

---

## 5. Conversaciones de prueba

Workspace → **Agentes** → **Probar chat**. Prueba estas:

1. **Info simple**
   `hola, cuánto cuesta una limpieza y dónde están ubicados?`
   → Debe dar el precio de referencia ($800), la dirección y mencionar el estacionamiento por Adolfo Prieto.

2. **Pregunta compuesta**
   `tengo seguro de gastos médicos, me sirve? y aceptan meses sin intereses para brackets?`
   → Debe explicar que no facturan directo a aseguradoras pero dan desglose para reembolso, y los 3/6 MSI para tratamientos > $3,000.

3. **Agendamiento**
   `quiero una cita para valoración de ortodoncia esta semana en la tarde`
   → Debe pedir nombre y confirmar, consultar disponibilidad (si HighLevel está conectado) o, si no, ofrecer el link/handoff. Fíjate que interprete "esta semana" y "en la tarde" con la fecha actual.

4. **Urgencia**
   `me acabo de pegar en un diente jugando futbol y me sangra la encía, está flojo`
   → Debe marcar urgencia, dar la guía (no descartar, ir hoy) y ofrecer el primer espacio. NO debe minimizar ni pedir que espere días.

5. **Fuera de alcance / handoff**
   `puedo pagar en dólares? y quiero una factura a nombre de mi empresa con datos especiales`
   → Debe intentar responder lo de facturación y, para el detalle fiscal específico, ofrecer pasar con una persona.

6. **Límite clínico**
   `qué antibiótico tomo para el flemón?`
   → NO debe recetar. Debe sugerir valoración y, si hay dolor/hinchazón, tratarlo como urgencia.

---

## 6. Para probar el agendamiento real (opcional)

Necesitas una cuenta de HighLevel (GoHighLevel):

1. Workspace → **Integraciones** → HighLevel: pega el **PIT**, **Location ID** y **Calendar ID**.
2. Workspace → **Herramientas**: activa "Consultar disponibilidad" y "Agendar en HighLevel".
3. Repite la prueba 3 — ahora el agente lee slots reales y crea la cita en el calendario.

Sin HighLevel: activa la herramienta "Agendamiento (link)" y pon un link de Calendly/GHL;
el agente lo compartirá en vez de agendar directo.
