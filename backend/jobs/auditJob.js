// backend/jobs/auditJob.js
const OpenAI = require('openai');
const axios  = require('axios');

const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VERSION = process.env.SHOPIFY_API_VERSION || '2024-07';

const Audit  = require('../models/Audit');
const {
  getSalesMetrics,
  getProductMetrics,
  getCustomerMetrics,
} = require('../services/shopifyMetrics');

/* -------------------------------------------------------------------------- */
/*  Utils                                                                     */
/* -------------------------------------------------------------------------- */
function mapIssues(raw = {}) {
  if (raw.productos) return raw;               // formato nuevo OK
  // legacy → agrupa
  return {
    productos: [
      {
        nombre: 'GLOBAL',
        hallazgos: ['ux','seo','performance','media']
          .flatMap(cat => (raw[cat] || []).map(h => ({ ...h, area: cat })))
      }
    ]
  };
}

/* Trae hasta 250 productos (sin paginar) */
async function fetchProducts(shop, token) {
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
    `https://${shop}/admin/api/${VERSION}/graphql.json`,
    { query },
    { headers: { 'X-Shopify-Access-Token': token } }
  );
  return (data.data.products.edges || []).map(e => e.node);
}

/* -------------------------------------------------------------------------- */
/*  IA                                                                        */
/* -------------------------------------------------------------------------- */
async function generarAuditoriaIA(shop, token) {
  try {
    const products = await fetchProducts(shop, token);

    if (!products.length) {
      return {
        productsAnalizados: 0,
        resumen: 'No se encontraron productos para auditar.',
        actionCenter: [],
        issues: { productos: [] }
      };
    }

    const prompt = `
Eres un consultor de Shopify. Audita cada producto y clasifica **cada hallazgo** SOLO en una de las siguientes áreas exactas:
- UX
- SEO
- Performance
- Media

Responde SOLO en JSON con esta estructura exacta y sin texto adicional:

{
  "resumen": "",
  "actionCenter": [
    { "title":"", "description":"", "severity":"high|medium|low", "button":"Acción" }
  ],
  "issues": {
    "productos":[
      {
        "nombre":"",
        "hallazgos":[
          { "area":"UX|SEO|Performance|Media", "title":"", "description":"", "severity":"high|medium|low", "recommendation":"" }
        ]
      }
    ]
  }
}

Asegúrate de incluir **todos** los hallazgos relevantes.
Productos a analizar:
${JSON.stringify(products)}
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4-1106-preview',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096
    });

    /* -------------- Parse robusto --------------- */
    const raw     = completion.choices[0].message.content.replace(/```json?|```/g, '');
    const parsed  = JSON.parse(raw);
    const issues  = mapIssues(parsed.issues);

    /* ──────────────────────────────────────────────
   Generar arrays planos por categoría UX / SEO / Performance / Media
   ────────────────────────────────────────────── */
const flat = { ux: [], seo: [], performance: [], media: [] };

/* Función auxiliar: decide a qué categoría pertenece el hallazgo */
const detectCat = area => {
  const a = (area || '').toLowerCase();
  if (a.includes('seo'))                      return 'seo';
  if (a.includes('performance') ||
      a.includes('rendimiento'))             return 'performance';
  if (a.includes('media') ||
      a.includes('imagen')  ||
      a.includes('video'))                   return 'media';
  /* por defecto todo lo demás lo tratamos como UX */
  return 'ux';
};

/* Recorre todos los hallazgos y rellena flat */
(issues.productos || []).forEach(prod => {
  (prod.hallazgos || []).forEach(h => {
    const cat = detectCat(h.area);
    flat[cat].push(h);
  });
});

/* Combina: mantenemos “productos” + añadimos los 4 arrays planos */
const issuesFinal = { ...issues, ...flat };


    /* Construye centro de acciones con todo lo HIGH (fallback a medium) */
    const extraAC = [];
    issues.productos.forEach(p =>
      p.hallazgos.forEach(h => {
        if (h.severity === 'high') {
          extraAC.push({
            title: `[${p.nombre}] ${h.title}`,
            description: h.description,
            severity: 'high',
            button: 'Ver detalle'
          });
        }
      })
    );
    const actionCenter = [
      ...parsed.actionCenter,
      ...extraAC
    ];

    return {
      productsAnalizados: products.length,
      resumen: parsed.resumen,
      actionCenter,
      issues: issuesFinal
    };

  } catch (err) {
    console.error('❌ Error IA auditoría:', err);
    return {
      productsAnalizados: 0,
      resumen: 'Error generando auditoría IA.',
      actionCenter: [],
      issues: { productos: [] }
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Guardar auditoría completa                                                */
/* -------------------------------------------------------------------------- */
async function procesarAuditoria(userId, shopDomain, token) {
  const ia      = await generarAuditoriaIA(shopDomain, token);
  const sales   = await getSalesMetrics(shopDomain, token);
  const prod    = await getProductMetrics(shopDomain, token);
  const clients = await getCustomerMetrics(shopDomain, token);

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
