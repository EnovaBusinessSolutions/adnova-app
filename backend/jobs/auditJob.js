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

function areaToCat(raw = '') {
  const a = raw.toLowerCase()
               .normalize('NFD')
               .replace(/[\u0300-\u036f]/g, ''); 

  if (a.includes('seo'))                                  return 'seo';
  if (a.includes('performance') || a.includes('rendimiento') || a.includes('velocidad'))
                                                          return 'performance';
  if (a.includes('media') || a.includes('imagen') || a.includes('video'))
                                                          return 'media';
  return 'ux'; 
}

function mapIssuesLegacy(issuesObj = {}) {
  const cats = ['ux', 'seo', 'performance', 'media'];
  const out  = {};
  cats.forEach(cat => {
    out[cat] = (issuesObj[cat] || []).map(i => ({
      title:         i.title        || i.label || 'Hallazgo',
      description:   i.description  || i.body  || '',
      severity:      i.severity     || 'medium',
      recommendation:i.recommendation || i.solution || ''
    }));
  });
  return out;
}

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

async function generarAuditoriaIA(shop, accessToken) {
  try {
    
    const products = await fetchShopifyProductsGraphQL(shop, accessToken);

    if (!products.length) {
      return {
        productsAnalizados: 0,
        resumen:     'No se encontraron productos para auditar.',
        actionCenter:[],
        issues:      { productos: [] }
      };
    }

 
       const prompt = `
Eres un consultor experto en Shopify con enfoque en ecommerce de alto nivel.

Vas a auditar los siguientes productos de una tienda real y debes identificar TODOS los problemas, advertencias u oportunidades en las siguientes áreas para CADA producto:
- Nombre del producto
- Descripción
- Categorías y etiquetas (tags)
- Imágenes y medios (calidad, cantidad, variedad, optimización)
- Precios (competitividad, errores, best practices)
- SEO (meta, URL, campos faltantes, densidad de keywords, etc.)
- Inventario (stock bajo o excesivo, productos sin stock)
- Atributos adicionales relevantes (ej. variantes, opciones, políticas, etc.)

**INSTRUCCIONES:**
- Responde SOLO en JSON en español, con la estructura exacta abajo (no agregues ningún texto extra, solo el JSON).
- Para cada área analiza CADA producto por separado.
- Explica claramente cada hallazgo: por qué es un problema, su impacto y cómo resolverlo.
- Prioriza problemas críticos y marca con "high" la severidad si afecta ventas, SEO o la experiencia de usuario.
- Las recomendaciones deben ser concretas y fáciles de implementar.

ESTRUCTURA DE RESPUESTA:
{
  "resumen": "Breve resumen ejecutivo con los principales problemas detectados y el impacto para la tienda.",
  "actionCenter": [
    {
      "title": "Problema prioritario",
      "description": "Descripción clara del problema detectado.",
      "severity": "high | medium | low",
      "button": "Acción sugerida"
    }
    // Máximo 5 problemas críticos para toda la tienda
  ],
  "issues": {
    "productos": [
      {
        "nombre": "Nombre del producto",
        "hallazgos": [
          {
            "area": "Nombre/Descripción/Imagenes/SEO/Precio/Inventario/etc",
            "title": "Resumen del problema",
            "description": "Explicación detallada del problema u oportunidad de mejora.",
            "severity": "high | medium | low",
            "recommendation": "Recomendación precisa para solucionar o mejorar."
          }
        ]
      }
      // ... Repite para cada producto auditado
    ]
  }
}

Ahora, analiza estos productos reales de Shopify:
${JSON.stringify(products)}
`.trim();


    const completion = await openai.chat.completions.create({
      model:       'gpt-4-1106-preview',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  4096
    });

   
    const raw      = completion.choices[0].message.content.trim();
    const cleaned  = raw
       .replace(/```(json)?/gi, '')       
       .replace(/,\s*([\}\]])/g, '$1');    

    let aiResult   = JSON.parse(cleaned);


    aiResult.actionCenter = (aiResult.actionCenter || []).map(a => ({
      title:       a.title       || a.label || 'Acción',
      description: a.description || a.body  || '',
      severity:    a.severity    || 'medium',
      button:      a.button      || a.cta   || 'Revisar'
    }));


    let buckets = { ux: [], seo: [], performance: [], media: [] };

    if (aiResult.issues?.productos) {
   
      aiResult.issues.productos.forEach(prod => {
        (prod.hallazgos || []).forEach(h => {
          const cat = areaToCat(h.area);
          buckets[cat].push({ ...h, productName: prod.nombre });
        });
      });
    } else {

      buckets = mapIssuesLegacy(aiResult.issues);
    }

    aiResult.issues = buckets;

    return { productsAnalizados: products.length, ...aiResult };

  } catch (err) {
    console.error('❌ Error generando auditoría:', err);
    return {
      productsAnalizados: 0,
      resumen:     'Error generando la auditoría IA.',
      actionCenter:[],
      issues:      { ux: [], seo: [], performance: [], media: [] }
    };
  }
}

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
      name:    p.name    || p.title || '',
      sales:   p.sales   || p.qtySold || 0,
      revenue: p.revenue || 0
    })),
    customerStats: { newPct: clients.newPct, repeatPct: clients.repeatPct },
    productsAnalizados: ia.productsAnalizados,
    resumen:            ia.resumen,
    actionCenter:       ia.actionCenter,
    issues:             ia.issues
  });

  return { saved: true };
}

module.exports = { generarAuditoriaIA, procesarAuditoria };
