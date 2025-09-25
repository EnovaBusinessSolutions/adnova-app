// backend/routes/subscribe.js
const express = require('express');
const { google } = require('googleapis');

const router = express.Router();


let credentials = null;
try {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (raw && raw.trim()) credentials = JSON.parse(raw);
} catch (e) {
  console.warn('⚠️ GOOGLE_CREDENTIALS no es JSON válido. Desactivando /subscribe.', e.message);
}


if (!credentials) {
  router.post('/subscribe', (_req, res) => {
    return res
      .status(503)
      .json({ success: false, message: 'Newsletter desactivado. Falta GOOGLE_CREDENTIALS.' });
  });
  module.exports = router;
  return;
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });

const spreadsheetId = process.env.GOOGLE_SHEETS_ID || '';
const sheetRange = 'Sheet1!A:B';

router.post('/subscribe', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ success: false, error: 'Email requerido' });

  if (!spreadsheetId) {
    return res.status(500).json({ success: false, error: 'GOOGLE_SHEETS_ID no configurado' });
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetRange,
      valueInputOption: 'RAW',
      requestBody: { values: [[email, new Date().toISOString()]] },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Error escribiendo en Sheets:', err?.response?.data || err?.message || err);
    return res.status(500).json({ success: false, error: 'No se pudo guardar el email' });
  }
});

module.exports = router;
