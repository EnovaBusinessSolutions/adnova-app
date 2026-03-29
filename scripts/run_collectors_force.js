const mongoose = require('mongoose');
require('dotenv').config();

const { collectMeta } = require('../backend/jobs/collect/metaCollector');
const { collectGoogle } = require('../backend/jobs/collect/googleCollector');

async function testCollectors() {
  const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!MONGODB_URI) {
    console.error("No se encontró MONGODB_URI/MONGO_URI en las variables de entorno.");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log("✅ Conectado a MongoDB");

  // Reemplaza este userId por el de tu usuario admin/demo que estamos debuggeando
  const userId = '69c21ceefa3f5aff06abc9aa'; // ID base (Ajustalo al correcto de ser necesario)

  console.log('--- Iniciando Colector de META ---');
  try {
    const metaResult = await collectMeta(userId, { rangeDays: 30 }); // Un mes
    console.log("META COLLECTOR RESULTADO:");
    console.log(JSON.stringify(metaResult, null, 2));
  } catch(e) {
    console.error("Error en Meta:", e);
  }

  console.log('\n--- Iniciando Colector de GOOGLE ---');
  try {
    const googleResult = await collectGoogle(userId, { rangeDays: 30, forceIds: ['2379904178'] });
    console.log("GOOGLE COLLECTOR RESULTADO:");
    console.log(JSON.stringify(googleResult, null, 2));
  } catch(e) {
    console.error("Error en Google:", e);
  }

  process.exit();
}

testCollectors();
