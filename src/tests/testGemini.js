// test-gemini.js
// Script para verificar que Gemini AI está configurado correctamente
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         PRUEBA DE CONEXIÓN CON GEMINI AI                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
  
  // Verificar API Key
  console.log('🔍 Verificando configuración...\n');
  
  if (!apiKey) {
    console.error('❌ Error: GEMINI_API_KEY no está configurado en .env\n');
    console.log('💡 Solución:');
    console.log('   1. Ve a: https://makersuite.google.com/app/apikey');
    console.log('   2. Genera una API Key');
    console.log('   3. Agrégala a tu archivo .env como:');
    console.log('      GEMINI_API_KEY=tu_api_key_aqui\n');
    process.exit(1);
  }
  
  console.log('✅ Variables de entorno:');
  console.log(`   📋 API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);
  console.log(`   🤖 Modelo: ${model}`);
  console.log(`   🌡️  Temperatura: ${process.env.GEMINI_TEMPERATURE || '0.7'}`);
  console.log('');
  
  // Test 1: Conexión básica
  console.log('📡 TEST 1: Conexión básica\n');
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({ 
      model,
      generationConfig: {
        temperature: Number(process.env.GEMINI_TEMPERATURE || 0.7),
        topP: Number(process.env.GEMINI_TOP_P || 0.95),
        topK: Number(process.env.GEMINI_TOP_K || 40),
        maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 500),
      }
    });
    
    console.log('   📤 Enviando prompt de prueba...');
    const result = await geminiModel.generateContent('Di "Hola, funciono correctamente" en español');
    const response = result.response;
    const text = response.text();
    
    console.log('   📥 Respuesta recibida:\n');
    console.log(`      "${text}"\n`);
    console.log('   ✅ Conexión exitosa\n');
    
  } catch (error) {
    console.error('   ❌ Error:', error.message, '\n');
    
    if (error.message.includes('API_KEY_INVALID') || error.message.includes('Invalid API key')) {
      console.log('   💡 Solución:');
      console.log('      1. Verifica que tu API Key sea correcta');
      console.log('      2. Ve a: https://makersuite.google.com/app/apikey');
      console.log('      3. Genera una nueva si es necesario\n');
    } else if (error.message.includes('quota')) {
      console.log('   💡 Solución:');
      console.log('      1. Has excedido tu cuota gratuita');
      console.log('      2. Espera un momento o habilita facturación\n');
    } else {
      console.log('   💡 Error inesperado. Revisa tu conexión a internet.\n');
    }
    
    process.exit(1);
  }
  
  // Test 2: Análisis de intención (como en el bot)
  console.log('🧠 TEST 2: Análisis de intención\n');
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({ model });
    
    const testMessage = 'Sí, todo correcto';
    
    console.log(`   📤 Analizando mensaje: "${testMessage}"`);
    
    const prompt = `Analiza el siguiente mensaje de un usuario en contexto de gestión de siniestros de seguros:

MENSAJE: "${testMessage}"

Responde SOLO con un JSON válido (sin markdown, sin explicaciones) en este formato exacto:
{
  "intent": "<confirmar_datos, corregir_datos, proporcionar_informacion, solicitar_ayuda, fuera_de_tema, frustrado, confundido>",
  "sentiment": "<positivo, neutral o negativo>",
  "needsHumanSupport": <true o false>,
  "confidence": <número entre 0.0 y 1.0>
}

IMPORTANTE: Responde SOLO con el JSON, sin ningún texto adicional.`;

    const result = await geminiModel.generateContent(prompt);
    const text = result.response.text().trim();
    
    // Extraer JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      console.log('   📥 Análisis completado:\n');
      console.log(`      Intent: ${analysis.intent}`);
      console.log(`      Sentiment: ${analysis.sentiment}`);
      console.log(`      Needs Human: ${analysis.needsHumanSupport}`);
      console.log(`      Confidence: ${analysis.confidence}\n`);
      console.log('   ✅ Análisis de intención exitoso\n');
    } else {
      throw new Error('No se pudo extraer JSON de la respuesta');
    }
    
  } catch (error) {
    console.error('   ❌ Error en análisis:', error.message, '\n');
    console.log('   ⚠️  El análisis falló pero la conexión básica funciona\n');
  }
  
  // Test 3: Generación de respuesta (como en el bot)
  console.log('💬 TEST 3: Generación de respuesta\n');
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({ model });
    
    const prompt = `Eres un asistente de una compañía de seguros. El usuario acaba de confirmar que sus datos son correctos.

Tu tarea: Pregunta amablemente quién atenderá al perito cuando visite la propiedad.
Pregunta: "¿Quién estará presente durante la visita del perito? ¿Usted mismo/a u otra persona?"

IMPORTANTE: Mantén la pregunta clara y directa. Máximo 2 líneas.

RESPUESTA:`;

    console.log('   📤 Generando respuesta contextual...');
    
    const result = await geminiModel.generateContent(prompt);
    const text = result.response.text().trim();
    
    console.log('   📥 Respuesta generada:\n');
    console.log(`      "${text}"\n`);
    console.log('   ✅ Generación de respuesta exitosa\n');
    
  } catch (error) {
    console.error('   ❌ Error en generación:', error.message, '\n');
  }
  
  // Resumen
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                     RESUMEN FINAL                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log('   🎉 ¡Gemini AI está configurado correctamente!\n');
  console.log('   📝 Próximos pasos:');
  console.log('      1. Ejecuta: node test-config.js');
  console.log('      2. Configura Meta WhatsApp API en .env');
  console.log('      3. Ejecuta: npm start\n');
}

testGemini().catch(error => {
  console.error('\n💥 Error inesperado:', error);
  process.exit(1);
});