'use strict';
const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');

const SHEET_ID   = process.env.GOOGLE_SHEETS_ID;
const SHEET_TAB  = process.env.GOOGLE_SHEETS_TAB || 'Leads'; // pestaña

function getSheets() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  // Fuerza el token antes de usar la API
  return auth.authorize().then(() => google.sheets({ version: 'v4', auth }));
}

/* health */
router.get('/ping', (_req, res) => res.json({ ok: true, t: Date.now() }));

/* guarda lead */
router.post('/leads', async (req, res) => {
  try {
    const {
      name = '', email = '', phone = '',
      country_code = '', website = '', company = '', notes = '',
      utm_source = '', utm_medium = '', utm_campaign = '', utm_term = '', utm_content = ''
    } = req.body || {};

    const row = [
      new Date().toISOString(),
      name, email, phone, country_code, website, company, notes,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      req.ip, req.headers['user-agent'] || ''
    ];

    const sheets = await getSheets();

    // Usa un rango CONCRETO para evitar errores de rango abierto
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A2:O2`,            // 15 columnas A..O (ajusta si agregas más)
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Sheets append error >>',
      err?.response?.data || err?.message || err);
    return res.status(500).json({ ok: false, error: 'FAILED_SHEETS' });
  }
});

module.exports = router;
