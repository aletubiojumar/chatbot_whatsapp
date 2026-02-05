// list-gemini-models.js
// Script para listar modelos disponibles de Gemini
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         MODELOS DISPONIBLES DE GEMINI AI                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ Error: GEMINI_API_KEY no está configurado en .env\n');
    process.exit(1);
  }
  
  console.log(`📋 API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}\n`);
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    console.log('🔍 Consultando modelos disponibles...\n');
    
    // Intentar obtener la lista de modelos
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.models || data.models.length === 0) {
      console.log('⚠️  No se encontraron modelos disponibles\n');
      return;
    }
    
    console.log(`✅ Se encontraron ${data.models.length} modelos disponibles:\n`);
    console.log('═'.repeat(80) + '\n');
    
    // Filtrar solo modelos que soporten generateContent
    const generateModels = data.models.filter(model => 
      model.supportedGenerationMethods?.includes('generateContent')
    );
    
    console.log('📌 MODELOS RECOMENDADOS PARA EL BOT:\n');
    
    generateModels.forEach((model, index) => {
      const name = model.name.replace('models/', '');
      const displayName = model.displayName || 'N/A';
      const description = model.description || 'Sin descripción';
      
      // Marcar modelos recomendados
      let recommended = '';
      if (name.includes('gemini-1.5-flash')) {
        recommended = ' ⭐ RÁPIDO Y EFICIENTE';
      } else if (name.includes('gemini-1.5-pro')) {
        recommended = ' ⭐⭐ MEJOR CALIDAD';
      } else if (name.includes('gemini-2')) {
        recommended = ' 🆕 NUEVO';
      }
      
      console.log(`${index + 1}. ${name}${recommended}`);
      console.log(`   Display: ${displayName}`);
      console.log(`   Descripción: ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}`);
      
      if (model.inputTokenLimit) {
        console.log(`   Input tokens: ${model.inputTokenLimit.toLocaleString()}`);
      }
      if (model.outputTokenLimit) {
        console.log(`   Output tokens: ${model.outputTokenLimit.toLocaleString()}`);
      }
      
      console.log('');
    });
    
    console.log('═'.repeat(80) + '\n');
    
    // Sugerencias
    console.log('💡 RECOMENDACIONES PARA TU BOT:\n');
    
    const flash = generateModels.find(m => m.name.includes('gemini-1.5-flash'));
    const pro = generateModels.find(m => m.name.includes('gemini-1.5-pro'));
    const gemini2 = generateModels.find(m => m.name.includes('gemini-2'));
    
    if (flash) {
      const flashName = flash.name.replace('models/', '');
      console.log(`   1️⃣  Para PRODUCCIÓN (rápido, económico):`);
      console.log(`       GEMINI_MODEL=${flashName}`);
      console.log('');
    }
    
    if (pro) {
      const proName = pro.name.replace('models/', '');
      console.log(`   2️⃣  Para MEJOR CALIDAD (más preciso):`);
      console.log(`       GEMINI_MODEL=${proName}`);
      console.log('');
    }
    
    if (gemini2) {
      const gemini2Name = gemini2.name.replace('models/', '');
      console.log(`   3️⃣  ÚLTIMO MODELO (experimental):`);
      console.log(`       GEMINI_MODEL=${gemini2Name}`);
      console.log('');
    }
    
    console.log('═'.repeat(80) + '\n');
    
    // Probar un modelo
    console.log('🧪 PROBANDO MODELO RECOMENDADO...\n');
    
    const testModelName = flash?.name.replace('models/', '') || 
                          pro?.name.replace('models/', '') ||
                          generateModels[0]?.name.replace('models/', '');
    
    if (testModelName) {
      console.log(`📤 Probando: ${testModelName}`);
      
      try {
        const testModel = genAI.getGenerativeModel({ model: testModelName });
        const result = await testModel.generateContent('Di "Hola, funciono correctamente" en español');
        const text = result.response.text();
        
        console.log(`📥 Respuesta: "${text}"`);
        console.log('✅ Modelo funciona correctamente\n');
        
        console.log('🎯 CONFIGURACIÓN RECOMENDADA PARA .env:\n');
        console.log(`GEMINI_MODEL=${testModelName}`);
        console.log('GEMINI_MAX_OUTPUT_TOKENS=1000');
        console.log('GEMINI_TEMPERATURE=0.7\n');
        
      } catch (testError) {
        console.error(`❌ Error probando modelo: ${testError.message}\n`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error obteniendo modelos:', error.message);
    console.error('\n💡 Posibles causas:');
    console.error('   1. API Key inválida o expirada');
    console.error('   2. Límite de cuota excedido');
    console.error('   3. Problemas de conexión\n');
    
    console.log('🔄 Intentando con modelos conocidos...\n');
    
    // Lista de modelos conocidos para probar
    const knownModels = [
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-pro-latest',
      'gemini-pro',
      'gemini-pro-vision'
    ];
    
    console.log('Probando modelos conocidos:\n');
    
    const genAI = new GoogleGenerativeAI(apiKey);
    
    for (const modelName of knownModels) {
      try {
        process.stdout.write(`   Testing ${modelName}... `);
        
        const testModel = genAI.getGenerativeModel({ model: modelName });
        const result = await testModel.generateContent('Hola');
        const text = result.response.text();
        
        if (text) {
          console.log('✅ FUNCIONA');
          
          if (modelName === knownModels[0]) {
            console.log('\n🎯 USA ESTE EN TU .env:');
            console.log(`   GEMINI_MODEL=${modelName}\n`);
          }
        }
      } catch (e) {
        console.log(`❌ No disponible`);
      }
    }
  }
}

listModels().catch(error => {
  console.error('\n💥 Error inesperado:', error);
  process.exit(1);
});