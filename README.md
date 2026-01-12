# 🤖 WhatsApp Bot – Gestión de Siniestros Hogar

Bot de WhatsApp desarrollado en **Node.js** para la **gestión automatizada de siniestros de hogar**, integrando **Twilio WhatsApp**, mensajes con **botones (templates)** y **texto libre**, con control de inactividad y derivación a administración cuando es necesario.

---

## 🚀 Funcionalidades principales

- 📲 Comunicación vía **WhatsApp (Twilio)**
- 🧭 Flujo guiado por **etapas (stages)** y **estados (status)**
- 🔘 Uso de **templates con botones** cuando procede
- ✍️ Texto libre solo cuando el bot lo solicita explícitamente
- ⏱️ Detección de **inactividad del usuario**
- 🔁 Pregunta automática: “¿Desea continuar la conversación?”
- 🧑‍💼 Oferta automática: “¿Desea hablar con administración?”
- 🕒 Control de **horario de atención**
- 💤 Opción *No puedo atender*
- 🧪 Tests manuales

---

## 🧠 Lógica clave

El bot distingue entre:
- **Templates con botones**
- **Mensajes de texto libre**

Controlado mediante:
```js
lastPromptType: 'buttons' | 'text'
```

---

## 🗂️ Estructura del proyecto

```text
src/
├── bot/
├── tests/
├── data/
├── .env
├── package.json
└── README.md
```

---

## ⚙️ Variables de entorno

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=whatsapp:+14155238886
PORT=3000
```

---

## ▶️ Ejecución

```bash
npm install
node src/bot/index.js
```

---

## 📄 Documentación

- mensajes_bot_actualizado.docx

---

Área de trabajo de Juande
