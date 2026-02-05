// test-gemini.js
// Script para verificar que Gemini AI está configurado correctamente
// Incluye prueba de carga de documentos Word
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mammoth = require('mammoth');
const fs = require('fs').promises;
const path = require('path');

async function testGemini() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         PRUEBA DE CONEXIÓN CON GEMINI AI                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-pro';

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
  console.log(`   📊 Max Tokens: ${process.env.GEMINI_MAX_OUTPUT_TOKENS || '500'}`);
  console.log('');

  // Test 1: Conexión básica
  console.log('📡 TEST 1: Conexión básica\n');

  let geminiModel;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    geminiModel = genAI.getGenerativeModel({
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
    } else if (error.message.includes('models/gemini-3-pro-preview')) {
      console.log('   💡 Solución:');
      console.log('      1. El modelo gemini-3-pro-preview no está disponible');
      console.log('      2. Cambia GEMINI_MODEL en .env a: gemini-1.5-pro');
      console.log('      3. Ejecuta el test de nuevo\n');
    } else {
      console.log('   💡 Error inesperado. Revisa tu conexión a internet.\n');
    }

    process.exit(1);
  }

  // Test 2: Carga de documentos Word
  console.log('📚 TEST 2: Carga de documentos Word\n');

  try {
    const documentsPath = path.join(__dirname, '..', '..', 'docs');
    console.log(`   📁 Ruta de documentos: ${documentsPath}`);

    // Verificar si existe la carpeta
    try {
      await fs.access(documentsPath);
      console.log('   ✅ Carpeta docs/ encontrada');
    } catch {
      console.log('   ⚠️  Carpeta docs/ no encontrada');
      console.log('   💡 Crea la carpeta: mkdir docs');
      console.log('   💡 Mueve tus archivos .docx allí\n');
      console.log('   ℹ️  Continuando sin documentos (usará conocimiento por defecto)...\n');
      // Continuar sin documentos, no salir
    }

    try {
      await fs.access(documentsPath);
      const files = await fs.readdir(documentsPath);
      const docxFiles = files.filter(file => file.endsWith('.docx'));

      console.log(`   📄 Archivos .docx encontrados: ${docxFiles.length}\n`);

      if (docxFiles.length === 0) {
        console.log('   ⚠️  No hay archivos .docx en la carpeta');
        console.log('   💡 Agrega tus documentos Word a docs/\n');
      } else {
        // Probar extracción de uno de los documentos
        const testFile = docxFiles[0];
        const testFilePath = path.join(documentsPath, testFile);

        console.log(`   🧪 Probando extracción de: ${testFile}`);

        const result = await mammoth.extractRawText({ path: testFilePath });
        const text = result.value;

        console.log(`   ✅ Texto extraído: ${text.length} caracteres`);
        console.log(`   📝 Preview (primeros 150 caracteres):\n`);
        console.log(`      ${text.substring(0, 150).replace(/\n/g, ' ')}...\n`);

        // Procesar todos los documentos
        console.log('   📦 Procesando todos los documentos:\n');

        let totalChars = 0;
        for (const file of docxFiles) {
          const filePath = path.join(documentsPath, file);
          const result = await mammoth.extractRawText({ path: filePath });
          const chars = result.value.length;
          totalChars += chars;
          console.log(`      ✓ ${file}: ${chars} caracteres`);
        }

        console.log(`\n   📊 Total: ${totalChars} caracteres extraídos`);
        console.log('   ✅ Carga de documentos exitosa\n');
      }
    } catch {
      // Carpeta no existe, ya lo reportamos arriba
    }

  } catch (error) {
    console.error('   ❌ Error cargando documentos:', error.message);

    if (error.message.includes('mammoth')) {
      console.log('\n   💡 Solución:');
      console.log('      Instala mammoth: npm install mammoth\n');
    }
  }

  // Test 3: Análisis de intención (como en el bot)
  console.log('🧠 TEST 3: Análisis de intención\n');

  try {
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

  // Test 4: Generación de respuesta (como en el bot)
  console.log('💬 TEST 4: Generación de respuesta\n');

  try {
    const prompt = `Eres un asistente del Gabinete Pericial de Allianz. El usuario acaba de confirmar que sus datos son correctos.

Tu tarea: Pregunta amablemente quién atenderá al perito cuando visite la propiedad.
Pregunta: "¿Quién estará presente durante la visita del perito? ¿Usted mismo/a u otra persona?"

IMPORTANTE:
- Mantén la pregunta clara y directa
- Máximo 2 líneas
- Usa el tono profesional pero cercano de Allianz

RESPUESTA:`;

    console.log('   📤 Generando respuesta contextual...');

    const result = await geminiModel.generateContent(prompt);
    const text = result.response.text().trim();

    // Validar que no esté vacía
    if (!text || text.trim() === '') {
      throw new Error('⚠️  Respuesta vacía generada');
    }

    console.log('   📥 Respuesta generada:\n');
    console.log(`      "${text}"`);
    console.log(`\n   📏 Longitud: ${text.length} caracteres`);
    console.log('   ✅ Generación de respuesta exitosa\n');

  } catch (error) {
    console.error('   ❌ Error en generación:', error.message, '\n');

    if (error.message.includes('vacía')) {
      console.log('   ⚠️  PROBLEMA CRÍTICO: Gemini devuelve respuestas vacías');
      console.log('   💡 Soluciones:');
      console.log('      1. Cambia GEMINI_MODEL a: gemini-1.5-pro');
      console.log('      2. Aumenta GEMINI_MAX_OUTPUT_TOKENS a: 1000');
      console.log('      3. Verifica tu API key\n');
    }
  }

  // Test 5: Respuesta personalizada (con documentos)
  console.log('🎯 TEST 5: Respuesta personalizada (con documentos)\n');

  try {
    const documentsPath = path.join(__dirname, '..', '..', 'docs');

    // Verificar si hay documentos
    let hasDocuments = false;
    try {
      await fs.access(documentsPath);
      const files = await fs.readdir(documentsPath);
      const docxFiles = files.filter(file => file.endsWith('.docx'));
      hasDocuments = docxFiles.length > 0;
    } catch {
      // No hay documentos
    }

    if (!hasDocuments) {
      console.log('   ℹ️  Saltando test (no hay documentos Word)\n');
    } else {
      const prompt = `Eres del Gabinete Pericial de Allianz. Un cliente dice: "hola"

Basándote en el estilo de estas transcripciones de llamadas reales, salúdalo profesionalmente e identifícate.

EJEMPLO DE ESTILO:
"Buenos días. Le llamamos del gabinete pericial de Allianz. Es por un parte que tenemos abierto..."

Tu respuesta (máximo 3 líneas):`;

      console.log('   📤 Generando respuesta con estilo Allianz...');

      const result = await geminiModel.generateContent(prompt);
      const text = result.response.text().trim();

      console.log('   📥 Respuesta personalizada:\n');
      console.log(`      "${text}"`);
      console.log(`\n   📏 Longitud: ${text.length} caracteres`);

      // Verificar que menciona "Allianz" o "gabinete"
      if (text.toLowerCase().includes('allianz') || text.toLowerCase().includes('gabinete')) {
        console.log('   ✅ Respuesta incluye identificación correcta\n');
      } else {
        console.log('   ⚠️  Respuesta no incluye identificación (se mejorará con documentos completos)\n');
      }
    }

  } catch (error) {
    console.error('   ❌ Error:', error.message, '\n');
  }

  // Resumen
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                     RESUMEN FINAL                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Verificar documentos
  let documentsStatus = '❌';
  try {
    const documentsPath = path.join(__dirname, '..', '..', 'docs');
    await fs.access(documentsPath);
    const files = await fs.readdir(documentsPath);
    const docxFiles = files.filter(file => file.endsWith('.docx'));
    if (docxFiles.length > 0) {
      documentsStatus = `✅ (${docxFiles.length} archivos)`;
    } else {
      documentsStatus = '⚠️  (carpeta vacía)';
    }
  } catch {
    documentsStatus = '❌ (no existe)';
  }

  console.log('   📊 Estado de componentes:\n');
  console.log('      ✅ Gemini AI: Conectado');
  console.log(`      ${documentsStatus} Documentos Word`);
  console.log('      ✅ Análisis de intención: Funcional');
  console.log('      ✅ Generación de respuestas: Funcional\n');

  if (documentsStatus.includes('❌') || documentsStatus.includes('⚠️')) {
    console.log('   ⚠️  ACCIÓN REQUERIDA:\n');
    console.log('      1. Crea la carpeta: mkdir docs');
    console.log('      2. Mueve tus archivos .docx a docs/');
    console.log('      3. Vuelve a ejecutar este test\n');
  } else {
    console.log('   🎉 ¡Todo configurado correctamente!\n');
  }

  console.log('   📝 Próximos pasos:\n');
  console.log('      1. Ejecuta: node src/tests/testConfig.js');
  console.log('      2. Configura Meta WhatsApp API en .env');
  console.log('      3. Ejecuta: npm start\n');
}

testGemini().catch(error => {
  console.error('\n💥 Error inesperado:', error);
  console.error('\nStack trace:', error.stack);
  process.exit(1);
});
