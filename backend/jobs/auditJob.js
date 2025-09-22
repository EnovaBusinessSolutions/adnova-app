// jobs/auditJob.js
'use strict';
const Audit = require('../models/Audit');
const { collectGoogle } = require('./collect/googleCollector');
const { collectMeta }   = require('./collect/metaCollector');
const { collectShopify }= require('./collect/shopifyCollector');
const { generateAudit } = require('./llm/generateAudit');

async function runAuditFor({ userId, type }) {
  try {
    let inputSnapshot = null;

    if (type === 'google')  inputSnapshot = await collectGoogle(userId);
    if (type === 'meta')    inputSnapshot = await collectMeta(userId);
    if (type === 'shopify') inputSnapshot = await collectShopify(userId);
    if (!inputSnapshot) throw new Error('SNAPSHOT_EMPTY');

    const auditJson = await generateAudit({ type, inputSnapshot });
    // Fallback si IA falló
    const auditDoc = {
      userId,
      type,
      generatedAt: new Date(),
      summary: auditJson?.summary || 'Auditoría generada',
      issues: auditJson?.issues || [],
      actionCenter: auditJson?.actionCenter || (auditJson?.issues || []).slice(0,3),
      topProducts: auditJson?.topProducts || [],
      inputSnapshot,
      version: 'audits@1.0.0'
    };

    await Audit.create(auditDoc);
    return true;
  } catch (e) {
    // Guarda issue de setup si aplica
    await Audit.create({
      userId, type, generatedAt: new Date(),
      summary: 'No se pudo generar la auditoría',
      issues: [{
        id: 'setup_incompleto',
        area: 'setup', severity: 'alta',
        title: 'Faltan datos o permisos',
        evidence: String(e.message || e),
        recommendation: 'Verifica la conexión y permisos. En Google Ads, selecciona un customerId por defecto.'
      }],
      actionCenter: [],
      inputSnapshot: {}
    });
    return false;
  }
}

module.exports = { runAuditFor };
