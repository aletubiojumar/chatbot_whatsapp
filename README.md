# Bot Pericial Jumar

Chatbot conversacional para la gestión de siniestros de seguros. Contacta con los asegurados via WhatsApp, verifica datos del expediente, recoge la preferencia horaria de la videoperitación y sincroniza el encargo con PeritoLine mediante IA integrada con la Meta Cloud API.

---

## Índice

1. [Arquitectura](#arquitectura)
2. [Requisitos](#requisitos)
3. [Instalación](#instalación)
4. [Configuración (.env)](#configuración-env)
5. [Arranque](#arranque)
6. [Envío de mensajes iniciales](#envío-de-mensajes-iniciales)
7. [Flujo de la conversación](#flujo-de-la-conversación)
8. [Almacenamiento de datos](#almacenamiento-de-datos)
9. [PDF de transcripción](#pdf-de-transcripción)
10. [Sincronización con PeritoLine](#sincronización-con-peritoline)
11. [Sistema de logs por expediente](#sistema-de-logs-por-expediente)
12. [Limpieza automática de datos](#limpieza-automática-de-datos)
13. [Tests](#tests)
14. [Estructura del proyecto](#estructura-del-proyecto)
15. [Seguridad implementada](#seguridad-implementada)
16. [Endpoints HTTP](#endpoints-http)

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│  CORE  —  lógica de negocio                              │
│  conversationManager · stateMachine                      │
│  dedup · rateLimiter · aiModel                           │
├─────────────────────────────────────────────────────────┤
│  CANAL  —  adaptador de mensajería                       │
│  whatsappAdapter   (Meta Cloud API)                      │
├─────────────────────────────────────────────────────────┤
│  INFRA  —  servidor y schedulers                         │
│  index.js (Express + webhook)                            │
│  reminderScheduler · peritolineAutoSync                  │
└─────────────────────────────────────────────────────────┘
```

El adaptador de canal implementa una **interfaz universal**:

| Método | Descripción |
|---|---|
| `normalizeIncoming(body)` | Webhook payload → `{ channel, userId, text, location, timestamp, messageId, type, from }` |
| `sendText(to, text, opts)` | Envía texto plano, devuelve `{ messageId }` |
| `sendTemplate(to, name, params)` | Envía template aprobado de WhatsApp |

`location` solo viene relleno cuando `type === 'location'`: `{ latitude, longitude, name, address }`. El campo `address` solo lo provee Meta cuando el usuario selecciona un negocio/POI; si no, se resuelve con reverse geocoding (Nominatim/OSM).

---

## Requisitos

- Node.js ≥ 18
- Cuenta de Meta for Developers con app de WhatsApp Business
- API Key de Google AI Studio (Gemini) y/o OpenAI
- HTTPS público para el webhook (producción) o ngrok (desarrollo)
- Playwright instalado (para la sincronización con PeritoLine)

---

## Instalación

```bash
git clone <repo>
cd chatbot_ia
npm install
cp .env.example .env   # editar con tus credenciales reales
```

---

## Configuración (.env)

```env
# ── IA ────────────────────────────────────────────────────────────────────
AI_USING_PLATFORM=both   # both | gemini | openai
GEMINI_API_KEY=           # API Key de Google AI Studio
GEMINI_MODEL=gemini-2.5-flash
GEMINI_MODEL_FALLBACKS=gemini-1.5-flash,gemini-1.5-flash-8b
GEMINI_JSON_RETRIES_PER_MODEL=1
GEMINI_TEMPERATURE=0.0    # 0.0 = más determinístico, 1.0 = más creativo
GEMINI_TOP_P=0.95
GEMINI_TOP_K=40
GEMINI_MAX_OUTPUT_TOKENS=1000
OPENAI_API_KEY=          # Opcional si AI_USING_PLATFORM=gemini
OPENAI_MODEL=gpt-5-mini
OPENAI_MODEL_FALLBACKS=gpt-5-pro
OPENAI_FALLBACK_ENABLED=true
OPENAI_TIMEOUT_MS=15000
OPENAI_JSON_RETRIES_PER_MODEL=1

# Usa aquí IDs de modelo que existan en tu cuenta de OpenAI.
# El ejemplo usa los IDs públicos actuales de GPT-5.

# ── WhatsApp / Meta ───────────────────────────────────────────────────────
META_VERIFY_TOKEN=        # Token de verificación del webhook de Meta
USER_ACCESS_TOKEN=        # Token de acceso de la app de Meta
VERSION=v25.0
PHONE_NUMBER_ID=          # ID del número de teléfono de WhatsApp Business

# ── Servidor ─────────────────────────────────────────────────────────────
PORT=3000
HOST=127.0.0.1

# ── Almacenamiento ────────────────────────────────────────────────────────
EXCEL_PATH=./data/allianz_latest.xlsx
CONV_STATE_FILE=./data/bot_state.xlsx
EXCEL_ESTADO_PENDIENTE=OK         # Valor de la columna Estado que activa el bot
CONV_STATE_SHEET=__bot_state      # Hoja interna dentro de bot_state.xlsx

# ── Logging ───────────────────────────────────────────────────────────────
LOG_LEVEL=info            # debug | info | warn | error

# ── Rate limiting ─────────────────────────────────────────────────────────
RATE_USER_MAX=10           # Mensajes máximos por usuario por ventana
RATE_USER_WIN_MS=60000     # Duración de la ventana por usuario (ms)
RATE_GLOBAL_MAX=60         # Mensajes máximos globales por ventana
RATE_GLOBAL_WIN_MS=60000   # Duración de la ventana global (ms)

# ── Schedulers ────────────────────────────────────────────────────────────
SCHEDULER_CHECK_MINUTES=15         # Frecuencia de verificación del scheduler
INITIAL_RETRY_INTERVAL_MINUTES=360 # Intervalo entre reenvíos del template inicial (6h)
INITIAL_RETRY_MAX_ATTEMPTS=3       # Intentos máximos antes de escalar
INACTIVITY_INTERVAL_MINUTES=120    # Intervalo entre mensajes de inactividad (2h)
INACTIVITY_MAX_ATTEMPTS=3          # Recordatorios máximos antes de escalar
LOCATION_STANDBY_HOURS=96          # Horas de espera cuando el asegurado indica que enviará la ubicación más tarde
SEND_DELAY_MS=1500                 # Delay entre envíos al lanzar el script inicial (ms)

# ── Horario de envío (lunes-viernes) ─────────────────────────────────────
BUSINESS_HOURS_START=9    # Hora de inicio de envíos (formato 24h)
BUSINESS_HOURS_END=20     # Hora de fin de envíos

# ── Limpieza de datos ─────────────────────────────────────────────────────
SINIESTRO_CLEANUP_DAYS=7  # Días antes de eliminar filas antiguas del Excel
PDF_CLEANUP_DAYS=7        # Días antes de eliminar PDFs de transcripción
                           # (también aplica a logs de debug en logs/)

# ── PeritoLine ────────────────────────────────────────────────────────────
UPLOAD_CONVERSATIONS_TO_PL=true           # Subir PDF de conversación a PeritoLine
PERITOLINE_AUTO_SYNC=true                 # Activar sincronización automática
PERITOLINE_AUTO_SYNC_COOLDOWN_MS=45000    # Cooldown entre ejecuciones del mismo nexp (ms)
PERITOLINE_AUTO_SYNC_HEADLESS=true        # Playwright en modo headless
PERITOLINE_AUTO_SYNC_SLOW_MO=0            # Ralentización Playwright (ms, útil para debug)
PERITOLINE_AUTO_SYNC_DRY_RUN=false        # true = prueba sin subir nada
PERITOLINE_DRY_RUN=false                  # Alias de dry run para ejecución manual
PERITOLINE_VIRTUAL_PERITO_NAME=           # Nombre del perito virtual a asignar
LOGIN_URL=                                # URL del login de PeritoLine
USERNAME=                                 # Credenciales PeritoLine
PASSWORD=
```

---

## Arranque

### Producción

```bash
npm start
```

Arranca en `HOST:PORT` y queda a la escucha del webhook de WhatsApp.

### Desarrollo local con ngrok

```bash
npm run dev    # nodemon, reinicia al guardar archivos
```

Exponer el puerto con ngrok en otra terminal y configurar la URL en el panel de Meta Developers.

---

## Envío de mensajes iniciales

El script lee el Excel de expedientes (`EXCEL_PATH`) y envía el template de WhatsApp aprobado a cada asegurado cuya columna `Estado` sea `EXCEL_ESTADO_PENDIENTE` (por defecto `OK`). Registra el estado técnico de cada conversación en `data/bot_state.xlsx`.

```bash
# Enviar todos los expedientes pendientes
npm run send

# Enviar un único expediente por número de encargo
npm run send -- --nexp 880337292

# Enviar a un número de teléfono concreto
npm run send -- --tel 674742564

# Simular sin enviar nada (dry run)
npm run send -- --dry-run
```

Cada envío inicializa la conversación en `stage=consent`, `attempts=0`, `contacto="En curso"` y activa el scheduler de recordatorios automáticos (Escenario A).
El estado técnico se persiste en `data/bot_state.xlsx`, no dentro del Excel de negocio.

---

## Flujo de la conversación

### Stages (máquina de estados)

```
consent → identification → valoracion → agendando → finalizado → cerrado (terminal)
    └─────────────────────────────────────────────────────────┘
    (cualquier stage puede derivar a)    ──────────────────────► escalated (terminal)
```

| Stage | Descripción |
|---|---|
| `consent` | El asegurado confirma continuar por este medio |
| `identification` | Verificación de nombre, dirección y causa del siniestro |
| `valoracion` | Daños, estimación económica, aceptación de videoperitación y persona que atenderá al perito |
| `agendando` | Recogida de preferencia horaria (`Mañana` / `Tarde`) sin reserva automática de calendario |
| `finalizado` | La IA envía el cierre definitivo tras el resumen final o tras recoger la preferencia horaria |
| `cerrado` | Silencio total — **terminal, IA bloqueada** |
| `escalated` | Derivado a atención humana — **terminal, IA bloqueada** |

### Tipos de mensaje soportados

| Tipo WhatsApp | Tratamiento |
|---|---|
| `text` | Procesado directamente por la IA |
| `location` | Coordenadas → reverse geocoding (Nominatim/OSM) → dirección en texto → IA |
| Resto (`audio`, `image`, etc.) | Respuesta informativa, no se procesa |

### Pipeline de un mensaje entrante

```
POST /webhook
  1. normalizeIncoming()   → objeto normalizado { channel, userId, text, location, type, … }
  2. Filtro de tipo        → pasa 'text' y 'location'; resto → respuesta informativa
  3. isDuplicate()         → descarta reintentos del webhook (dedup por messageId)
  4. checkLimit()          → rate limit por usuario y global
  5. processMessage()
       si type='location'  → reverseGeocode(lat, lon) → dirección en texto
  6. canProcess()          → bloquea si stage es terminal, envía respuesta segura
  7. Primera respuesta     → triggerEncargoSync (asignar perito + marcar contacto)
  8. procesarConIA()       → IA genera respuesta estructurada en JSON
  9. excelManager          → actualiza columnas de negocio en el Excel
 10. adapter.sendText()    → envía respuesta al usuario por WhatsApp
 11. peritolineAutoSync    → si conversación terminada, dispara sync asíncrono (observaciones + anotación + PDF)
 12. pdfGenerator          → si conversación terminada, genera PDF de transcripción
```

### Logs en tiempo real (consola)

Cada mensaje procesado imprime un separador con el número de expediente para facilitar el seguimiento de conversaciones simultáneas:

```
─────────────────────────────────────────────────────────────────
📨 [880337292] "Hola, soy el asegurado"
─────────────────────────────────────────────────────────────────
[880337292] 🔗 Primera respuesta → sync PeritoLine iniciado
[880337292] 🤖 IA [valoracion]: "Buenos días, le confirmo..."
[880337292] ✅ Enviado (msgId: wamid.xxx) | entendido=true
```

Los errores y advertencias también se persisten en archivo — ver [Sistema de logs por expediente](#sistema-de-logs-por-expediente).

### Respuesta estructurada de la IA

La IA devuelve siempre un objeto JSON con este esquema:

```json
{
  "mensaje_para_usuario": "Texto que se envía al asegurado",
  "mensaje_entendido": true,
  "datos_extraidos": {
    "asegurado_confirmado": true,
    "nombre_contacto": "Nombre del interlocutor",
    "relacion_contacto": "hijo",
    "telefono_contacto": "34674000000",
    "importe_estimado": "1500 €",
    "acepta_videollamada": true,
    "preferencia_horaria": "mañana",
    "estado_expediente": "valoracion | agendando | finalizado | escalado_humano",
    "tipo_respuesta": "normal | pregunta_identidad | peticion_ubicacion | resumen_final | cierre_definitivo",
    "ubicacion_pendiente": false,
    "idioma_conversacion": "es"
  }
}
```

`ubicacion_pendiente: true` indica que el asegurado ha reconocido la petición de ubicación pero no puede enviarla en ese momento. Activa el **standby de ubicación** (ver Schedulers).

### Cadena de fallback de IA

Por defecto (`AI_USING_PLATFORM=both`) el orden real de intento es:

`GEMINI_MODEL → GEMINI_MODEL_FALLBACKS → OPENAI_MODEL → OPENAI_MODEL_FALLBACKS`

Si un modelo se satura, devuelve `429`, queda retirado o no está disponible, el bot cambia automáticamente al siguiente. Tras unos minutos intenta volver al modelo principal.

### Schedulers automáticos

El scheduler corre cada `SCHEDULER_CHECK_MINUTES` (15 min). Los mensajes de inactividad **solo se envían en horario laboral** (L-V `BUSINESS_HOURS_START`–`BUSINESS_HOURS_END`). Si el timer vence fuera de horario se pospone al inicio del siguiente período laboral — no se acumula deuda. Las tareas de limpieza se ejecutan siempre sin restricción horaria.

| Escenario | Condición | Acción | Límite |
|---|---|---|---|
| **A — Sin respuesta inicial** | `lastUserMessageAt` es null | Reenvío del template inicial | `INITIAL_RETRY_MAX_ATTEMPTS` (3) |
| **B — Inactividad mid-conv** | `lastUserMessageAt` existe y `now > nextReminderAt` | Mensaje de inactividad generado por IA | `INACTIVITY_MAX_ATTEMPTS` (3) |
| **C — Standby de ubicación** | `status=awaiting_location` y `locationStandbyUntil` vencido | Si conv. abierta: mensaje de cierre + PDF + PeritoLine sync con `[IA] Ubicación pendiente (Sin coordenadas)`. Si ya cerrada: solo sync | `LOCATION_STANDBY_HOURS` (96h) |
| **Escalado** | Se supera el límite en A o B | Mensaje de cierre generado por IA (multiidioma), marca `contacto=No`, activa PeritoLine sync y genera PDF | — |

---

## Solicitud de ubicación GPS

Justo antes del resumen final, el bot solicita **siempre** la ubicación del riesgo asegurado. El texto exacto lo define el prompt de `docs/pront/Promp IA Whatsapp.docx` y se adapta al idioma activo de la conversación. Si el asegurado ya compartió la ubicación durante la confirmación de dirección, no se vuelve a pedir.

### Cuando el asegurado no envía la ubicación

Si el asegurado **ignora** la petición y responde con texto, el bot la repite una vez más automáticamente. Si la ignora por segunda vez, activa el standby.

El standby también se activa cuando:

- Dice que lo hará más tarde
- Dice que no puede o no sabe cómo

En todos estos casos:

1. El bot responde con naturalidad y continúa con el resumen sin bloquear el flujo.
2. La IA devuelve `ubicacion_pendiente: true` en `datos_extraidos`.
3. El bot activa el **standby de ubicación**: `status=awaiting_location` + `locationStandbyUntil=now+LOCATION_STANDBY_HOURS`.

Durante el período de standby:
- El asegurado puede enviar la ubicación GPS en cualquier momento → se guardan las coordenadas, se sincroniza PeritoLine (`coordenadas_tardias`) y se desactiva el standby automáticamente.
- Los schedulers de inactividad (Escenarios A/B) **no se aplican** a estas conversaciones.

Al expirar `LOCATION_STANDBY_HOURS` (default: 96h) sin recibir la ubicación, el **Escenario C** del scheduler cierra la conversación (si aún estaba abierta) y dispara un sync a PeritoLine con la anotación `[IA] Ubicación pendiente (Sin coordenadas)` para que el equipo pueda hacer seguimiento.

---

## Almacenamiento de datos

El estado del bot se divide en **dos archivos independientes** para que reemplazar el Excel de negocio nunca afecte las conversaciones activas:

| Archivo | Propósito | Quién lo gestiona |
|---|---|---|
| `data/allianz_latest.xlsx` | Datos de negocio — expedientes, teléfonos, resultados | Equipo Jumar (se puede reemplazar libremente) |
| `data/bot_state.xlsx` | Estado técnico de conversaciones activas | Solo el bot (no tocar manualmente) |

> **Importante:** `data/bot_state.xlsx` se crea automáticamente al primer mensaje. Al arrancar, si el Excel de negocio contiene una hoja `__bot_state` (instalación anterior), se migra automáticamente a `bot_state.xlsx` y se elimina del Excel de negocio.

### `data/allianz_latest.xlsx` — Datos de negocio (hoja principal)

Gestionada por el equipo de Jumar. El bot lee estos campos y escribe el resultado de la conversación:

| Columna | Tipo | Descripción |
|---|---|---|
| `Encargo` | Lectura | Número de expediente |
| `Asegurado` | Lectura | Nombre del titular |
| `Aseguradora` | Lectura | Nombre de la aseguradora |
| `Causa` | Lectura | Causa del siniestro |
| `Observaciones` | Lectura | Notas internas del expediente |
| `Teléfono` | Lectura | Número WhatsApp del asegurado |
| `Dirección`, `CP`, `Municipio` | Lectura | Dirección del siniestro |
| `Contacto` | **Escritura** | `En curso` / `Sí` / `No` / `No encontrado` / `Error` |
| `Relación` | **Escritura** | Relación del interlocutor con el asegurado |
| `AT. Perito` | **Escritura** | Persona que atiende al perito (`nombre - relación - teléfono`) |
| `Daños` | **Escritura** | Estimación económica de los daños |
| `Digital` | **Escritura** | Acepta videoperitación (`Sí` / `No`) |
| `Horario` | **Escritura** | Preferencia horaria (`Mañana` / `Tarde`) |
| `Coordenadas` | **Escritura** | Coordenadas GPS del riesgo (`lat, lon`) si el asegurado las comparte |

### `data/bot_state.xlsx` — Estado técnico (hoja `__bot_state`)

Gestionada exclusivamente por el bot. Persiste el estado entre reinicios. **No sustituir ni editar este archivo manualmente** salvo para recuperación de emergencia:

| Campo | Descripción |
|---|---|
| `waId` | Número de WhatsApp (sin +) |
| `status` | `pending` / `escalated` / `awaiting_location` |
| `stage` | Stage actual de la conversación |
| `lastBotResponseType` | Tipo de la última salida de la IA (`normal`, `peticion_ubicacion`, etc.) |
| `locationRequestCount` | Número de veces que ya se ha pedido la ubicación GPS |
| `attempts` | Reenvíos del template inicial |
| `inactivityAttempts` | Recordatorios de inactividad enviados |
| `nextReminderAt` | Timestamp Unix del próximo scheduler |
| `lastUserMessageAt` | Último mensaje entrante del usuario |
| `lastReminderAt` | Último recordatorio enviado |
| `lastMessageAt` | Última actividad (entrada o salida) |
| `mensajes` | JSON array con el historial completo de la conversación |
| `locationStandbyUntil` | Timestamp Unix hasta el que esperar la ubicación GPS (solo cuando `status=awaiting_location`) |

---

## PDF de transcripción

Al finalizar una conversación (`stage=finalizado` o `stage=escalated`), el bot genera automáticamente un PDF en `docs/conversations/conversation_[nexp].pdf`.

**Contenido del PDF:**

- Cabecera institucional con logotipo de Jumar
- Datos del expediente: nexp, asegurado, aseguradora, dirección, causa
- Datos recogidos en la conversación: estimación de daños, videoperitación, horario, AT. Perito
- Historial completo de mensajes con timestamps y autor (bot / asegurado)
- Pie con fecha y hora de generación

Los PDFs se eliminan automáticamente a los `PDF_CLEANUP_DAYS` días (ver [Limpieza automática](#limpieza-automática-de-datos)).

**Generación manual:**

```javascript
const { generateConversationPdf } = require('./src/utils/pdfGenerator');
await generateConversationPdf(nexp, userData, mensajes, { stage, contacto, attPerito, danos, digital, horario });
```

---

## Sincronización con PeritoLine

La sincronización se dispara en **dos momentos** distintos del ciclo de vida de una conversación:

| Momento | Trigger | Acciones en PeritoLine |
|---|---|---|
| **Primera respuesta** | El usuario envía su primer mensaje | Asignar perito virtual, marcar contacto inicial |
| **Cierre de conversación** | `stage=finalizado` o `stage=escalated` | Actualizar observaciones especiales, escribir anotación del encargo y subir PDF |

En ambos casos, `triggerEncargoSync(nexp, reason, anotacion)` comprueba el cooldown (`PERITOLINE_AUTO_SYNC_COOLDOWN_MS`) y que no haya ya una ejecución en curso para ese nexp, luego lanza `scripts/peritoline_sync.js` como child process (`child.unref()`) sin bloquear el hilo principal.

### Sin calendario automático

El flujo conversacional actual **no crea citas en Outlook ni propone huecos automáticos**. Si el asegurado acepta la videoperitación y responde `mañana` o `tarde`, el bot:

1. guarda `Digital` y `Horario` en el Excel,
2. cierra la conversación,
3. dispara el sync final de PeritoLine.

La gestión posterior de la cita se hace fuera del bot.

### Anotación automática del encargo

El script escribe en el campo **Anotación Encargo 01** (máx. 128 caracteres) de PeritoLine el resultado de la gestión:

| Valor `Contacto` en Excel | Anotación escrita |
|---|---|
| `Sí` + videoperitación aceptada | `[IA] Digital: Sí` o `[IA] Digital: Sí (Mañana/Tarde)` |
| `Sí` + visita presencial | `[IA] Digital: No` |
| `No` (nunca respondió al primer mensaje) | `[IA] Asegurado no responde` |
| `No` (dejó de responder a mitad) | `[IA] Asegurado deja de responder` |
| `No encontrado` | `[IA] Teléfono no encontrado` |
| `Error` | `[IA] Contacto erróneo` |
| Standby de ubicación expirado | `[IA] Ubicación pendiente (Sin coordenadas)` |

### Variables relevantes

| Variable | Descripción |
|---|---|
| `PERITOLINE_AUTO_SYNC` | Activar/desactivar (default: `true`) |
| `PERITOLINE_AUTO_SYNC_COOLDOWN_MS` | Tiempo mínimo entre sincronizaciones del mismo nexp (default: `45000`) |
| `PERITOLINE_AUTO_SYNC_HEADLESS` | Playwright en modo headless (default: `true`) |
| `PERITOLINE_AUTO_SYNC_SLOW_MO` | Ralentización Playwright en ms (default: `0`) |
| `PERITOLINE_AUTO_SYNC_DRY_RUN` | Simular sin subir datos (default: `false`) |
| `UPLOAD_CONVERSATIONS_TO_PL` | Activar subida del PDF de conversación (default: `true`) |
| `PERITOLINE_VIRTUAL_PERITO_NAME` | Nombre del perito virtual a asignar en primera respuesta |

### Sincronización manual

```bash
npm run peritoline:sync -- --encargo 880337292
npm run peritoline:sync -- --encargo 880337292 --anotacion "[IA] Digital: Sí"
```

---

## Sistema de logs por expediente

Además del log de consola (PII-safe), el bot persiste errores e incidencias en archivos organizados por número de expediente (`nexp`).

### Estructura de directorios

```
logs/
  [nexp]/
    bot.log              ← errores e incidencias del bot (INFO / WARN / ERROR)
    playwright/
      peritoline.log     ← salida completa del proceso playwright para este encargo
```

Cada directorio `[nexp]` se crea automáticamente la primera vez que se registra un evento para ese expediente.

### Qué se registra

| Archivo | Origen | Contenido |
|---|---|---|
| `[nexp]/bot.log` | `messageHandler.js` | Errores críticos en el procesamiento del mensaje, warnings de la IA (mensaje vacío, bucles), fallos al generar PDF |
| `[nexp]/bot.log` | `reminderScheduler.js` | Errores en reenvíos del template inicial, mensajes de inactividad y cierre por inactividad |
| `[nexp]/playwright/peritoline.log` | `peritolineAutoSync.js` | Toda la salida (stdout + stderr) del proceso Playwright: login, navegación, acciones en PeritoLine, errores |

### Formato de entrada

```
2026-03-18T09:01:31.952Z [ERROR] Error crítico en processMessage: Cannot read ...
2026-03-18T09:05:12.001Z [WARN]  IA devolvió mensaje vacío — se solicita una nueva redacción
2026-03-18T09:10:00.000Z === Sync iniciado | encargo=880337292 | motivo=primera_respuesta ===
2026-03-18T09:10:03.210Z ✅ Perito virtual asignado correctamente
2026-03-18T09:10:05.500Z === Sync finalizado OK | encargo=880337292 ===
```

### Limpieza automática

Las carpetas de log se eliminan cuando la **fecha de creación** del directorio supera `MAX_AGE_DAYS` (7 días), lo que coincide con el ciclo de vida del expediente. La limpieza se ejecuta al arrancar el servidor y después cada semana (ver [Limpieza automática de datos](#limpieza-automática-de-datos)).

---

## Limpieza automática de datos

El scheduler ejecuta las tareas de limpieza en cada ciclo, sin restricción horaria:

| Tarea | Criterio | Variable |
|---|---|---|
| Eliminar filas del Excel | Filas con `Fecha Encargo` anterior a N días | `SINIESTRO_CLEANUP_DAYS` (7) |
| Eliminar PDFs | Archivos en `docs/conversations/` con más de N días | `PDF_CLEANUP_DAYS` (7) |
| Eliminar logs de debug | Archivos `debug_*.png` / `debug_*.html` en `logs/` con más de N días | `SINIESTRO_CLEANUP_DAYS` (7) |
| Eliminar carpetas de log `[nexp]` | Directorios en `logs/` cuya **fecha de creación** supere 7 días | fijo (7 días) |

Las filas eliminadas del Excel se loguean con su nexp. Una vez eliminada una fila, ese número de expediente ya no será procesado por el bot.

---

## Tests

Suite de tests unitarios con el runner nativo de Node.js (`node:test`, sin dependencias externas):

```bash
npm test
```

| Fichero | Qué cubre |
|---|---|
| `tests/unit/stateMachine.test.js` | `canProcess()`, `isValidTransition()`, stages terminales |
| `tests/unit/dedup.test.js` | `isDuplicate()` — deduplicación por messageId |
| `tests/unit/rateLimiter.test.js` | `checkLimit()` — límites por usuario y global |
| `tests/unit/messageHandlerUtils.test.js` | Utilidades del handler: estimación económica, normalización de teléfono, confirmación afirmativa, extracción de relación, preferencia horaria |
| `tests/unit/schedulerUtils.test.js` | `nextBusinessHoursStart()` — cálculo del próximo período laboral |

---

## Estructura del proyecto

```
chatbot_ia/
├── src/
│   ├── channels/
│   │   └── whatsappAdapter.js       # Adaptador Meta Cloud API
│   ├── utils/
│   │   ├── logger.js                # Logging seguro sin PII (consola)
│   │   ├── fileLogger.js            # Logging en archivos por expediente (logs/[nexp]/)
│   │   ├── atomicWrite.js           # Escritura atómica JSON + permisos
│   │   ├── excelManager.js          # I/O del Excel de negocio y del fichero de estado técnico
│   │   └── pdfGenerator.js          # Generación de PDFs + limpieza de debug logs
│   ├── bot/
│   │   ├── index.js                 # Servidor Express + webhook handler
│   │   ├── messageHandler.js        # Pipeline de procesamiento de mensajes
│   │   ├── conversationManager.js   # CRUD de estado + migración de datos
│   │   ├── stateMachine.js          # Stages y transiciones válidas
│   │   ├── reminderScheduler.js     # Scheduler unificado (inactividad + recordatorios)
│   │   ├── peritolineAutoSync.js    # Disparador asíncrono de sincronización PeritoLine
│   │   ├── sendMessage.js           # Envío de mensajes WhatsApp (bajo nivel)
│   │   ├── templateSender.js        # Envío del template inicial
│   │   ├── dedup.js                 # Deduplicación por messageId
│   │   └── rateLimiter.js           # Rate limit por usuario y global
│   ├── ai/
│   │   └── aiModel.js               # Cliente Gemini/OpenAI con fallback de proveedores y modelos
│   └── sendInitialMessage.js        # CLI de envío masivo desde Excel
├── data/
│   ├── allianz_latest.xlsx          # Excel fuente de negocio
│   └── bot_state.xlsx               # Estado técnico persistente del bot
├── docs/
│   ├── pront/
│   │   └── Promp IA Whatsapp.docx   # System prompt (reglas 1-7 + variables del expediente)
│   └── conversations/
│       └── conversation_[nexp].pdf  # Transcripciones generadas automáticamente
├── scripts/
│   ├── peritoline_sync.js           # Script de sincronización con PeritoLine (Playwright)
│   └── ngrok_webhook.sh             # Helper para desarrollo con ngrok
├── logs/
│   ├── [nexp]/
│   │   ├── bot.log                  # Errores e incidencias del bot para este encargo
│   │   └── playwright/
│   │       └── peritoline.log       # Salida del proceso playwright para este encargo
│   └── debug_*.png / debug_*.html   # Snapshots de debug playwright (eliminados automáticamente)
├── tests/
│   └── unit/                        # Tests unitarios (node:test)
└── package.json
```

---

## Seguridad implementada

### Logging sin PII (`src/utils/logger.js`)

```javascript
const log = require('./utils/logger');

log.info('Enviando a 346123456789');   // → "Enviando a 3461***89"
log.info({ telefono, nombre, text });  // campos enmascarados automáticamente
log.debug('payload completo:', body);  // solo visible con LOG_LEVEL=debug
```

| Tipo de campo | Tratamiento automático |
|---|---|
| `telefono`, `phone` | `3461***89` (4 primeros + 2 últimos dígitos) |
| `nombre`, `firstName`, `lastName` | Iniciales + asteriscos (`M**** G****`) |
| `text`, `body`, `payload`, `mensaje` | Truncado a 80 caracteres |
| `Error` en producción | Solo `.message`; stack completo con `LOG_LEVEL=debug` |
| Cuerpos HTTP completos | Solo en `log.debug` (silenciado en producción) |

### Escritura atómica (`src/utils/atomicWrite.js`)

- Escribe a `archivo.PID.tmp` y luego hace `rename()` atómico al destino
- Un crash a mitad de escritura **nunca deja el fichero corrupto**
- Permisos en Linux/WSL: directorios `data/` → `700`, ficheros → `600`

### Deduplicación (`src/bot/dedup.js`)

- Evita procesar dos veces el mismo mensaje si Meta reintenta el webhook
- Clave: `channel:userId:messageId` con TTL de 10 minutos

### Rate limiting (`src/bot/rateLimiter.js`)

- **Por usuario**: `RATE_USER_MAX` mensajes / `RATE_USER_WIN_MS` (default: 10/min)
- **Global**: `RATE_GLOBAL_MAX` mensajes / `RATE_GLOBAL_WIN_MS` (default: 60/min)
- Si se supera el límite: drop silencioso (no se responde para no crear bucles)

### Máquina de estados (`src/bot/stateMachine.js`)

- Bloquea el flujo normal si el stage es terminal
- Permite una última respuesta segura generada por IA cuando el expediente está `finalizado` o `escalated`, y después lo deja en `cerrado`
- `isValidTransition(from, to)` valida transiciones antes de persistirlas

### Fallback de modelos IA (`src/ai/aiModel.js`)

- Orden por defecto: `GEMINI_MODEL → GEMINI_MODEL_FALLBACKS → OPENAI_MODEL → OPENAI_MODEL_FALLBACKS`
- Cambia automáticamente ante errores transitorios (`429`, saturación, timeouts, modelos retirados o sin acceso)
- Tras 5 minutos intenta volver al modelo principal del proveedor
- Si fallan todos los modelos disponibles, devuelve una respuesta segura para escalar el caso

---

## Endpoints HTTP

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` | Health check básico (`{ status: "ok" }`) |
| `GET` | `/health` | Estado detallado (modelo IA, tokens configurados) |
| `GET` | `/webhook` | Verificación del webhook de Meta (challenge) |
| `POST` | `/webhook` | Recibe mensajes entrantes de WhatsApp |
