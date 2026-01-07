const responses = {
  // ETAPA INICIAL - Identificación del asegurado
  initialMessage: `Buenos días, Le contactamos desde el gabinete pericial del seguro del hogar por un siniestro comunicado.

Por favor, responda con el número de la opción:

1️⃣ Sí, soy el asegurado/a
2️⃣ No soy el asegurado/a  
3️⃣ Ahora no puedo atender`,

  aseguradoConfirmado: `Gracias.
Le escribimos para gestionar la intervención pericial del siniestro comunicado a su seguro.
¿Comprende el motivo de este contacto?

Por favor responda:
- Sí
- No`,

  noEsAsegurado: `Se procederá a la llamada por parte del perito al asegurado. Un saludo.`,

  ocupado: `Sin problema, entendemos que está ocupado/a. Le volveremos a contactar más tarde.`,

  initialStageHelp: `Por favor, responda con una de estas opciones:

1️⃣ Sí, soy el asegurado/a
2️⃣ No soy el asegurado/a  
3️⃣ Ahora no puedo atender`,

  // ETAPA 2 - Comprensión del motivo
  comprendeMotivo: `Perfecto, gracias por confirmar.

Un perito se pondrá en contacto con usted en las próximas 24-48 horas para coordinar la visita y evaluar el siniestro.

Si tiene alguna duda, no dude en contactarnos. ¡Que tenga un buen día!`,

  noComprendeMotivo: `Entendemos. Le explicaremos con más detalle:

Ha comunicado un siniestro en su seguro del hogar y necesitamos que un perito profesional visite su propiedad para evaluar los daños y poder gestionar su reclamación.

Un perito se pondrá en contacto con usted próximamente para explicarle todo el proceso. Un saludo.`,

  identityConfirmedStageHelp: `Por favor, responda:
- Sí (si comprende el motivo del contacto)
- No (si necesita más información)`,

  // RECORDATORIOS
  reminder: `Buenos días, Le contactamos nuevamente desde el gabinete pericial del seguro del hogar por un siniestro comunicado.

¿Podría confirmar su identidad?

1️⃣ Sí, soy el asegurado/a
2️⃣ No soy el asegurado/a  
3️⃣ Ahora no puedo atender`,

  escalation: `Debido a que no hemos recibido respuesta, se procederá a la llamada por parte del perito.

Un saludo.`,

  // MENSAJES GENERALES
  conversacionFinalizada: `Gracias por su tiempo. La conversación ha finalizado. 

Si necesita algo más, por favor contáctenos.`,

  default: `No he entendido su respuesta. Por favor, responda según las opciones indicadas.`
};

module.exports = responses;