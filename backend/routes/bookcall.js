// backend/routes/bookcall.js
'use strict';

const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;

function getSheets() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    // MUY IMPORTANTE: convertir \n en saltos reales
    (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    [
      'https://www.googleapis.com/auth/spreadsheets',
      // opcional pero útil para ciertos metadatos
      'https://www.googleapis.com/auth/drive.readonly',
    ]
  );
  return google.sheets({ version: 'v4', auth });
}

// Debug: ver que ID y pestañas está usando el server
router.get('/debug', async (_req, res) => {
  try {
    const sheets = getSheets();
    const info = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const titles = info.data.sheets?.map(s => s.properties?.title) || [];
    res.json({
      ok: true,
      spreadsheetId: SHEET_ID,
      sheets: titles,
    });
  } catch (err) {
    console.error('Sheets debug error:', err?.response?.data || err);
    res.status(500).json({ ok: false, error: 'FAILED_DEBUG' });
  }
});

// Ping simple
router.get('/ping', (_req, res) => {
  res.json({ ok: true, t: Date.now() });
});

router.post('/leads', async (req, res) => {
  try {
    const {
      name = '',
      email = '',
      phone = '',
      country_code = '',
      website = '',
      company = '',
      notes = '',
      utm_source = '',
      utm_medium = '',
      utm_campaign = '',
      utm_term = '',
      utm_content = '',
    } = req.body || {};

    const row = [
      new Date().toISOString(),
      name, email, phone, country_code, website, company, notes,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      req.ip, req.headers['user-agent'] || '',
    ];

    const sheets = getSheets();

    // ⬇️ Fuerza nombre del tab (respetando mayúsculas/espacios) y devuelve el rango actualizado
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Leads!A:O',               // Asegúrate que el tab se llame EXACTAMENTE "Leads"
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      includeValuesInResponse: true,
      responseValueRenderOption: 'UNFORMATTED_VALUE',
      requestBody: {
        majorDimension: 'ROWS',
        values: [row],
      },
    });

    const updated = result?.data?.updates?.updatedRange;
    console.log('✅ Sheets append OK ->', updated);

    res.json({ ok: true, updatedRange: updated });
  } catch (err) {
    console.error('❌ Sheets append error:', err?.response?.data || err);
    res.status(500).json({ ok: false, error: 'FAILED_SHEETS' });
  }
});

module.exports = router;
