const { Configuration, OpenAIApi } = require('openai');
const axios = require('axios');

// Lee tus claves desde .env
const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-04';

// Función de ejemplo: genera auditoría básica con IA
async function generarAuditoriaIA(shop, accessToken) {
  // 1. Obtén productos de Shopify
  const products = await axios.get(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/products.json`, {
    headers: { 'X-Shopify-Access-Token': accessToken }
  }).then(res => res.data.products);

  // 2. Pide recomendaciones a OpenAI (puedes enriquecer el prompt)
  const prompt = `Eres un consultor experto en tiendas Shopify. Revisa estos productos y dime 3 puntos débiles y cómo mejorarlos en nombre, descripción, SEO o UX: ${JSON.stringify(products.slice(0,5))}`;
  
  const completion = await openai.createChatCompletion({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 600,
  });

  return {
    productsAnalizados: products.length,
    recomendaciones: completion.data.choices[0].message.content,
  };
}

module.exports = { generarAuditoriaIA };
