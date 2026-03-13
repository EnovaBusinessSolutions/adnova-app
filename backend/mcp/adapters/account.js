'use strict';

const mongoose = require('mongoose');

let User, MetaAccount, GoogleAccount, ShopConnections;
try { User = require('../../models/User'); } catch { User = null; }
try { MetaAccount = require('../../models/MetaAccount'); } catch { MetaAccount = null; }
try { GoogleAccount = require('../../models/GoogleAccount'); } catch { GoogleAccount = null; }
try { ShopConnections = require('../../models/ShopConnections'); } catch { ShopConnections = null; }

function pickMetaInfo(meta) {
  if (!meta) return null;
  const accounts = meta.ad_accounts?.length ? meta.ad_accounts : meta.adAccounts || [];
  const selected = meta.selectedAccountIds?.[0] || meta.defaultAccountId || accounts[0]?.id || null;
  if (!selected) return null;
  const found = accounts.find(a => String(a?.id || a?.account_id || '') === String(selected)) || {};
  return {
    platform: 'meta',
    account_id: String(selected),
    account_name: found.name || found.account_name || null,
    currency: found.currency || found.account_currency || null,
    timezone: found.timezone_name || found.timezone || null,
    status: meta.access_token || meta.longLivedToken || meta.longlivedToken ? 'connected' : 'expired',
  };
}

function pickGoogleInfo(google) {
  if (!google) return null;
  const customers = [
    ...(Array.isArray(google.customers) ? google.customers : []),
    ...(Array.isArray(google.ad_accounts) ? google.ad_accounts : []),
  ];
  const selected = google.selectedCustomerIds?.[0] || google.defaultCustomerId || customers[0]?.id || null;
  if (!selected) return null;
  const found = customers.find(x => String(x?.id || '') === String(selected)) || {};
  const hasToken = !!(google.refreshToken || google.accessToken);
  return {
    platform: 'google',
    account_id: String(selected),
    account_name: found.descriptiveName || found.name || null,
    currency: found.currencyCode || null,
    timezone: found.timeZone || null,
    status: hasToken ? 'connected' : 'expired',
  };
}

function pickShopifyInfo(user, shopConn) {
  const shop = user?.shop || shopConn?.shop || null;
  if (!shop) return null;
  const hasToken = !!(user?.shopifyAccessToken || shopConn?.accessToken);
  return {
    platform: 'shopify',
    account_id: shop,
    account_name: shop.replace('.myshopify.com', ''),
    currency: null,
    timezone: null,
    status: hasToken ? 'connected' : 'disconnected',
  };
}

async function getAccountInfo(userId) {
  const [user, meta, google, shopConn] = await Promise.all([
    User ? User.findById(userId).select('shop shopifyConnected shopifyAccessToken').lean() : null,
    MetaAccount
      ? MetaAccount.findOne({ $or: [{ user: userId }, { userId }] })
          .select('+longLivedToken +longlivedToken +access_token +token ad_accounts adAccounts defaultAccountId selectedAccountIds')
          .lean()
      : null,
    GoogleAccount
      ? GoogleAccount.findOne({ $or: [{ user: userId }, { userId }] })
          .select('+accessToken +refreshToken customers ad_accounts defaultCustomerId selectedCustomerIds')
          .lean()
      : null,
    ShopConnections
      ? ShopConnections.findOne({ matchedToUserId: userId }).lean()
      : null,
  ]);

  const accounts = [];
  const metaInfo = pickMetaInfo(meta);
  if (metaInfo) accounts.push(metaInfo);
  const googleInfo = pickGoogleInfo(google);
  if (googleInfo) accounts.push(googleInfo);
  const shopifyInfo = pickShopifyInfo(user, shopConn);
  if (shopifyInfo) accounts.push(shopifyInfo);

  return { connected_accounts: accounts };
}

module.exports = { getAccountInfo };
