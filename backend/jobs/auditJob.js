// backend/jobs/auditJob.js
const OpenAI = require('openai');
const axios  = require('axios');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-07';
const Audit  = require('../models/Audit');
const {
  getSalesMetrics,
  getProductMetrics,
  getCustomerMetrics,
} = require('../services/shopifyMetrics');

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */
// Devuelve issues sin tocar si ya vienen en formato nuevo (productos)
function mapIssues(issuesObj = {}) {
  if (issuesObj.productos) return issuesObj;   // nuevo formato OK

  // ↳ Legacy: convertir ux/seo/… si fuese necesario (mantengo compatibilidad)
  const cats = ['ux', 'seo', 'performance', 'media'];
  const out  = {};
  cats.forEach(c => {
    out[c] = (issuesObj[c] || []).map(i => ({
      title: i.title || i.label || 'Hallazgo',
      description: i.description || i.body || '',
      severity: i.severity || 'medium',
      recommendation: i.recommendation || i.solution || ''
    }));
  });
  return out;
}

/* Trae hasta 250 productos con GraphQL (sin paginación adicional) */
async function fetchShopifyProductsGraphQL(shop, accessToken) {
  const query = `
    {
      products(first: 250) {
        edges {
          node {
            id title description tags productType status
            images(first:10){edges{node{originalSrc altText}}}
            variants(first:10){edges{node{id title price sku inventoryQuantity}}}
            vendor handle totalInventory publishedAt createdAt updatedAt
          }
        }
      }
    }`;
  const { data } = await axios.post(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    { query },
    { headers: { 'X-Shopify-Access-Token': accessToken } }
  );
  return (data.data.products.edges || []).map(e => e.node);
}

/* -------------------------------------------------------------------------- */
/*  Generar auditoría con IA                                                  */
/* -------------------------------------------------------------------------- */
async function generarAuditoriaIA(shop, accessToken) {
  try {
    const products = await fetchShopifyProductsGraphQL(shop, accessToken);

    if (!products.length) {
      return {
        productsAnalizados: 0,
        resumen: 'No se encontraron productos para auditar.',
        actionCenter: [],
        issues: { productos: [] }
      };
    }

    /* Prompt */
    const prompt = `
Eres un consultor experto en Shopify con enfoque en ecommerce de alto nivel.

Vas a auditar los siguientes productos y debes identificar TODOS los problemas, advertencias u oportunidades en:
- Nombre
- Descripción
- Tags
- Imágenes y medios
- Precios
- SEO
- Inventario
- Otros atributos (variantes, políticas, etc.)

Responde SOLO en JSON con la estructura:
{
  "resumen": "...",
  "actionCenter": [ { "title": "...", "description": "...", "severity": "high|medium|low", "button": "..." } ],
  "issues": {
    "productos": [
      {
        "nombre": "Producto X",
        "hallazgos": [
          { "area": "SEO", "title": "...", "description": "...", "severity": "high|medium|low", "recommendation": "..." }
        ]
      }
    ]
  }
}

Analiza estos productos:
${JSON.stringify(products)}
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4-1106-preview',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096
    });

    /* ---------- Limpieza y parseo robusto ---------- */
    const raw = completion.choices[0].message.content.trim();
    const cleaned = raw
      .replace(/```(json)?/gi, '')        // fences
      .replace(/,\s*([\}\]])/g, '$1');    // comas finales
    let aiResult = JSON.parse(cleaned);

    /* Normaliza actionCenter */
    aiResult.actionCenter = (aiResult.actionCenter || []).map(it => ({
      title: it.title || it.label || 'Acción',
      description: it.description || it.body || '',
      severity: it.severity || 'medium',
      button: it.button || it.cta || 'Revisar'
    }));

    /* Mantén issues tal cual o legacy-map */
    aiResult.issues = mapIssues(aiResult.issues);

    return { productsAnalizados: products.length, ...aiResult };

  } catch (err) {
    console.error('❌ Error generando auditoría:', err);
    return {
      productsAnalizados: 0,
      resumen: 'Error generando la auditoría IA.',
      actionCenter: [],
      issues: { productos: [] }
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Guardar auditoría completa                                               */
/* -------------------------------------------------------------------------- */
async function procesarAuditoria(userId, shopDomain, accessToken) {
  const ia      = await generarAuditoriaIA(shopDomain, accessToken);
  const sales   = await getSalesMetrics(shopDomain, accessToken);
  const prod    = await getProductMetrics(shopDomain, accessToken);
  const clients = await getCustomerMetrics(shopDomain, accessToken);

  await Audit.create({
    userId,
    shopDomain,
    salesLast30:   sales.totalSales,
    ordersLast30:  sales.totalOrders,
    avgOrderValue: sales.avgOrderValue,
    topProducts:   (prod.topProducts || []).map(p => ({
      name: p.name || p.title || '',
      sales: p.sales || p.qtySold || 0,
      revenue: p.revenue || 0
    })),
    customerStats: { newPct: clients.newPct, repeatPct: clients.repeatPct },
    productsAnalizados: ia.productsAnalizados,
    resumen: ia.resumen,
    actionCenter: ia.actionCenter,
    issues: ia.issues
  });

  return { saved: true };
}

module.exports = { generarAuditoriaIA, procesarAuditoria };
