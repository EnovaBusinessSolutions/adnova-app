'use strict';
const { GoogleAdsApi } = require('google-ads-api');

// Quita guiones del customerId
const normalizeId = (s) => String(s || '').replace(/-/g, '');

// Mapea presets “humanos” a DURING válidos
const mapDatePreset = (p = 'LAST_30_DAYS') => {
  const v = String(p || '').toUpperCase();
  if (['LAST_7_DAYS','LAST_14_DAYS','LAST_30_DAYS','THIS_MONTH','LAST_MONTH','ALL_TIME'].includes(v)) return v;
  if (['LAST_30','LAST_30D','LAST30','LAST30D'].includes(v)) return 'LAST_30_DAYS';
  if (['LAST_7','LAST_7D','LAST7','LAST7D'].includes(v)) return 'LAST_7_DAYS';
  return 'LAST_30_DAYS';
};

// Instancia de cliente/customer con MCC login
const getAdsCustomer = ({ user, customerId, loginCustomerId }) => {
  if (!user?.google?.refresh_token) {
    throw new Error('Usuario sin refresh_token de Google.');
  }

  const client = new GoogleAdsApi({
    client_id: process.env.GADS_CLIENT_ID,
    client_secret: process.env.GADS_CLIENT_SECRET,
    developer_token: process.env.GADS_DEV_TOKEN,
  });

  return client.Customer({
    customer_id: normalizeId(customerId),
    login_customer_id: String(loginCustomerId || process.env.GADS_LOGIN_MCC || '').replace(/-/g, ''),
    refresh_token: user.google.refresh_token,
  });
};

module.exports = { normalizeId, mapDatePreset, getAdsCustomer };
