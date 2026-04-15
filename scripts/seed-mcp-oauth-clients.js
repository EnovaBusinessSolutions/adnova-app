'use strict';

/**
 * seed-mcp-oauth-clients.js
 *
 * Registers the OAuth clients needed for Claude.ai, ChatGPT, and Gemini
 * MCP connector integrations.
 *
 * Usage:
 *   MONGO_URI=<your-production-uri> node scripts/seed-mcp-oauth-clients.js
 *
 * Safe to re-run — uses upsert so existing clients are updated, not duplicated.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('Error: MONGO_URI environment variable is required.');
  process.exit(1);
}

const OAuthClientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, index: true },
    clientSecret: { type: String, required: true },
    name: { type: String, required: true },
    redirectUris: { type: [String], default: [] },
    redirectUriPatterns: { type: [String], default: [] },
    scopes: { type: [String], default: ['read:ads_performance', 'read:shopify_orders'] },
    grantsAllowed: {
      type: [String],
      default: ['authorization_code', 'refresh_token'],
    },
    active: { type: Boolean, default: true },
  },
  { collection: 'oauth_clients', timestamps: true }
);

const OAuthClient = mongoose.models.OAuthClient || mongoose.model('OAuthClient', OAuthClientSchema);

// Clients to register. clientSecret is generated once and printed so you can
// store it in your password manager. On re-runs the secret is NOT rotated.
const CLIENTS = [
  {
    clientId: 'claude-connector',
    name: 'Claude (Anthropic)',
    redirectUris: [
      'https://claude.ai/api/mcp/auth_callback',
    ],
    redirectUriPatterns: [],
    scopes: ['read:ads_performance', 'read:shopify_orders'],
    grantsAllowed: ['authorization_code', 'refresh_token'],
  },
  {
    clientId: 'chatgpt-connector',
    name: 'ChatGPT (OpenAI)',
    redirectUris: [],
    redirectUriPatterns: ['https://chat.openai.com/aip/*/oauth/callback'],
    scopes: ['read:ads_performance', 'read:shopify_orders'],
    grantsAllowed: ['authorization_code', 'refresh_token'],
  },
  {
    clientId: 'gemini-connector',
    name: 'Gemini (Google)',
    redirectUris: [],
    redirectUriPatterns: ['https://*.google.com/*'],
    scopes: ['read:ads_performance', 'read:shopify_orders'],
    grantsAllowed: ['authorization_code', 'refresh_token'],
  },
];

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.\n');

  for (const client of CLIENTS) {
    const existing = await OAuthClient.findOne({ clientId: client.clientId });

    if (existing) {
      // Update fields but preserve existing clientSecret
      await OAuthClient.updateOne(
        { clientId: client.clientId },
        {
          $set: {
            name: client.name,
            redirectUris: client.redirectUris,
            redirectUriPatterns: client.redirectUriPatterns,
            scopes: client.scopes,
            grantsAllowed: client.grantsAllowed,
            active: true,
          },
        }
      );
      console.log(`[updated]  ${client.clientId}  (secret unchanged)`);
    } else {
      const clientSecret = crypto.randomBytes(32).toString('hex');
      await OAuthClient.create({ ...client, clientSecret });
      console.log(`[created]  ${client.clientId}`);
      console.log(`           clientSecret: ${clientSecret}  ← guarda esto en tu password manager`);
    }
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
