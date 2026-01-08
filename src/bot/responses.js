const responses = {
  // MENSAJE FUERA DE HORARIO
  closedMessage: `Hola, ahora mismo estamos cerrados, te atenderemos entre las 8:00 am y las 21:00. Un saludo`,

  // ETAPA INICIAL - Identificación del asegurado
  initialMessage: `Buenos días, Le contactamos desde el gabinete pericial del seguro del hogar por un siniestro comunicado.

Por favor, responda con el número de la opción:

1️⃣ Sí, soy el asegurado/a
2️⃣ No soy el asegurado/a  
3️⃣ Ahora no puedo atender`,

  // Respuesta cuando dice "No soy el asegurado"
  noEsAsegurado: `Ha sido un error, disculpe las molestias. Un saludo.`,

  // Respuesta cuando dice "Ahora no puedo atender"
  ocupado: `Sin problema, entendemos que está ocupado/a. Le volveremos a contactar en 6 horas.`,

  initialStageHelp: `Por favor, responda con una de estas opciones:

1️⃣ Sí, soy el asegurado/a
2️⃣ No soy el asegurado/a  
3️⃣ Ahora no puedo atender`,

  // ETAPA 2 - Verificación de datos (se envía con template de botones)
  datosCorrectos: `Perfecto, gracias por confirmar los datos.

Un perito se pondrá en contacto con usted en las próximas 24-48 horas para coordinar la visita y evaluar el siniestro.

Si tiene alguna duda, no dude en contactarnos. ¡Que tenga un buen día!`,

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

  datosIncorrectos: `Ha sido un error, disculpe las molestias. Un saludo.`,

  identityConfirmedStageHelp: `Por favor, responda:
- Sí, son correctos
- No, hay algún error`,

  // RECORDATORIOS
  reminder: `Buenos días, Le contactamos nuevamente desde el gabinete pericial del seguro del hogar por un siniestro comunicado.

¿Podría confirmar su identidad?

1️⃣ Sí, soy el asegurado/a
2️⃣ No soy el asegurado/a  
3️⃣ Ahora no puedo atender`,

  escalation: `Debido a que no hemos recibido respuesta, se procederá a la llamada por parte del perito.

Un saludo.`,

  // MENSAJES GENERALES
  conversacionFinalizada: `Gracias por su tiempo. La conversación ha finalizado.`,

  default: `No he entendido su respuesta. Por favor, responda según las opciones indicadas.`
};

module.exports = responses;