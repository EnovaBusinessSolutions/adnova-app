// backend/jobs/auditJob.js
const OpenAI = require('openai');
const axios  = require('axios');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-04';
const Audit = require('../models/Audit');
const {
  getSalesMetrics,
  getProductMetrics,
  getCustomerMetrics,
} = require('../services/shopifyMetrics');

// Helper para mapear issues al formato correcto
function mapIssues(issuesObj) {
  const categories = ['ux', 'seo', 'performance', 'media'];
  const result = {};
  for (const cat of categories) {
    result[cat] = (issuesObj && issuesObj[cat] ? issuesObj[cat] : []).map(issue => ({
      title: issue.title || issue.label || 'Hallazgo',
      description: issue.description || issue.body || '',
      severity: issue.severity || 'medium',
      recommendation: issue.recommendation || issue.solution || ''
      // Puedes agregar screenshot si la IA algún día lo trae
    }));
  }
  return result;
}

async function generarAuditoriaIA(shop, accessToken) {
  try {
    // 1. Obtener productos de Shopify
    const { data } = await axios.get(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json`,
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    const products = data.products;

    if (!products?.length) {
      return {
        productsAnalizados: 0,
        actionCenter: [],
        issues: { ux: [], seo: [], performance: [], media: [] }
      };
    }

    // 2. Prompt forzando estructura JSON correcta
    const prompt = `
Eres un consultor experto en Shopify.
Analiza los siguientes productos y responde SOLO en formato JSON en español, siguiendo EXACTAMENTE esta estructura (no agregues nada fuera del JSON):

{
  "actionCenter": [
    {
      "title": "Meta descripción faltante",
      "description": "El producto X no tiene meta descripción.",
      "severity": "high",
      "button": "Optimizar"
    }
    // Máximo 4 problemas prioritarios
  ],
  "issues": {
    "ux": [
      {
        "title": "Nombre poco descriptivo",
        "description": "El producto Y tiene un nombre poco claro.",
        "severity": "medium",
        "recommendation": "Mejorar el nombre para describir mejor el producto."
      }
    ],
    "seo": [
      {
        "title": "Sin tags",
        "description": "El producto Z no tiene tags.",
        "severity": "medium",
        "recommendation": "Agregar etiquetas relevantes para SEO."
      }
    ],
    "performance": [],
    "media": []
  }
}

Analiza estos productos de Shopify:
${JSON.stringify(products.slice(0, 5))}
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 900,
    });

    let aiResult;
    try {
      aiResult = JSON.parse(completion.choices[0].message.content);
      // Mapeo para garantizar formato correcto aunque la IA falle en los campos
      aiResult.issues = mapIssues(aiResult.issues);
      // También mapea actionCenter por si viene mal
      aiResult.actionCenter = (aiResult.actionCenter || []).map(item => ({
        title: item.title || item.label || 'Acción',
        description: item.description || item.body || '',
        severity: item.severity || 'medium',
        button: item.button || item.cta || 'Revisar'
      }));
    } catch (e) {
      aiResult = {
        actionCenter: [],
        issues: { ux: [], seo: [], performance: [], media: [] }
      };
    }

    return {
      productsAnalizados: products.length,
      ...aiResult
    };

  } catch (error) {
    console.error('❌ Error generando auditoría:', error);
    return {
      productsAnalizados: 0,
      actionCenter: [],
      issues: { ux: [], seo: [], performance: [], media: [] }
    };
  }
}

async function procesarAuditoria(userId, shopDomain, accessToken) {
  // 1. IA para hallazgos y action center
  const ia = await generarAuditoriaIA(shopDomain, accessToken);

  // 2. Métricas Shopify
  const sales   = await getSalesMetrics(shopDomain, accessToken);
  const prod    = await getProductMetrics(shopDomain, accessToken);
  const clients = await getCustomerMetrics(shopDomain, accessToken);

  // 3. Estructura el objeto perfectamente alineado con el modelo y frontend
  await Audit.create({
    userId,
    shopDomain,
    salesLast30: sales.totalSales,
    ordersLast30: sales.totalOrders,
    avgOrderValue: sales.avgOrderValue,
    topProducts: (prod.topProducts || []).map(p => ({
      name: p.name || p.title || '',
      sales: p.sales || p.qtySold || 0,
      revenue: p.revenue || 0
    })),
    customerStats: {
      newPct: clients.newPct,
      repeatPct: clients.repeatPct
    },
    productsAnalizados: ia.productsAnalizados,
    actionCenter: ia.actionCenter,
    issues: ia.issues
  });

  return { saved: true };
}

module.exports = { generarAuditoriaIA, procesarAuditoria };
