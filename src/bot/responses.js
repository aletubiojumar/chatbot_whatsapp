// responses.js
const responses = {
  // =========================
  // FUERA DE HORARIO
  // =========================
  closedMessage: `Ahora estamos cerrados, le atenderemos entre las 8:00 am y las 21:00. Un saludo.`,

  // =========================
  // RESPUESTAS DIRECTAS A BOTONES
  // (el botón existe, pero la respuesta textual sigue siendo necesaria)
  // =========================
  noEsAsegurado: `Disculpe las molestias. Un saludo.`,

  ocupado: `Sin problema, entendemos que está ocupado/a. Le volveremos a contactar en 6 horas.`,

  // =========================
  // TEXTO LIBRE – CORRECCIONES
  // =========================
  pedirDatosCorregidos: `De acuerdo. Por favor, indíquenos los datos corregidos en un solo mensaje.

Ejemplo:
- Dirección: ...
- Fecha de ocurrencia: ...
- Nombre del asegurado: ...`,

  confirmarDatosCorregidos: (texto) => `Perfecto. Estos son los datos corregidos que nos ha indicado:

${texto}

¿Son correctos?

Responda:
- Sí
- No`,

  // =========================
  // ESCALADO / RECORDATORIOS
  // =========================
  escalation: `Debido a que no hemos recibido respuesta, se procederá a la llamada por parte del perito.

Un saludo.`,

  // =========================
  // FINALIZACIÓN
  // =========================
  conversacionFinalizada: `Gracias por su tiempo. La conversación ha finalizado.`,

  // =========================
  // FALLBACK GENÉRICO
  // =========================
  default: `No he entendido su respuesta. Por favor, responda según las opciones indicadas.`
};

module.exports = responses;
