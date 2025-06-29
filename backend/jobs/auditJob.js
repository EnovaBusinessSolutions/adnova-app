const OpenAI = require('openai');
const axios  = require('axios');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-04';

async function generarAuditoriaIA(shop, accessToken) {
  try {
    // 1. Productos de Shopify
    const { data } = await axios.get(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json`,
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    const products = data.products;

    if (!products?.length) {
      return {
        productsAnalizados: 0,
        recomendaciones: 'No se encontraron productos en la tienda para analizar.',
      };
    }

    // 2. Prompt a OpenAI
    const prompt = `
      Eres un consultor experto en Shopify.
      Revisa estos productos y dame 3 puntos débiles y cómo mejorarlos en nombre,
      descripción, SEO o UX:\n${JSON.stringify(products.slice(0, 5))}
    `.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
    });

    return {
      productsAnalizados: products.length,
      recomendaciones: completion.choices[0].message.content,
    };
  } catch (error) {
    console.error('❌ Error generando auditoría:', error);
    return {
      productsAnalizados: 0,
      recomendaciones: 'Error al generar la auditoría: ' + (error.message || error),
    };
  }
}

module.exports = { generarAuditoriaIA };
