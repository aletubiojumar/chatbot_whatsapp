# Bot Pericial Jumar

Chatbot conversacional para la gestión de siniestros de seguros. Contacta con los asegurados via WhatsApp, verifica datos del expediente y coordina la visita del perito — todo mediante IA (Gemini) integrada con la Meta Cloud API.

---

## Índice

1. [Arquitectura](#arquitectura)
2. [Requisitos](#requisitos)
3. [Instalación](#instalación)
4. [Configuración (.env)](#configuración-env)
5. [Arranque](#arranque)
6. [Envío de mensajes iniciales](#envío-de-mensajes-iniciales)
7. [Flujo de la conversación](#flujo-de-la-conversación)
8. [Estructura del proyecto](#estructura-del-proyecto)
9. [Seguridad implementada](#seguridad-implementada)
10. [Endpoints HTTP](#endpoints-http)

---

## Arquitectura

El proyecto se organiza en tres capas independientes:

```
┌─────────────────────────────────────────────────────────┐
│  CORE  —  lógica de negocio (agnóstica al canal)         │
│  conversationManager · stateMachine                      │
│  dedup · rateLimiter · aiModel                           │
├─────────────────────────────────────────────────────────┤
│  CANAL  —  adaptador de mensajería                       │
│  whatsappAdapter   (Meta Cloud API)                      │
├─────────────────────────────────────────────────────────┤
│  INFRA  —  servidor y schedulers                         │
│  index.js (Express + webhook)                            │
│  reminderScheduler                                       │
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
- API Key de Google AI Studio (Gemini)
- HTTPS público para el webhook (producción) o ngrok (desarrollo)

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
GEMINI_API_KEY=           # API Key de Google AI Studio
GEMINI_MODEL=gemini-2.5-flash
GEMINI_MODEL_FALLBACKS=gemini-1.5-flash,gemini-1.5-flash-8b
GEMINI_TEMPERATURE=0.0    # 0.0 = más determinístico, 1.0 = más creativo
GEMINI_TOP_P=0.95

# ── WhatsApp / Meta ───────────────────────────────────────────────────────
META_VERIFY_TOKEN=        # Token de verificación del webhook de Meta
META_ACCESS_TOKEN=        # Token de acceso de la app de Meta
META_PHONE_NUMBER_ID=     # ID del número de teléfono de WhatsApp Business
WHATSAPP_API_VERSION=v19.0

# ── Servidor ─────────────────────────────────────────────────────────────
PORT=3000
HOST=127.0.0.1
WEBHOOK_URL=              # URL HTTPS pública (ej: https://botjumar.com)

# ── Almacenamiento ────────────────────────────────────────────────────────
DATA_DIR=./data
CONVERSATIONS_FILE=./data/conversations.json
EXCEL_PATH=./data/allianz_latest.xlsx

# ── Schedulers ────────────────────────────────────────────────────────────
SCHEDULER_CHECK_MINUTES=15       # Frecuencia de verificación del scheduler
MSG_FINAL_INACTIVIDAD=           # Mensaje a enviar al escalar por inactividad

# ── Rate limiting ─────────────────────────────────────────────────────────
RATE_USER_MAX=10          # Mensajes máximos por usuario por ventana
RATE_USER_WIN_MS=60000    # Duración de la ventana por usuario (ms)
RATE_GLOBAL_MAX=60        # Mensajes máximos globales por ventana
RATE_GLOBAL_WIN_MS=60000  # Duración de la ventana global (ms)

# ── Logging ───────────────────────────────────────────────────────────────
# LOG_LEVEL=debug         # Activar logs detallados (solo en dev)
# NODE_ENV=development    # Alternativa para activar debug
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

Los mensajes iniciales se envían desde el Excel de expedientes (`data/allianz_latest.xlsx`). El script lee los expedientes del Excel y envía el template de WhatsApp aprobado a cada asegurado.

```bash
# Enviar un expediente concreto
npm run send -- EXP2024001

# Enviar todos los pendientes del Excel
npm run send -- --all

# Listar expedientes y su estado
npm run send -- --list
```

---

## Flujo de la conversación

### Stages (máquina de estados)

```
consent → identification → valoracion → agendando → finalizado → cerrado (terminal)
    └─────────────────────────────────────────────┘
    (cualquier stage puede derivar a)    ──────────► escalated (terminal)
```

| Stage | Descripción |
|---|---|
| `consent` | Usuario confirma continuar por este medio |
| `identification` | Verificamos nombre, dirección y fecha del siniestro |
| `valoracion` | Tipo de visita, urgencia, estimación de daños |
| `agendando` | Coordinamos fecha y hora de la visita pericial |
| `finalizado` | IA envía mensaje final y transiciona a `cerrado` |
| `cerrado` | Silencio total — **terminal, IA bloqueada** |
| `escalated` | Derivado a atención humana — **terminal, IA bloqueada** |

### Tipos de mensaje soportados

| Tipo WhatsApp | Tratamiento |
|---|---|
| `text` | Procesado directamente por la IA |
| `location` | Coordenadas → reverse geocoding (Nominatim) → dirección en texto → IA |
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
  7. procesarConIA()       → Gemini genera respuesta estructurada en JSON
  8. adapter.sendText()    → envía respuesta al usuario por WhatsApp
```

### Schedulers automáticos

| Scheduler | Intervalo | Acción |
|---|---|---|
| Escenario A (sin respuesta inicial) | Cada 6h | Reenvío del template inicial × 3; tras el último, escala a humano |
| Escenario B (inactividad mid-conv) | Cada 2h | Mensaje "¿Sigue ahí?" × 3; tras el último, escala a humano |

El scheduler corre cada `SCHEDULER_CHECK_MINUTES` (15 min) y solo actúa en horario laboral (L-V 9:00-20:00).

---

## Estructura del proyecto

```
chatbot_ia/
├── src/
│   ├── channels/
│   │   └── whatsappAdapter.js      # Adaptador Meta Cloud API
│   ├── utils/
│   │   ├── logger.js               # Logging seguro sin PII
│   │   ├── atomicWrite.js          # Escritura atómica JSON + permisos
│   │   └── excelManager.js         # Lectura/escritura del Excel de expedientes
│   ├── bot/
│   │   ├── index.js                # Servidor Express + webhook handler
│   │   ├── messageHandler.js       # Procesa mensajes con IA
│   │   ├── conversationManager.js  # Estado de conversaciones (JSON)
│   │   ├── stateMachine.js         # Stages y transiciones válidas
│   │   ├── dedup.js                # Deduplicación por messageId
│   │   ├── rateLimiter.js          # Rate limit por usuario y global
│   │   └── reminderScheduler.js    # Scheduler unificado de recordatorios e inactividad
│   ├── ai/
│   │   └── aiModel.js              # Cliente Gemini con fallback de modelos
│   └── sendInitialMessage.js       # CLI de envío masivo desde Excel
├── data/
│   ├── conversations.json          # Estado de conversaciones activas
│   └── allianz_latest.xlsx         # Excel fuente de expedientes
├── docs/
│   └── pront/
│       └── Promp IA Whatsapp.docx  # System prompt + plantilla del primer mensaje
└── package.json
```

### Formato de datos persistidos

**`data/conversations.json`**
```json
{
  "34612345678": {
    "chatId": "34612345678",
    "status": "pending",
    "stage": "identification",
    "attempts": 1,
    "lastUserMessageAt": 1708000000000,
    "nextReminderAt": 1708021600000,
    "contactoMarcado": false,
    "userData": { "nexp": "EXP001", "nombre": "…", "telefono": "…" },
    "mensajes": [
      { "direction": "out", "text": "…", "timestamp": "…" },
      { "direction": "in",  "text": "…", "timestamp": "…" }
    ]
  }
}
```

---

## Seguridad implementada

### Logging sin PII (`src/utils/logger.js`)

```javascript
const log = require('./utils/logger');

log.info('Enviando a 346123456789');        // → "Enviando a 3461***89"
log.info({ telefono, nombre, text });       // campos enmascarados automáticamente
log.debug('payload completo:', body);       // solo visible con LOG_LEVEL=debug
log.maskPhone('346123456789')              // → '3461***89'
log.maskName('María García')              // → 'M**** G****'
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
- Permisos en Linux/WSL: directorios `data/` → `700`, ficheros JSON → `600`

### Deduplicación (`src/bot/dedup.js`)

- Evita procesar dos veces el mismo mensaje si Meta reintenta el webhook
- Clave: `channel:userId:messageId` con TTL de 10 minutos

### Rate limiting (`src/bot/rateLimiter.js`)

- **Por usuario**: `RATE_USER_MAX` mensajes / `RATE_USER_WIN_MS` (default: 10/min)
- **Global**: `RATE_GLOBAL_MAX` mensajes / `RATE_GLOBAL_WIN_MS` (default: 60/min)
- Si se supera el límite: drop silencioso (no se responde al usuario para no crear bucles)

### Máquina de estados (`src/bot/stateMachine.js`)

- Bloquea la llamada a Gemini si el stage es `cerrado` o `escalated`
- Responde con mensajes predefinidos seguros en lugar de llamar a la IA
- `isValidTransition(from, to)` para validar transiciones antes de persistirlas

### Fallback de modelos Gemini (`src/ai/aiModel.js`)

- Modelo primario: `gemini-2.5-flash`
- Fallbacks: `gemini-1.5-flash`, `gemini-1.5-flash-8b`
- Cambia automáticamente ante errores 429/RESOURCE_EXHAUSTED y vuelve al primario tras 5 min

---

## Endpoints HTTP

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` | Health check básico (`{ status: "ok" }`) |
| `GET` | `/health` | Estado detallado (modelo IA, tokens configurados) |
| `GET` | `/webhook` | Verificación del webhook de Meta (challenge) |
| `POST` | `/webhook` | Recibe mensajes entrantes de WhatsApp |
