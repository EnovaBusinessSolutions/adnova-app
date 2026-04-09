#!/usr/bin/env node
'use strict';

/**
 * Crea o actualiza un cliente OAuth para MCP/GPT.
 * Uso: npm run seed:oauth-client
 *
 * Variables de entorno:
 *   MONGO_URI o MONGODB_URI - conexión MongoDB
 *   MCP_OAUTH_CLIENT_ID - client_id (default: adray-mcp-client)
 *   MCP_OAUTH_CLIENT_SECRET - client_secret (requerido, min 16 chars)
 *   MCP_OAUTH_REDIRECT_URIS - redirect_uri separados por coma (opcional)
 *   MCP_OAUTH_REDIRECT_PATTERNS - patrones wildcard separados por coma (opcional)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');

const clientId = process.env.MCP_OAUTH_CLIENT_ID || 'adray-mcp-client';
const clientSecret = process.env.MCP_OAUTH_CLIENT_SECRET;
const redirectUris = process.env.MCP_OAUTH_REDIRECT_URIS
  ? process.env.MCP_OAUTH_REDIRECT_URIS.split(',').map((s) => s.trim()).filter(Boolean)
  : [];
const redirectUriPatterns = process.env.MCP_OAUTH_REDIRECT_PATTERNS
  ? process.env.MCP_OAUTH_REDIRECT_PATTERNS.split(',').map((s) => s.trim()).filter(Boolean)
  : ['https://chat.openai.com/aip/*/oauth/callback'];

if (!clientSecret || clientSecret.length < 16) {
  console.error('Error: MCP_OAUTH_CLIENT_SECRET debe tener al menos 16 caracteres.');
  console.error('Añade MCP_OAUTH_CLIENT_SECRET=tu_secret_seguro en .env');
  process.exit(1);
}

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('Error: Falta MONGO_URI o MONGODB_URI en .env');
  process.exit(1);
}

const OAuthClientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true },
    clientSecret: { type: String, required: true },
    name: { type: String, required: true },
    redirectUris: { type: [String], default: [] },
    redirectUriPatterns: { type: [String], default: [] },
    scopes: { type: [String], default: ['read:ads_performance', 'read:shopify_orders'] },
    grantsAllowed: {
      type: [String],
      default: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-exchange'],
    },
    active: { type: Boolean, default: true },
  },
  { collection: 'oauth_clients', timestamps: true }
);

const OAuthClient = mongoose.models.OAuthClient || mongoose.model('OAuthClient', OAuthClientSchema);

async function main() {
  await mongoose.connect(MONGO_URI);
  try {
    const existing = await OAuthClient.findOne({ clientId });
    if (existing) {
      await OAuthClient.updateOne(
        { clientId },
        {
          $set: {
            clientSecret,
            redirectUris,
            redirectUriPatterns,
            active: true,
            grantsAllowed: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-exchange'],
          },
        }
      );
      console.log('Cliente OAuth actualizado:', clientId);
    } else {
      await OAuthClient.create({
        clientId,
        clientSecret,
        name: 'Adray MCP / GPT Client',
        redirectUris,
        redirectUriPatterns,
        scopes: ['read:ads_performance', 'read:shopify_orders'],
        grantsAllowed: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-exchange'],
        active: true,
      });
      console.log('Cliente OAuth creado:', clientId);
    }
    console.log('Scopes: read:ads_performance, read:shopify_orders');
    if (redirectUris.length) {
      console.log('Redirect URIs:', redirectUris.join(', '));
    } else {
      console.log('Redirect URIs: (vacío)');
    }
    if (redirectUriPatterns.length) {
      console.log('Redirect URI patterns:', redirectUriPatterns.join(', '));
    } else {
      console.log('Redirect URI patterns: (vacío)');
    }
    console.log('');
    console.log('Para probar OAuth:');
    console.log(`1. Logueate en Adray y abre:`);
    console.log(`   https://adray.ai/oauth/authorize?client_id=${clientId}&redirect_uri=https://httpbin.org/get&response_type=code&scope=read:ads_performance%20read:shopify_orders&state=xyz`);
    console.log(`2. Copia el "code" de la URL del callback`);
    console.log(`3. Intercambia code por token: POST /oauth/token con grant_type, code, redirect_uri, client_id, client_secret`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
