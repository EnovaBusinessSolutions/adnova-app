const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const { generarAuditoriaIA } = require('./jobs/auditJob');

const redis = new IORedis(process.env.REDIS_URL);

const auditQueue = new Queue('audit', { connection: redis });

// Agrega un trabajo a la cola
async function enqueueAudit(shop, accessToken) {
  return await auditQueue.add('audit', { shop, accessToken });
}

// Obtiene el trabajo por ID
async function getJob(jobId) {
  return await auditQueue.getJob(jobId);
}

// Worker: ejecuta la auditoría IA en background
new Worker('audit', async job => {
  const { shop, accessToken } = job.data;
  // Aquí llamas a la función que genera la auditoría usando IA y Shopify
  return await generarAuditoriaIA(shop, accessToken);
}, { connection: redis });

module.exports = { enqueueAudit, getJob };
